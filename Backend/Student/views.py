from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from pymongo import MongoClient, ASCENDING
import base64
import json
import logging
import re
import bcrypt
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# MongoDB client – URI loaded from settings (which reads from .env)
client = MongoClient(settings.MONGO_URI)
db = client['ScriptSense']
collection = db['students']
login_collection = db['Login']

# ── Ensure indexes exist (runs once at import time; safe to call repeatedly) ──
try:
    collection.create_index(
        [("usn", ASCENDING), ("subject", ASCENDING), ("exam_type", ASCENDING)],
        name="usn_subject_examtype",
        background=True,
    )
    login_collection.create_index(
        [("usn", ASCENDING)],
        name="usn_unique",
        unique=True,
        background=True,
    )
except Exception as _idx_err:
    logger.warning(f"Index creation skipped (may already exist): {_idx_err}")

# Validate USN format
def validate_usn(usn):
    if not usn:
        return None
    return re.match(r"^\d{2}ET[A-Z]{2}\d{3}\d{3}$", usn)

@csrf_exempt
def login(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST allowed'}, status=405)

    try:
        data = json.loads(request.body)
        usn = data.get('usn')
        password = data.get('password')
    except (json.JSONDecodeError, KeyError):
        return JsonResponse({'error': 'Invalid request format'}, status=400)

    if not usn or not password:
        return JsonResponse({'error': 'USN and password required'}, status=400)

    if not validate_usn(usn):
        return JsonResponse({'error': 'Invalid USN format'}, status=400)

    # Find user and include password hash
    student = login_collection.find_one({"usn": usn}, {"_id": 0, "password": 1})
    if not student:
        return JsonResponse({'error': 'User not found'}, status=404)

    hashed_password = student.get("password")
    if not bcrypt.checkpw(password.encode('utf-8'), hashed_password.encode('utf-8')):
        return JsonResponse({'error': 'Incorrect password'}, status=401)

    return JsonResponse({
        "message": "Login successful",
        "usn": usn
    })

@csrf_exempt
def signup(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST allowed'}, status=405)

    try:
        data = json.loads(request.body)
        usn = data.get('usn')
        password = data.get('password')
    except (json.JSONDecodeError, KeyError):
        return JsonResponse({'error': 'Invalid request format'}, status=400)

    if not usn or not password:
        return JsonResponse({'error': 'USN and password are required'}, status=400)

    if not validate_usn(usn):
        return JsonResponse({'error': 'Invalid USN format'}, status=400)

    if login_collection.find_one({"usn": usn}):
        return JsonResponse({'error': 'USN already registered'}, status=409)

    hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    login_collection.insert_one({
        "usn": usn,
        "password": hashed_password
    })

    return JsonResponse({"message": "Signup successful"}, status=201)


@csrf_exempt
def get_registered_subjects(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST allowed'}, status=405)
    try:
        # Parse request body
        try:
            data = json.loads(request.body)
            usn = data.get('usn')
            logger.debug(f"Received USN: {usn}")
        except json.JSONDecodeError as e:
            logger.warning(f"JSON decode error: {e}")
            return JsonResponse({'error': 'Invalid JSON in request body'}, status=400)
            
        if not usn:
            return JsonResponse({'error': 'USN is required'}, status=400)

        if not validate_usn(usn):
            return JsonResponse({'error': 'Invalid USN format'}, status=400)

        # Find all records for this student using module-level collection
        student_records = list(collection.find({"usn": usn}))
        logger.debug(f"Found {len(student_records)} records for USN: {usn}")
        
        if not student_records:
            return JsonResponse({'subjects': []})  # Empty subjects array
        
        # Group by subject and collect exam types
        subject_data = {}
        for record in student_records:
            if "subject" in record and record["subject"]:
                subject_name = record["subject"]
                exam_type = record.get("exam_type", "Unknown")
                
                if subject_name not in subject_data:
                    # Initialize subject data structure
                    subject_data[subject_name] = {
                        "subject": subject_name,
                        "sem": "1",  # Default value, adjust if you have semester info
                        "paperTypes": []
                    }
                
                # Add exam type if it doesn't exist already
                if exam_type not in subject_data[subject_name]["paperTypes"]:
                    subject_data[subject_name]["paperTypes"].append(exam_type)
        
        # Extract simple subject names for DashboardPage
        subject_names = list(subject_data.keys())
        
        # Convert subject_data to list for SubjectPage
        subjects_with_details = list(subject_data.values())
        
        # The response format that works for both components
        response_data = {
            'subjects': subject_names,
            'subjectsData': subjects_with_details
        }
        
        logger.debug(f"Response data: {response_data}")
        return JsonResponse(response_data)

    except Exception as e:
        logger.error(f"Error in get_registered_subjects: {str(e)}", exc_info=True)
        return JsonResponse({'error': str(e)}, status=500)


def save_student_feedback(payload: dict) -> tuple[bool, str]:
    """Persist graded feedback and answer sheets to MongoDB.

    Called directly by ImagetoText (no HTTP round-trip).
    Payload keys: usn, subject, exam_type, feedback (list), answer_sheets (list).
    Returns (success, message).
    """
    try:
        usn        = payload.get('usn', '')
        subject    = payload.get('subject', '')
        exam_type  = payload.get('exam_type', '')

        if not validate_usn(usn):
            return False, 'Invalid USN'

        feedbacks_raw = payload.get('feedback')
        if feedbacks_raw is None or not isinstance(feedbacks_raw, list):
            return False, "'feedback' must be a non-null list"

        feedbacks = [
            {
                'qno':     item.get('qno', item.get('index', 0) + 1),
                'question': item['question'],
                'answer':   item.get('answer', ''),
                'feedback': item.get('feedback', ''),
                'score':    item.get('score', 0),
                'total':    int(item.get('total', 0)),
                # Extended assessment fields
                'correctness_assessment':   item.get('correctness_assessment', ''),
                'completeness_assessment':  item.get('completeness_assessment', ''),
                'relevance_assessment':     item.get('relevance_assessment', ''),
                'depth_assessment':         item.get('depth_assessment', ''),
                'correct_points_found':     item.get('correct_points_found', []),
                'missing_points':           item.get('missing_points', []),
                'incorrect_points':         item.get('incorrect_points', []),
                'partial_credit_reasoning': item.get('partial_credit_reasoning', ''),
                'confidence':               item.get('confidence', ''),
                'used_rag_reference':       item.get('used_rag_reference', False),
            }
            for item in feedbacks_raw
            if 'question' in item and 'feedback' in item
        ]

        answer_sheets = payload.get('answer_sheets', [])
        if not isinstance(answer_sheets, list):
            answer_sheets = []

        collection.update_one(
            {"usn": usn, "subject": subject, "exam_type": exam_type},
            {"$set": {
                "usn":          usn,
                "subject":      subject,
                "exam_type":    exam_type,
                "feedbacks":    feedbacks,
                "answer_sheets": answer_sheets,
                "submitted_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
        logger.info(f"save_student_feedback: saved {len(feedbacks)} feedbacks for {usn}/{subject}/{exam_type}")
        return True, 'Feedbacks saved successfully'

    except Exception as e:
        logger.error(f"save_student_feedback error: {e}", exc_info=True)
        return False, str(e)


# ---- Add or Get Feedback & Marks ----
@csrf_exempt
def add_or_get_feedback_marks(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            usn = data['usn']
            subject = data['subject']
            exam_type = data['exam_type']  # e.g., 'CIE' or 'SEE'
            
            # Delegate entirely to the shared helper
            ok, msg = save_student_feedback(data)
            if ok:
                return JsonResponse({'message': msg})
            return JsonResponse({'error': msg}, status=400)

        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)

    elif request.method == 'GET':
        usn = request.GET.get("usn")
        subject = request.GET.get("subject")
        exam_type = request.GET.get("exam_type")

        if not validate_usn(usn):
            return JsonResponse({'error': 'Invalid USN'}, status=400)

        # Find the document matching the query criteria
        query = {
            "usn": usn,
            "subject": subject,
            "exam_type": exam_type
        }
        
        result = collection.find_one(query, {"_id": 0})
        if not result:
            return JsonResponse({'error': 'Not found'}, status=404)

        # Return the feedbacks array
        return JsonResponse({

            "feedbacks": result.get("feedbacks", [])
        })



# ---- Get Answer Sheets (images) ----
@csrf_exempt
def get_answer_sheets(request):
    """Return the stored base64 answer sheet images for a student's exam submission."""
    if request.method != 'GET':
        return JsonResponse({'error': 'Only GET allowed'}, status=405)

    usn       = request.GET.get('usn', '').strip()
    subject   = request.GET.get('subject', '').strip()
    exam_type = request.GET.get('exam_type', '').strip()

    if not validate_usn(usn):
        return JsonResponse({'error': 'Invalid USN'}, status=400)
    if not subject or not exam_type:
        return JsonResponse({'error': 'subject and exam_type are required'}, status=400)

    result = collection.find_one(
        {"usn": usn, "subject": subject, "exam_type": exam_type},
        {"_id": 0, "answer_sheets": 1}
    )
    if not result:
        return JsonResponse({'answer_sheets': []})

    return JsonResponse({'answer_sheets': result.get('answer_sheets', [])})
