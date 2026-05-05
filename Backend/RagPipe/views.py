import os
import faiss
import pickle
import requests
import numpy as np
import PyPDF2
import json
from io import BytesIO
from urllib.parse import urlparse, unquote

from django.http import JsonResponse, FileResponse, Http404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.views.decorators.clickjacking import xframe_options_exempt

from sentence_transformers import SentenceTransformer

# Load embedding model once at startup
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")

# Minimum cosine similarity (0–1) for a chunk to be included in RAG context.
# Chunks below this threshold are discarded — they are off-topic and would
# dilute the grading prompt rather than improve it.
_RAG_RELEVANCE_THRESHOLD = 0.30

# Text chunking parameters — long PDF pages are split before embedding so
# individual concepts can be retrieved independently.
_CHUNK_WORDS      = 300   # target words per chunk
_CHUNK_OVERLAP    = 50    # overlap words between consecutive chunks

# Directory where all textbook artifacts (PDF, FAISS index, metadata) are stored
TEXTBOOKS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "Textbooks")
os.makedirs(TEXTBOOKS_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Public utility — importable by other Django apps (no HTTP round-trip)
# ---------------------------------------------------------------------------
def get_rag_context(query: str, index_file: str, meta_file: str, top_k: int = 3) -> str:
    """Retrieve top-k relevant text chunks from a FAISS index for *query*.

    Uses cosine similarity (IndexFlatIP on L2-normalised vectors) so scores
    are in [0, 1] and directly comparable to _RAG_RELEVANCE_THRESHOLD.
    Chunks below the threshold are dropped so the grader never receives
    irrelevant textbook content.

    Returns a single string (chunks separated by '---') or '' on any failure.
    """
    try:
        if not query or not os.path.exists(index_file) or not os.path.exists(meta_file):
            return ""

        idx = faiss.read_index(index_file)
        with open(meta_file, "rb") as f:
            meta = pickle.load(f)

        pages = meta.get("pages", [])
        if not pages:
            return ""

        q_emb = embedding_model.encode([query])
        q_emb = np.array(q_emb).astype("float32")
        # Normalise so inner-product == cosine similarity
        faiss.normalize_L2(q_emb)

        D, I = idx.search(q_emb, top_k)

        chunks = [
            pages[i]["text"]
            for score, i in zip(D[0], I[0])
            if i != -1
            and i < len(pages)
            and pages[i].get("text", "").strip()
            and float(score) >= _RAG_RELEVANCE_THRESHOLD
        ]
        return "\n\n---\n\n".join(chunks)
    except Exception:
        return ""

# Utility to extract base filename
def get_filename_from_path_or_url(path_or_url):
    parsed = urlparse(path_or_url)
    if parsed.scheme in ("http", "https"):
        name = os.path.basename(parsed.path)
    else:
        name = os.path.basename(path_or_url)
    return os.path.splitext(unquote(name))[0]

def _chunk_text(text: str, chunk_words: int = _CHUNK_WORDS, overlap: int = _CHUNK_OVERLAP) -> list[str]:
    """Split *text* into overlapping word-level chunks.

    Short pages (fewer words than *chunk_words*) are returned as-is.
    Chunks preserve sentence boundaries as much as possible.
    """
    words = text.split()
    if len(words) <= chunk_words:
        return [text]

    chunks = []
    start  = 0
    while start < len(words):
        end   = min(start + chunk_words, len(words))
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        if end == len(words):
            break
        start += chunk_words - overlap   # slide forward with overlap
    return chunks


def load_pdf_from_stream(pdf_stream):
    """Extract per-page text from a PDF stream.

    Pages with no extractable text (blank or image-only) are skipped so
    the embedding step never processes empty strings.
    """
    pages = []
    try:
        reader = PyPDF2.PdfReader(pdf_stream)
        for i, page in enumerate(reader.pages):
            text = page.extract_text()
            if text and text.strip():
                pages.append({"page_number": i + 1, "text": text.strip()})
    except Exception as e:
        raise ValueError(f"Error reading PDF: {e}")
    return pages

def embed_pages_and_save(pages, base_name):
    """Chunk pages, embed them, normalize to unit length, and persist a FAISS
    IndexFlatIP index plus metadata pickle.

    Uses cosine similarity (IndexFlatIP on L2-normalised vectors) — scores
    are in [0, 1] and directly comparable to _RAG_RELEVANCE_THRESHOLD.
    """
    # Expand every page into chunks
    chunk_records = []
    for page in pages:
        for chunk_text in _chunk_text(page["text"]):
            chunk_records.append({"page_number": page["page_number"], "text": chunk_text})

    texts      = [r["text"] for r in chunk_records]
    embeddings = embedding_model.encode(texts, show_progress_bar=True)
    embeddings = np.array(embeddings).astype("float32")

    # Normalise to unit length — enables cosine similarity via inner product
    faiss.normalize_L2(embeddings)

    index = faiss.IndexFlatIP(embeddings.shape[1])   # Inner Product = cosine on unit vecs
    index.add(embeddings)

    index_path = f"{base_name}_index.faiss"
    meta_path  = f"{base_name}_meta.pkl"

    faiss.write_index(index, index_path)
    with open(meta_path, "wb") as f:
        pickle.dump({"texts": texts, "pages": chunk_records}, f)

    return index_path, meta_path

@csrf_exempt
@require_POST
def ragify_pdf_view(request):
    try:
        if request.content_type == "application/json":
            body = json.loads(request.body)
            pdf_url = body.get("pdf_url")
            pdf_file = None
        else:
            pdf_url = request.POST.get("pdf_url")
            pdf_file = request.FILES.get("pdf_file")

        if not pdf_url and not pdf_file:
            return JsonResponse({"error": "Provide either 'pdf_url' or upload a 'pdf_file'."}, status=400)

        if pdf_url:
            response = requests.get(pdf_url)
            response.raise_for_status()
            pdf_stream = BytesIO(response.content)
            base_name = os.path.join(TEXTBOOKS_DIR, get_filename_from_path_or_url(pdf_url))
        else:
            pdf_stream = pdf_file.file
            base_name = os.path.join(TEXTBOOKS_DIR, os.path.splitext(pdf_file.name)[0])

        pages = load_pdf_from_stream(pdf_stream)
        index_path, meta_path = embed_pages_and_save(pages, base_name)

        # Save original PDF so it can be served back for viewing
        pdf_save_path = f"{base_name}.pdf"
        if pdf_url:
            with open(pdf_save_path, 'wb') as f:
                f.write(requests.get(pdf_url).content)
        else:
            # Re-read from the uploaded file object (stream already consumed above)
            pdf_file.file.seek(0)
            with open(pdf_save_path, 'wb') as f:
                f.write(pdf_file.file.read())

        return JsonResponse({
            "status":     "success",
            "index_file": index_path,
            "meta_file":  meta_path,
            "pdf_file":   pdf_save_path,
        })

    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)

@csrf_exempt
@require_POST
def similarity_search_view(request):
    try:
        if request.content_type == "application/json":
            body = json.loads(request.body)
            query = body.get("query")
            index_file = body.get("index_file")
            meta_file = body.get("meta_file")
        else:
            query = request.POST.get("query")
            index_file = request.POST.get("index_file")
            meta_file = request.POST.get("meta_file")

        if not query or not index_file or not meta_file:
            return JsonResponse({
                "error": "Fields 'query', 'index_file', and 'meta_file' are required."
            }, status=400)

        if not os.path.exists(index_file) or not os.path.exists(meta_file):
            return JsonResponse({"error": "Index or metadata file not found."}, status=404)

        index = faiss.read_index(index_file)
        with open(meta_file, "rb") as f:
            meta = pickle.load(f)

        pages = meta["pages"]
        query_embedding = embedding_model.encode([query])
        query_embedding = np.array(query_embedding).astype("float32")
        # Must normalize before searching IndexFlatIP (cosine similarity requires unit vectors)
        faiss.normalize_L2(query_embedding)

        D, I = index.search(query_embedding, 5)

        results = []
        for idx, distance in zip(I[0], D[0]):
            if idx != -1:
                page_data = pages[idx]
                results.append({
                    "page_number": page_data["page_number"],
                    "text": page_data["text"],
                    "similarity_score": float(distance)
                })

        return JsonResponse({"query": query, "results": results})

    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@xframe_options_exempt
def serve_pdf_view(request):
    pdf_path = request.GET.get('pdf_file', '').strip()

    if not pdf_path:
        raise Http404("No pdf_file parameter provided.")

    # Basic path traversal guard
    pdf_path = os.path.normpath(pdf_path)
    if '..' in pdf_path:
        raise Http404("Invalid path.")

    if not os.path.exists(pdf_path):
        raise Http404(f"PDF not found: {pdf_path}")

    if not pdf_path.lower().endswith('.pdf'):
        raise Http404("Only PDF files are served by this endpoint.")

    response = FileResponse(open(pdf_path, 'rb'), content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{os.path.basename(pdf_path)}"'
    return response
