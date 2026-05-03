import { useState, useEffect } from 'react';
import {
  BookOpen, CheckCircle, Upload, Eye, EyeOff, Trash2,
  ChevronDown, ChevronUp, Star, FileText,
} from 'lucide-react';
import Button from '../components/Button';

// ── Types ────────────────────────────────────────────────────────────────────
type RagStatus = 'idle' | 'uploading' | 'error';

interface Textbook {
  name: string;
  index_file: string;
  meta_file: string;
  pdf_file: string;
  uploadedAt: string;
}

// ── localStorage helpers ─────────────────────────────────────────────────────
const LS_LIST = 'rag_textbooks';        // Textbook[]
const LS_ACTIVE = 'rag_active_name';      // active textbook name

// Keys read by UploadAnswerPage — kept in sync with the active textbook
const LS_INDEX = 'rag_index_file';
const LS_META = 'rag_meta_file';
const LS_PDF = 'rag_pdf_file';

function loadList(): Textbook[] {
  try { return JSON.parse(localStorage.getItem(LS_LIST) || '[]'); }
  catch { return []; }
}
function saveList(list: Textbook[]) {
  localStorage.setItem(LS_LIST, JSON.stringify(list));
}
function activateName(name: string, list: Textbook[]) {
  const book = list.find(b => b.name === name);
  if (!book) return;
  localStorage.setItem(LS_ACTIVE, name);
  localStorage.setItem(LS_INDEX, book.index_file);
  localStorage.setItem(LS_META, book.meta_file);
  localStorage.setItem(LS_PDF, book.pdf_file);
  // Legacy keys (kept for compatibility)
  localStorage.setItem('rag_indexed_name', name);
}
function deactivate() {
  localStorage.removeItem(LS_ACTIVE);
  localStorage.removeItem(LS_INDEX);
  localStorage.removeItem(LS_META);
  localStorage.removeItem(LS_PDF);
  localStorage.removeItem('rag_indexed_name');
}

// ── Component ────────────────────────────────────────────────────────────────
const UploadTextbookPage = () => {
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [activeName, setActiveName] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [ragStatus, setRagStatus] = useState<RagStatus>('idle');
  const [ragError, setRagError] = useState('');
  const [viewerBook, setViewerBook] = useState<Textbook | null>(null);

  // Load from localStorage on mount (with legacy migration)
  useEffect(() => {
    let list = loadList();

    // Migrate legacy single-textbook localStorage entries
    const legacyName = localStorage.getItem('rag_indexed_name');
    const legacyIndex = localStorage.getItem(LS_INDEX);
    const legacyMeta = localStorage.getItem(LS_META);
    const legacyPdf = localStorage.getItem(LS_PDF);

    if (legacyName && legacyIndex && legacyMeta && !list.find(b => b.name === legacyName)) {
      const migrated: Textbook = {
        name: legacyName,
        index_file: legacyIndex,
        meta_file: legacyMeta,
        pdf_file: legacyPdf || '',
        uploadedAt: new Date().toISOString(),
      };
      list = [migrated, ...list];
      saveList(list);
    }

    setTextbooks(list);
    setActiveName(localStorage.getItem(LS_ACTIVE) || legacyName || '');
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPdfFile(e.target.files?.[0] || null);
    setRagStatus('idle');
    setRagError('');
  };

  const handleUpload = async () => {
    if (!pdfFile) return;
    setRagStatus('uploading');
    setRagError('');

    try {
      const formData = new FormData();
      formData.append('pdf_file', pdfFile);

      const res = await fetch('http://127.0.0.1:8000/rag/pipeline/', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${res.status}`);
      }

      const data = await res.json();
      if (!data.index_file || !data.meta_file) {
        throw new Error('Backend did not return index paths.');
      }

      const newBook: Textbook = {
        name: pdfFile.name,
        index_file: data.index_file,
        meta_file: data.meta_file,
        pdf_file: data.pdf_file || '',
        uploadedAt: new Date().toISOString(),
      };

      // Replace if same name, else prepend
      const updated = [newBook, ...textbooks.filter(b => b.name !== newBook.name)];
      saveList(updated);
      setTextbooks(updated);

      // Auto-activate if this is the first book or it was previously active
      if (!activeName || activeName === newBook.name) {
        activateName(newBook.name, updated);
        setActiveName(newBook.name);
      }

      setPdfFile(null);
      setRagStatus('idle');

      // Reset the file input
      const input = document.getElementById('textbook-file-input') as HTMLInputElement;
      if (input) input.value = '';

    } catch (err: any) {
      setRagError(err.message || 'Upload failed.');
      setRagStatus('error');
    }
  };

  const handleSetActive = (book: Textbook) => {
    activateName(book.name, textbooks);
    setActiveName(book.name);
    setViewerBook(null);
  };

  const handleDeactivate = () => {
    deactivate();
    setActiveName('');
  };

  const handleDelete = (book: Textbook) => {
    const updated = textbooks.filter(b => b.name !== book.name);
    saveList(updated);
    setTextbooks(updated);

    if (activeName === book.name) {
      deactivate();
      setActiveName('');
    }
    if (viewerBook?.name === book.name) setViewerBook(null);
  };

  const toggleViewer = (book: Textbook) => {
    setViewerBook(prev => prev?.name === book.name ? null : book);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto">

      {/* Page heading */}
      <div className="page-header">
        <h2>Upload Textbook</h2>
        <p>Upload subject textbooks or reference PDFs. The active textbook is used for RAG-assisted grading on every evaluation.</p>
      </div>

      {/* Upload card */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Upload className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-800">Upload a new textbook</h3>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <div className="flex-1">
            <input
              id="textbook-file-input"
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
            />
            {pdfFile && (
              <p className="mt-1.5 text-xs text-gray-400">
                {pdfFile.name} · {(pdfFile.size / 1024).toFixed(0)} KB
              </p>
            )}
          </div>
          <Button
            onClick={handleUpload}
            disabled={!pdfFile || ragStatus === 'uploading'}
            isLoading={ragStatus === 'uploading'}
          >
            {ragStatus === 'uploading' ? 'Indexing…' : 'Upload & Index'}
          </Button>
        </div>

        {ragStatus === 'error' && (
          <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{ragError}</div>
        )}
      </div>

      {/* ── Textbook list ── */}
      {textbooks.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 py-14 text-center">
          <BookOpen className="h-8 w-8 mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No textbooks uploaded yet.</p>
          <p className="text-xs text-gray-400 mt-1">Upload a PDF to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest px-1 mb-1">
            Uploaded Textbooks ({textbooks.length})
          </h3>

          {textbooks.map(book => {
            const isActive = book.name === activeName;
            const isViewing = viewerBook?.name === book.name;
            const viewerUrl = book.pdf_file
              ? `http://127.0.0.1:8000/rag/textbook/?pdf_file=${encodeURIComponent(book.pdf_file)}`
              : '';
            const uploadDate = new Date(book.uploadedAt).toLocaleDateString('en-IN', {
              day: '2-digit', month: 'short', year: 'numeric',
            });

            return (
              <div key={book.name} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {/* Book row */}
                <div className="flex items-center gap-4 p-4">
                  <FileText className={`h-8 w-8 flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-gray-300'}`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-800 truncate">{book.name}</p>
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                          <Star className="h-3 w-3" /> Used in evaluation
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-xs font-medium text-gray-400 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
                          Not active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">Uploaded {uploadDate}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* View toggle */}
                    {viewerUrl ? (
                      <button
                        onClick={() => toggleViewer(book)}
                        title={isViewing ? 'Hide PDF' : 'View PDF'}
                        className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 rounded-md px-2.5 py-1.5 transition-colors"
                      >
                        {isViewing ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {isViewing ? 'Hide' : 'View'}
                      </button>
                    ) : null}

                    {/* Activate / deactivate */}
                    {isActive ? (
                      <button
                        onClick={handleDeactivate}
                        title="Deactivate RAG for this textbook"
                        className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-2.5 py-1.5 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSetActive(book)}
                        title="Use this textbook for grading"
                        className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2.5 py-1.5 hover:bg-blue-100 transition-colors"
                      >
                        Set Active
                      </button>
                    )}

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(book)}
                      title="Remove from list"
                      className="text-gray-400 hover:text-red-600 p-1.5 rounded transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Inline PDF viewer */}
                {isViewing && viewerUrl && (
                  <div className="border-t">
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
                      <span className="text-xs font-medium text-gray-500 truncate">{book.name}</span>
                      <a
                        href={viewerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline flex-shrink-0 ml-4"
                      >
                        Open in new tab ↗
                      </a>
                    </div>
                    <iframe
                      src={viewerUrl}
                      title={book.name}
                      className="w-full"
                      style={{ height: '72vh', minHeight: '480px' }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Info note */}
      <div className="mt-6 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
        <strong className="font-semibold">How this works:</strong> The active textbook (★) is indexed using sentence embeddings.
        When grading, relevant passages are retrieved and sent to the AI as context. Only one textbook can be active at a time.
      </div>
    </div>
  );
};

export default UploadTextbookPage;
