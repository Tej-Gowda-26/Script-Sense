from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.conf import settings
import pymongo
from bson import Binary
import json

# ── Teacher-only endpoint ──────────────────────────────────────────────────
client = pymongo.MongoClient(settings.MONGO_URI)
db = client['ScriptSense']
question_papers_collection = db['QuestionPaper']

@csrf_exempt
@require_http_methods(["POST"])
def upload_question_paper_json(request):
    try:
        questions_json = request.POST.get('questions')
        if not questions_json:
            return JsonResponse({'error': 'Missing questions field.'}, status=400)

        questions = json.loads(questions_json)
        if not isinstance(questions, list):
            return JsonResponse({'error': 'Questions must be a list.'}, status=400)

        exam_type = request.POST.get('exam_type')
        subject   = request.POST.get('subject')
        if not exam_type or not subject:
            return JsonResponse({'error': 'Missing exam_type or subject field.'}, status=400)

        processed_questions = []

        for q in questions:
            qno           = q.get('qno')
            question_text = q.get('question')
            marks         = q.get('marks', 10)
            diagram_marks = q.get('diagram_marks')   # optional — None when no diagram

            if qno is None or not question_text:
                return JsonResponse(
                    {'error': f'Missing fields in question {qno}.'},
                    status=400
                )

            if diagram_marks is not None:
                try:
                    diagram_marks = int(diagram_marks)
                except (ValueError, TypeError):
                    return JsonResponse(
                        {'error': f'diagram_marks for Q{qno} must be an integer.'},
                        status=400
                    )
                if diagram_marks < 1 or diagram_marks >= int(marks):
                    return JsonResponse(
                        {'error': f'diagram_marks for Q{qno} must be between 1 and {int(marks) - 1}.'},
                        status=400
                    )
                # A reference diagram image is required when diagram_marks is set.
                if not request.FILES.get(f'image_{qno}'):
                    return JsonResponse(
                        {'error': (
                            f'Q{qno} has diagram_marks set but no reference image was uploaded. '
                            f'Please upload a reference diagram image (image_{qno}).'
                        )},
                        status=400
                    )

            image_file = request.FILES.get(f'image_{qno}')
            image_data = None
            if image_file:
                image_data = {
                    'filename':     image_file.name,
                    'content_type': image_file.content_type,
                    'data':         Binary(image_file.read()),
                }

            processed_questions.append({
                'qno':           str(qno),   # stored as string: "1", "2a", "2b", …
                'question':      question_text,
                'marks':         int(marks),
                'diagram_marks': diagram_marks,  # None when no diagram
                'image':         image_data,
            })

        # 3. Upsert — one document per subject/exam_type; stale versions overwritten.
        result = question_papers_collection.replace_one(
            filter      = {'exam_type': exam_type, 'subject': subject},
            replacement = {
                'exam_type': exam_type,
                'subject':   subject,
                'questions': processed_questions,
            },
            upsert=True,
        )

        doc_id = str(result.upserted_id) if result.upserted_id else 'updated'
        return JsonResponse(
            {'message': f'Question paper saved ({len(processed_questions)} questions).', 'id': doc_id},
            status=201,
        )

    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON format.'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
