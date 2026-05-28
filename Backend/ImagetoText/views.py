import base64
import logging
import re
import json

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from groq import Groq
from pymongo import MongoClient

# RAG utility — imported directly to avoid an extra HTTP round-trip
try:
    from RagPipe.views import get_rag_context
except Exception:
    def get_rag_context(*args, **kwargs):
        return ""

# Grading function — imported directly to avoid self-HTTP deadlock
try:
    from Evaluate.views import grade_questions
except Exception:
    def grade_questions(questions, default_total=None):
        return []

# Saves feedback directly — no HTTP round-trip, with a no-op fallback.
try:
    from Student.views import save_student_feedback
except Exception:
    def save_student_feedback(payload):
        return False, 'save_student_feedback unavailable'

# Use Django's logger — do NOT call logging.basicConfig() inside Django apps
logger = logging.getLogger(__name__)

# OCR model chain — only Scout is confirmed to accept image_url blocks on Groq.
_OCR_MODEL_CHAIN = [
    "meta-llama/llama-4-scout-17b-16e-instruct",
]

mongo_client = MongoClient(settings.MONGO_URI)
db = mongo_client['ScriptSense']
questions_collection = db['QuestionPaper']


def encode_image(image_file):
    return base64.b64encode(image_file.read()).decode("utf-8")


def get_question_text_from_db(subject, exam_type, qno):
    # sort by _id desc → always use the most recently uploaded question paper
    doc = questions_collection.find_one(
        {"subject": subject, "exam_type": exam_type},
        sort=[("_id", -1)]
    )
    if doc and 'questions' in doc:
        qno_str = str(qno)  # qno is now a string like "1", "2a", "2b"
        for question in doc['questions']:
            if str(question.get('qno')) == qno_str:
                return question.get('question')

def _sort_key(qno):
    """Natural sort for question keys: '1' < '2a' < '2b' < '3' < '3a'"""
    m = re.match(r'^(\d+)([a-zA-Z]?)$', str(qno))
    if m:
        return (int(m.group(1)), m.group(2).lower())
    return (0, str(qno))


def parse_and_add_questions(extracted_text, subject, exam_type):
    """Parse OCR-extracted text and pair each answer with its question from MongoDB."""
    
    logger.info(f"Parsing extracted text (length: {len(extracted_text)})")
    logger.info(f"First 500 chars: {extracted_text[:500]}")
    
    doc = questions_collection.find_one(
        {"subject": subject, "exam_type": exam_type},
        sort=[("_id", -1)]  # most-recent paper first
    )
    if not doc or 'questions' not in doc:
        logger.error(f"No questions found in DB for {subject}/{exam_type}")
        return []
    
    # qno stored as string: "1", "2a", "2b", etc.
    db_questions = {
        str(q['qno']): {'question': q['question'], 'marks': q.get('marks', None)}
        for q in doc['questions']
    }
    logger.info(f"Found {len(db_questions)} questions in DB: {sorted(db_questions.keys(), key=_sort_key)}")

    # Patterns ordered most-specific first; group(1) captures the full qno ("1", "2a", etc.).
    patterns = [
        r'\[Q(\d+[a-zA-Z]?)\]',                # [Q1], [Q2a]
        r'Question\s*(\d+\s*[a-zA-Z]?)',       # Question 1, Question 2a, Question 2 a
        r'^\s*(\d+[a-zA-Z]?)\)',               # 1), 2a), 2b)
        r'^(\d+[a-zA-Z]?)\.',                  # 1., 2a., 2b.
    ]
    
    found_answers = {}
    
    for pattern in patterns:
        matches = list(re.finditer(pattern, extracted_text, re.MULTILINE))
        if matches:
            logger.info(f"\u2713 Found {len(matches)} matches with pattern: {pattern}")
            
            for i, match in enumerate(matches):
                # Normalise: remove spaces, lowercase letter suffix → "2 a" → "2a"
                raw_key = match.group(1).strip().replace(' ', '')
                qno_str = re.sub(r'(\d+)([a-zA-Z]?)', lambda m: m.group(1) + m.group(2).lower(), raw_key)
                start = match.end()
                end = matches[i + 1].start() if i + 1 < len(matches) else len(extracted_text)
                
                answer_text = extracted_text[start:end].strip()
                answer_parts = [p.strip() for p in answer_text.split('\n\n') if p.strip()]
                
                if not answer_parts:
                    answer_parts = [answer_text] if answer_text else []
                
                found_answers[qno_str] = answer_parts
                logger.info(f"  Q{qno_str}: {len(answer_parts)} paragraphs")
            
            break
    
    # No pattern matched — distribute text proportionally across questions.
    # OCR likely produced no question labels; results may be inaccurate.
    if not found_answers:
        logger.warning(
            "No question markers found in OCR output — distributing text across all questions; "
            "results may be inaccurate."
        )
        sorted_keys = sorted(db_questions.keys(), key=_sort_key)
        if len(sorted_keys) == 1:
            found_answers[sorted_keys[0]] = [extracted_text]
        else:
            # Split into roughly equal segments, one per question
            lines = [l for l in extracted_text.splitlines() if l.strip()]
            chunk_size = max(1, len(lines) // len(sorted_keys))
            for i, key in enumerate(sorted_keys):
                start = i * chunk_size
                end   = start + chunk_size if i < len(sorted_keys) - 1 else len(lines)
                chunk = "\n".join(lines[start:end]).strip()
                found_answers[key] = [chunk] if chunk else []
    
    # Build result in natural question order.
    result = []
    for qno_str in sorted(db_questions.keys(), key=_sort_key):
        q_data  = db_questions[qno_str]
        q_text  = q_data['question'] if isinstance(q_data, dict) else q_data
        q_marks = q_data['marks']    if isinstance(q_data, dict) else None

        # Empty string for missing answers — Evaluate will award 0 automatically
        raw_answer = found_answers.get(qno_str, [])
        entry = {
            "qno":      qno_str,
            "question": q_text,
            "answer":   raw_answer if raw_answer else "",
        }
        if q_marks is not None:
            entry["total_marks"] = q_marks
        result.append(entry)
    
    logger.info(f"Parsed {len(result)} questions")
    return result


def extract_text_from_images(base64_images):
    """Run OCR on a list of base64 images using the Groq Vision API.

    Tries each model in _OCR_MODEL_CHAIN in order; continues on rate-limit
    errors, raises immediately on any other error.
    """
    groq_client = Groq(api_key=settings.GROQ_API_KEY)

    prompt = (
        "Extract only the visible text from these images, and organize it by question number.\n"
        "- Identify each question based on its number (e.g., Q1, 1., 2., etc.).\n"
        "- If the student wrote subpart answers (a, b, i, ii), label each one separately using headings like "
        "  'Question 2a:', 'Question 2b:', 'Question 3a:', etc.\n"
        "- If you see answers labeled only as 'a.' or 'b.' under a main question number, infer the full label "
        "  (e.g., 'a.' under Question 2 becomes 'Question 2a:').\n"
        "- Group each answer under its respective question/subquestion label.\n"
        "- Do NOT generate or assume any new content — only extract what is actually visible.\n"
        "- Correct any spelling mistakes.\n"
        "- Preserve logical structure (headings, bullet points, tables, equations) within each answer.\n"
        "- Use clean, consistent formatting so the output is machine-readable.\n"
        "- Ensure each answer appears immediately after its question/subquestion label."
    )

    message_content = [{"type": "text", "text": prompt}]
    for base64_img in base64_images:
        message_content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{base64_img}"}
        })

    last_error = None
    for model_name in _OCR_MODEL_CHAIN:
        try:
            logger.info(f"OCR: trying model '{model_name}' for {len(base64_images)} image(s)")
            response = groq_client.chat.completions.create(
                model=model_name,
                messages=[{"role": "user", "content": message_content}],
                temperature=0.2,
                top_p=1,
                stream=False,
            )
            logger.info(f"OCR: success with model '{model_name}'")
            return response.choices[0].message.content
        except Exception as e:
            last_error = e
            err_str = str(e).lower()
            # Rate-limit or quota → try next model; auth/network → raise immediately
            if any(k in err_str for k in ('rate_limit', '429', 'quota', 'tokens per day')):
                logger.warning(f"OCR [{model_name}]: rate-limited — trying next model. Detail: {e}")
                continue
            logger.error(f"OCR [{model_name}]: unrecoverable error: {e}")
            raise

    raise RuntimeError(f"All OCR models exhausted. Last error: {last_error}")


def _save_feedback_direct(payload: dict) -> tuple:
    """Call save_student_feedback() and return (http_status_code, message)."""
    ok, msg = save_student_feedback(payload)
    if ok:
        logger.info("Feedback persisted via save_student_feedback()")
        return 200, msg
    logger.error(f"save_student_feedback() failed: {msg}")
    return 500, msg


def get_reference_image_data(subject: str, exam_type: str, qno) -> tuple:
    """Return (base64_str, diagram_marks) for a question's reference diagram.

    Returns ('', None) when no reference image exists.
    diagram_marks is the teacher-specified marks for the diagram component,
    or None for old question papers that pre-date the field.
    """
    try:
        doc = questions_collection.find_one(
            {"subject": subject, "exam_type": exam_type},
            sort=[("_id", -1)]
        )
        if not doc or 'questions' not in doc:
            return "", None
        qno_str = str(qno)
        for q in doc['questions']:
            if str(q.get('qno')) == qno_str:
                image_data   = q.get('image')
                diagram_marks = q.get('diagram_marks')  # None for legacy records
                if image_data and image_data.get('data'):
                    raw_bytes = bytes(image_data['data'])
                    b64 = base64.b64encode(raw_bytes).decode('utf-8')
                    return b64, diagram_marks
        return "", None
    except Exception as e:
        logger.warning(f"Failed to retrieve reference image for Q{qno}: {e}")
        return "", None


def find_student_diagram_page(base64_images: list, question_text: str, qno) -> str:
    """Use Groq Vision to find which uploaded page contains the student's diagram for qno.

    Returns that page's base64 string, or '' if not found.
    Short-circuits to the only page when len(base64_images) == 1.
    """
    if not base64_images:
        return ""

    # Short-circuit: only one page uploaded — it must be the diagram page
    if len(base64_images) == 1:
        logger.info(f"Q{qno}: Single-page submission — skipping Groq diagram detection")
        return base64_images[0]

    groq_client = Groq(api_key=settings.GROQ_API_KEY)
    n = len(base64_images)
    prompt = (
        f"You are reviewing {n} page(s) of a student's handwritten answer sheet.\n"
        f"The question being answered is: \"{question_text}\"\n"
        f"This question requires the student to draw a diagram or figure.\n\n"
        f"Look through all {n} page(s) and identify which page number (1 to {n}) "
        f"contains the student's drawn diagram or figure for this question.\n"
        f"Reply with ONLY the page number as a single digit (e.g. '2'), "
        f"or 'none' if no diagram is found on any page."
    )

    content = [{"type": "text", "text": prompt}]
    for b64 in base64_images:
        content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})

    try:
        response = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": content}],
            temperature=0.1,
            stream=False,
        )
        result = response.choices[0].message.content.strip().lower()
        if 'none' in result:
            return ""
        match = re.search(r'\b(\d+)\b', result)
        if match:
            page_num = int(match.group(1))
            if 1 <= page_num <= n:
                return base64_images[page_num - 1]
    except Exception as e:
        logger.warning(f"Diagram page detection failed for Q{qno}: {e}")

    return ""

@csrf_exempt
def process_exam_images(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST method is allowed'}, status=405)

    exam_type   = request.POST.get('exam_type')
    subject     = request.POST.get('subject')
    image_files = request.FILES.getlist('images')
    total       = request.POST.get('total')
    usn         = request.POST.get('usn')
    # RAG artifacts — provided by teacher if a textbook was indexed via /rag/pipeline/
    index_file  = request.POST.get('index_file', '').strip()
    meta_file   = request.POST.get('meta_file', '').strip()
    use_rag     = bool(index_file and meta_file)

    if not exam_type or not subject:
        return JsonResponse({'error': 'Missing exam_type or subject'}, status=400)

    if not image_files:
        return JsonResponse({'error': 'No images provided'}, status=400)

    try:
        logger.info(f"Received {len(image_files)} images for subject={subject}, exam_type={exam_type}")
        
        base64_images = [encode_image(img) for img in image_files]
        
        extracted_text = extract_text_from_images(base64_images)
        logger.info(f"Extracted text length: {len(extracted_text)} characters")
        
        refined_payload = parse_and_add_questions(extracted_text, subject, exam_type)

        # Inject RAG context per question when a textbook index is available.
        if use_rag:
            logger.info(f"RAG enabled — querying index '{index_file}' for {len(refined_payload)} questions")
            for q in refined_payload:
                ctx = get_rag_context(
                    query=q.get('question', ''),
                    index_file=index_file,
                    meta_file=meta_file,
                    top_k=3
                )
                q['retrieved_context'] = ctx
                if ctx:
                    logger.info(f"  Q{q.get('qno')}: RAG context found ({len(ctx)} chars)")
                else:
                    logger.info(f"  Q{q.get('qno')}: no RAG context retrieved")
        else:
            logger.info("RAG not enabled for this submission (no index_file/meta_file provided)")

        diagram_count = 0
        for q in refined_payload:
            qno                = q.get('qno')
            ref_b64, diag_marks = get_reference_image_data(subject, exam_type, qno)
            if ref_b64:
                logger.info(f"Q{qno}: Reference diagram found — locating student diagram page")
                student_b64 = find_student_diagram_page(base64_images, q.get('question', ''), qno)
                if student_b64:
                    q['reference_image_b64'] = ref_b64
                    q['student_diagram_b64'] = student_b64
                    if diag_marks is not None:
                        q['diagram_marks'] = diag_marks
                    diagram_count += 1
                    logger.info(f"Q{qno}: Student diagram located — visual grading enabled (diagram_marks={diag_marks})")
                else:
                    # No diagram detected on any page — attach reference image and
                    # diagram_marks so the grader knows the split budget, but
                    # has_student_diagram will be False → diagram portion = 0 automatically.
                    q['reference_image_b64'] = ref_b64
                    if diag_marks is not None:
                        q['diagram_marks'] = diag_marks
                    logger.info(f"Q{qno}: No student diagram detected — diagram marks will be 0")
        if diagram_count:
            logger.info(f"Visual grading enabled for {diagram_count} question(s)")

        payload = {
            'exam_type': exam_type,
            'subject': subject,
            'total': total,
            'questions': refined_payload
        }
        
        logger.info(f"Payload prepared: {len(refined_payload)} questions, RAG={'yes' if use_rag else 'no'}")

        logger.info("Calling grade_questions()...")
        grading_results = grade_questions(refined_payload, default_total=int(total) if total else 10)
        # grade_questions() uses per-question total_marks from DB when available;
        # default_total is the fallback for records without stored marks.
        response_data   = {'results': grading_results}
        logger.info(f"Grading complete: {len(grading_results)} results")
        
        # Build feedback list — forward all assessment fields from the grading engine.
        feedback_list = []

        if isinstance(response_data, dict) and "results" in response_data:
            results = response_data.get("results", [])

            for idx, result in enumerate(results):
                if not isinstance(result, dict):
                    continue

                # Error results get a zero-score placeholder so no question is silently dropped
                if "error" in result and "score" not in result:
                    logger.warning(f"Error result at index {idx}: {result.get('error')} — inserting zero-score placeholder")
                    q_entry = refined_payload[idx] if idx < len(refined_payload) else {}
                    q_qno   = q_entry.get("qno", idx + 1)
                    q_marks = q_entry.get("total_marks") or (int(total) if total else 0)
                    feedback_list.append({
                        "index":   idx,
                        "qno":     q_qno,
                        "question": q_entry.get("question", f"Question {q_qno}"),
                        "answer":   "",
                        "feedback": f"Grading failed for this question ({result.get('error', 'unknown error')}). Please review manually.",
                        "score":    0,
                        "total":    int(q_marks),
                        "correctness_assessment": "", "completeness_assessment": "",
                        "relevance_assessment":   "", "depth_assessment": "",
                        "correct_points_found":   [], "missing_points": [], "incorrect_points": [],
                        "partial_credit_reasoning": "",
                        "confidence": "low", "used_rag_reference": False,
                    })
                    continue

                qno = result.get("qno", idx + 1)

                # Resolve question_data from refined_payload for fallback values
                question_data = next(
                    (q for q in refined_payload if q.get("qno") == qno), None
                )

                # Resolve answer string
                answer_str = result.get("answer", "")
                if not answer_str and question_data:
                    raw = question_data.get("answer", "")
                    answer_str = " ".join(raw) if isinstance(raw, list) else str(raw)

                # Resolve question text
                question_text = result.get("question", "")
                if not question_text and question_data:
                    question_text = question_data.get("question", f"Question {qno}")

                # Resolve total marks
                q_total = result.get("total") or total

                feedback_item = {
                    "index": idx,
                    "qno":   qno,
                    "question": question_text,
                    "answer":   answer_str,
                    "feedback": result.get("feedback", ""),
                    "score":    float(result.get("score", 0)),
                    "total":    int(q_total) if q_total else 0,
                    # Extended assessment fields from the new grading engine
                    "correctness_assessment":   result.get("correctness_assessment", ""),
                    "completeness_assessment":  result.get("completeness_assessment", ""),
                    "relevance_assessment":     result.get("relevance_assessment", ""),
                    "depth_assessment":         result.get("depth_assessment", ""),
                    "correct_points_found":     result.get("correct_points_found", []),
                    "missing_points":           result.get("missing_points", []),
                    "incorrect_points":         result.get("incorrect_points", []),
                    "partial_credit_reasoning": result.get("partial_credit_reasoning", ""),
                    "confidence":               result.get("confidence", ""),
                    "used_rag_reference":       result.get("used_rag_reference", False),
                }

                feedback_list.append(feedback_item)
        
        logger.info(f"Generated feedback list: {feedback_list}")
        
        # answer_sheets: base64 of each uploaded page, stored for student review.
        student_payload = {
            'usn': usn,
            'subject': subject,
            'exam_type': exam_type,
            'feedback': feedback_list,
            'answer_sheets': base64_images,
        }

        logger.info(f"Student payload built: {len(feedback_list)} feedbacks, {len(base64_images)} sheet image(s)")
        
        status, student_log = _save_feedback_direct(student_payload)

        if status != 200:
            logger.error(f"Failed to save feedback, status: {status}, details: {student_log}")
            return JsonResponse({'error': 'Failed to save student feedback', 'details': student_log}, status=status)
        
        logger.info(f"Student log: {student_log}")

        # Return the cleaned feedback_list (not raw grading output) so the
        # teacher frontend never receives error/skipped records with missing fields
        return JsonResponse({
            'message':           'Processing successful',
            'forwarded_response': json.dumps({'results': feedback_list}),
        })

    except Exception as e:
        logger.exception(f"Unexpected error during processing: {e}")
        return JsonResponse({'error': 'Unexpected error', 'details': str(e)}, status=500)