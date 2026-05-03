from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.conf import settings
import pymongo
from bson import Binary
import json

client = pymongo.MongoClient(settings.MONGO_URI)
db = client['ScriptSense']
question_papers_collection = db['QuestionPaper']

@csrf_exempt
@require_http_methods(["POST"])
def upload_question_paper_json(request):
    try:
        # ── 1. Parse request ────────────────────────────────────────────────
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

        # ── 2. Build processed questions list ───────────────────────────────
        processed_questions = []

        for q in questions:
            qno          = q.get('qno')
            question_text = q.get('question')
            marks        = q.get('marks', 10)

            if qno is None or not question_text:
                return JsonResponse(
                    {'error': f'Missing fields in question {qno}.'},
                    status=400
                )

            # Optional reference diagram image for this question
            image_file = request.FILES.get(f'image_{qno}')
            image_data = None
            if image_file:
                image_data = {
                    'filename':     image_file.name,
                    'content_type': image_file.content_type,
                    'data':         Binary(image_file.read()),
                }

            # !! append INSIDE the for loop — one entry per question !!
            processed_questions.append({
                'qno':      str(qno),   # stored as string: "1", "2a", "2b", …
                'question': question_text,
                'marks':    int(marks),
                'image':    image_data,
            })

        # ── 3. Upsert into MongoDB ──────────────────────────────────────────
        # replace_one + upsert=True keeps exactly ONE document per
        # subject/exam_type so stale old versions never accumulate.
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
