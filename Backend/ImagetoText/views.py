import base64
import logging
import requests
import re

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from groq import Groq
from pymongo import MongoClient
import json

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

# Setup logging
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Setup MongoDB client (ensure this is created once globally)
mongo_client = MongoClient(settings.MONGO_URI)
db = mongo_client['ScriptSense']
questions_collection = db['QuestionPaper']


def encode_image(image_file):
    return base64.b64encode(image_file.read()).decode("utf-8")


def get_question_text_from_db(subject, exam_type, qno):
    doc = questions_collection.find_one({"subject": subject, "exam_type": exam_type})
    if doc and 'questions' in doc:
        for question in doc['questions']:
            if question.get('qno') == int(qno):
                return question.get('question')
            
    # return f"{subject} {exam_type} question {qno}"


def parse_and_add_questions(extracted_text, subject, exam_type):
    """Parse extracted text and match with questions from database"""
    
    logger.info(f"Parsing extracted text (length: {len(extracted_text)})")
    logger.info(f"First 500 chars: {extracted_text[:500]}")
    
    # Get all questions from database
    doc = questions_collection.find_one({"subject": subject, "exam_type": exam_type})
    if not doc or 'questions' not in doc:
        logger.error(f"No questions found in DB for {subject}/{exam_type}")
        return []
    
    db_questions = {q['qno']: q['question'] for q in doc['questions']}
    logger.info(f"Found {len(db_questions)} questions in DB: {list(db_questions.keys())}")
    
    # Try multiple patterns to find question markers
    patterns = [
        r'\[Q(\d+)\]',           # [Q1], [Q2]
        r'^\s*(\d+)\)',          # 1), 2), 3)
        r'Question\s*(\d+)',     # Question 1, Question 2
        r'^(\d+)\.',             # 1., 2., 3.
    ]
    
    found_answers = {}
    
    for pattern in patterns:
        matches = list(re.finditer(pattern, extracted_text, re.MULTILINE))
        if matches:
            logger.info(f"✓ Found {len(matches)} matches with pattern: {pattern}")
            
            for i, match in enumerate(matches):
                qno = int(match.group(1))
                start = match.end()
                end = matches[i + 1].start() if i + 1 < len(matches) else len(extracted_text)
                
                answer_text = extracted_text[start:end].strip()
                answer_parts = [p.strip() for p in answer_text.split('\n\n') if p.strip()]
                
                if not answer_parts:
                    answer_parts = [answer_text] if answer_text else []
                
                found_answers[qno] = answer_parts
                logger.info(f"  Q{qno}: {len(answer_parts)} paragraphs")
            
            break
    
    # If no pattern matched, try to intelligently split the text
    if not found_answers:
        logger.warning("No question markers found, attempting intelligent split...")
        # Send everything as one answer for Q1
        found_answers[1] = [extracted_text]
    
    # Build result
    result = []
    for qno in sorted(db_questions.keys()):
        result.append({
            "qno": qno,
            "question": db_questions[qno],
            "answer": found_answers.get(qno, ["No answer extracted"])
        })
    
    logger.info(f"Parsed {len(result)} questions")
    return result

def extract_text_from_images(base64_images):
    client = Groq(api_key=settings.GROQ_API_KEY)

    prompt = (
        "Extract only the visible text from these images, and organize it by question number.\n"
        "- Identify each question based on its number (e.g., Q1, 1., 2., etc.).\n"
        "- Group each answer under its respective question number using clear headings like 'Question 1:', 'Question 2:', etc.\n"
        "- Do NOT generate or assume any new content—only extract what's actually visible in the image.\n"
        "- Correct any spelling mistakes.\n"
        "- Preserve logical structure (e.g., headings, bullet points, tables, equations) within each answer.\n"
        "- Use clean and consistent formatting so the output is both human-readable and machine-readable.\n"
        "- Ignore decorative elements, arrows, or icons unless they contain actual text.\n"
        "- Ensure each answer appears immediately after its corresponding question number."
    )

    message_content = [{"type": "text", "text": prompt}]
    for base64_img in base64_images:
        message_content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{base64_img}"}
        })

    logger.info("Sending images to Groq API for text extraction...")

    response = client.chat.completions.create(
        model="meta-llama/llama-4-scout-17b-16e-instruct",
        messages=[{"role": "user", "content": message_content}],
        temperature=0.2,
        top_p=1,
        stream=False
    )

    logger.info("Received response from Groq API.")
    return response.choices[0].message.content


def trigger_another_app(payload):
    """POST extracted data to another Django app"""
    try:
        logger.info(f"Triggering other app at {settings.OTHER_DJANGO_APP_URL} with payload.")
        response = requests.post(settings.OTHER_DJANGO_APP_URL, json=payload, timeout=10)
        logger.info(f"Received response from other app: status {response.status_code}")
        return response.status_code, response.text
    except requests.RequestException as e:
        logger.error(f"Error triggering other app: {e}")
        return 500, str(e)




def trigger_another_app2(payload):
    """POST extracted data to another Django app"""
    try:
        logger.info(f"Triggering other app at {settings.OTHER_APP_URL} with payload.")
        response = requests.post(settings.OTHER_APP_URL, json=payload, timeout=10)
        logger.info(f"Received response from other app: status {response.status_code}")
        return response.status_code, response.text
    except requests.RequestException as e:
        logger.error(f"Error triggering other app: {e}")
        return 500, str(e)

@csrf_exempt
def process_exam_images(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST method is allowed'}, status=405)

    exam_type   = request.POST.get('exam_type')
    subject     = request.POST.get('subject')
    image_files = request.FILES.getlist('images')
    total       = request.POST.get('total')
    usn         = request.POST.get('usn')
    # Optional RAG index paths — teacher frontend can pass these after /rag/pipeline/
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

        # --- Optional: inject RAG context per question ---
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

        payload = {
            'exam_type': exam_type,
            'subject': subject,
            'total': total,
            'questions': refined_payload
        }
        
        logger.info(f"Payload prepared: {len(refined_payload)} questions, RAG={'yes' if use_rag else 'no'}")

        # --- Call grading directly (no HTTP) to avoid self-call deadlock ---
        logger.info("Calling grade_questions() directly...")
        grading_results = grade_questions(refined_payload, default_total=total)
        response_data   = {'results': grading_results}
        response_text   = json.dumps(response_data)
        logger.info(f"Grading complete: {len(grading_results)} results")
        
        # Format feedback — forward ALL fields from Evaluate (core + extended)
        feedback_list = []

        if isinstance(response_data, dict) and "results" in response_data:
            results = response_data.get("results", [])

            for idx, result in enumerate(results):
                if not isinstance(result, dict):
                    continue

                # Error results get a zero-score placeholder so no question is silently dropped
                if "error" in result and "score" not in result:
                    logger.warning(f"Error result at index {idx}: {result.get('error')} — inserting zero-score placeholder")
                    question_data = next((q for q in refined_payload if q.get("qno") == idx + 1), None)
                    feedback_list.append({
                        "index":   idx,
                        "qno":     idx + 1,
                        "question": question_data.get("question", f"Question {idx + 1}") if question_data else f"Question {idx + 1}",
                        "answer":   "",
                        "feedback": f"Grading failed for this question ({result.get('error', 'unknown error')}). Please review manually.",
                        "score":    0,
                        "total":    int(total) if total else 0,
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

                # --- Build feedback item: core fields + all extended assessment fields ---
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
        
        # Create the payload with the properly formatted feedback
        student_payload = {
            'usn': usn,
            'subject': subject,
            'exam_type': exam_type,
            'feedback': feedback_list,
        }
        
        logger.info(f"Student payload: {student_payload}")
        
        status, student_log = trigger_another_app2(student_payload)
    
        if status != 200:
            logger.error(f"Failed to notify student app, status: {status}, details: {student_log}")
            return JsonResponse({'error': 'Failed to notify student app', 'details': student_log}, status=status)
        
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