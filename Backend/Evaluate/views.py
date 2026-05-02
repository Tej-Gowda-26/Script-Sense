import requests
import json
import re
import time
import logging
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

logger = logging.getLogger(__name__)

# Max RAG context characters sent per question (keeps prompts within Groq TPM limits)
MAX_RAG_CHARS = 4000
# Delay between sequential Groq calls to stay under tokens-per-minute limits
INTER_QUESTION_DELAY = 0.6   # seconds
# Max retries on 429 rate-limit response
GROQ_MAX_RETRIES = 3

# ---------------------------------------------------------------------------
# System prompt — encodes the full grading philosophy
# ---------------------------------------------------------------------------
GRADING_SYSTEM_PROMPT = """You are an expert academic examiner. Your job is to evaluate a student's written answer to a given question and award marks fairly using nuanced, human-like judgment.

## Core Grading Philosophy
- Do NOT use binary thinking (correct/incorrect only).
- Accept multiple valid answer styles, depths, and wordings.
- A short answer may still be fully correct.
- A long answer may still be only partially correct.
- A partially correct answer MUST receive partial marks.
- A relevant but incomplete answer MUST still receive some marks.
- A wrong or off-topic answer receives low or zero marks.
- Do NOT penalize harmless wording differences.
- Do NOT require exact similarity to any reference text.

## RAG Context (if provided)
- Treat retrieved context ONLY as a supporting reference — NOT as the model answer.
- Do NOT reward or penalize based only on overlap with the retrieved context.
- If RAG is missing, weak, or irrelevant, IGNORE it and grade using the student answer and your own knowledge.
- Never force the student answer to match RAG wording.

## How to Judge
For every answer, evaluate:
1. Correctness — which parts are factually right or wrong?
2. Completeness — which key ideas are present or missing?
3. Relevance — does the answer address the question?
4. Depth — is the answer shallow, adequate, or insightful?
5. Partial Credit — how much of the concept is demonstrated even if incomplete?

## Scoring Rules
- Award marks for correct concepts even if the answer is not fully complete.
- Deduct marks only for wrong, missing, irrelevant, or unsupported content.
- If the answer contains both correct and incorrect parts, award credit for the correct parts and reduce credit for the incorrect parts.
- If the answer is fully off-topic, give little or no marks.
- If the answer is too brief but conceptually correct, do not over-penalize.
- If the answer is detailed but has some inaccuracies, score the good parts and subtract for the bad.

## Output Format
Return ONLY a valid JSON object with EXACTLY these fields — no extra text:
{
  "marks_awarded": <number, can be decimal e.g. 6.5>,
  "max_marks": <integer>,
  "correctness_assessment": "<one concise sentence>",
  "completeness_assessment": "<one concise sentence>",
  "relevance_assessment": "<one concise sentence>",
  "depth_assessment": "<one concise sentence>",
  "correct_points_found": ["<point1>", "<point2>"],
  "missing_points": ["<point1>", "<point2>"],
  "incorrect_points": ["<point1>", "<point2>"],
  "partial_credit_reasoning": "<explanation of how partial marks were calculated>",
  "final_feedback": "<constructive, student-facing feedback>",
  "confidence": "<high|medium|low>",
  "used_rag_reference": <true|false>
}"""


def _build_user_prompt(question, answer, total_marks, retrieved_context=None):
    """Build the per-question user-turn message."""
    if isinstance(answer, list):
        answer_text = " ".join(str(a) for a in answer)
    else:
        answer_text = str(answer)

    has_rag = bool(retrieved_context and str(retrieved_context).strip())

    rag_block = ""
    if has_rag:
        rag_block = f"""
## Retrieved Reference Context (use as supporting reference only — not as the model answer)
{retrieved_context}"""

    return f"""## Question
{question}

## Student Answer
{answer_text}

## Marks Allotted
{total_marks}{rag_block}

Grade the student answer fairly. Award partial marks where applicable. Return the result as a single JSON object matching the required output format exactly."""


def _as_list(val):
    """Coerce model output to a clean list of strings."""
    if isinstance(val, list):
        return [str(v) for v in val if str(v).strip()]
    if isinstance(val, str) and val.strip():
        return [val.strip()]
    return []


# ---------------------------------------------------------------------------
# Core grading function — importable directly by other Django apps
# ---------------------------------------------------------------------------
def grade_questions(questions: list, default_total=None) -> list:
    """Grade a list of questions by calling Groq directly (no internal HTTP).

    Each item in *questions* must contain:
        question (str), answer (str | list)
        total_marks (int)  OR rely on default_total
    Optional:
        retrieved_context (str), qno (int)

    Returns a list of result dicts with the same shape as the
    evaluate_answer JSON response.
    """
    results = []

    for idx, q in enumerate(questions):
        question          = q.get('question')
        answer            = q.get('answer')
        retrieved_context = q.get('retrieved_context', '')
        # Truncate RAG context to keep total prompt tokens manageable
        if retrieved_context and len(retrieved_context) > MAX_RAG_CHARS:
            retrieved_context = retrieved_context[:MAX_RAG_CHARS] + "\n... [context truncated]"
        total_marks       = q.get('total_marks') or default_total

        if not question or not total_marks:
            results.append({
                'index': idx,
                'error': 'Missing one or more required fields (question, total_marks)'
            })
            continue

        # --- Guard: empty / whitespace-only answer ---
        answer_text_check = (
            ' '.join(answer).strip() if isinstance(answer, list) else str(answer).strip()
        )
        if not answer_text_check or answer_text_check.lower() in ('no answer extracted', 'none', 'n/a', ''):
            results.append({
                'index': idx,
                'qno':   q.get('qno', idx + 1),
                'question': question,
                'answer':   answer_text_check,
                'score': 0,
                'total': int(total_marks) if str(total_marks).isdigit() else 0,
                'feedback': 'No answer was provided for this question.',
                'correctness_assessment':   'No answer provided.',
                'completeness_assessment':  'Answer is absent.',
                'relevance_assessment':     'Cannot assess — no answer.',
                'depth_assessment':         'Cannot assess — no answer.',
                'correct_points_found':     [],
                'missing_points':           ['Full answer required.'],
                'incorrect_points':         [],
                'partial_credit_reasoning': 'Zero marks awarded because no answer was detected.',
                'confidence':               'high',
                'used_rag_reference':       False,
            })
            continue

        try:
            total_marks = int(total_marks)
        except (ValueError, TypeError):
            results.append({'index': idx, 'error': 'total_marks must be an integer'})
            continue

        user_prompt = _build_user_prompt(question, answer, total_marks, retrieved_context)

        headers = {
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "llama-3.3-70b-versatile",
            "messages": [
                {"role": "system", "content": GRADING_SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt}
            ],
            "temperature": 0.2,
            "max_tokens": 1024,
        }

        content = None
        groq_response = None

        for attempt in range(1, GROQ_MAX_RETRIES + 1):
            try:
                groq_response = requests.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=60,
                )
            except requests.RequestException as e:
                logger.error(f"Q{idx+1}: Groq request exception (attempt {attempt}): {e}")
                if attempt == GROQ_MAX_RETRIES:
                    results.append({'index': idx, 'error': f'Groq API request failed: {str(e)}'})
                    break
                time.sleep(2 ** attempt)  # 2s, 4s backoff
                continue

            if groq_response.status_code == 200:
                break  # success

            # Log the exact Groq error
            try:
                err_body = groq_response.json()
            except Exception:
                err_body = groq_response.text
            logger.error(f"Q{idx+1}: Groq HTTP {groq_response.status_code} (attempt {attempt}): {err_body}")

            if groq_response.status_code == 429 and attempt < GROQ_MAX_RETRIES:
                wait = 2 ** attempt          # 2s, 4s
                logger.warning(f"Q{idx+1}: Rate limited — waiting {wait}s before retry {attempt+1}/{GROQ_MAX_RETRIES}")
                time.sleep(wait)
                continue

            # Non-retryable error
            results.append({
                'index': idx,
                'error': 'Groq API error',
                'details': err_body,
                'status_code': groq_response.status_code
            })
            groq_response = None   # signal failure to outer code
            break
        else:
            # Exhausted retries without a successful response
            groq_response = None

        if groq_response is None or groq_response.status_code != 200:
            # Error already appended inside the loop
            if not any(r.get('index') == idx for r in results):
                results.append({'index': idx, 'error': 'Groq API error after all retries'})
            # Delay before next question even after failure
            if idx < len(questions) - 1:
                time.sleep(INTER_QUESTION_DELAY)
            continue

        response = groq_response

        try:
            content = response.json()['choices'][0]['message']['content']

            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if not json_match:
                logger.warning(f"Q{idx+1}: Model response not in JSON format. Raw: {content[:200]}")
                results.append({
                    'index': idx,
                    'error': 'Model response not in expected JSON format',
                    'response': content
                })
                if idx < len(questions) - 1:
                    time.sleep(INTER_QUESTION_DELAY)
                continue

            grading = json.loads(json_match.group(0))

            marks_awarded = float(grading.get('marks_awarded', 0))
            marks_awarded = max(0.0, min(marks_awarded, float(total_marks)))

            answer_str = ' '.join(answer) if isinstance(answer, list) else str(answer)

            results.append({
                'index': idx,
                'qno':   q.get('qno', idx + 1),
                'question': question,
                'answer':   answer_str,
                'score':    round(marks_awarded, 1),
                'total':    total_marks,
                'feedback': grading.get('final_feedback', ''),
                'correctness_assessment':   grading.get('correctness_assessment', ''),
                'completeness_assessment':  grading.get('completeness_assessment', ''),
                'relevance_assessment':     grading.get('relevance_assessment', ''),
                'depth_assessment':         grading.get('depth_assessment', ''),
                'correct_points_found':     _as_list(grading.get('correct_points_found')),
                'missing_points':           _as_list(grading.get('missing_points')),
                'incorrect_points':         _as_list(grading.get('incorrect_points')),
                'partial_credit_reasoning': grading.get('partial_credit_reasoning', ''),
                'confidence':               grading.get('confidence', 'medium'),
                'used_rag_reference':       bool(grading.get('used_rag_reference', False)),
            })

        except Exception as e:
            logger.error(f"Q{idx+1}: Parse/processing exception: {e}")
            answer_str = ' '.join(answer) if isinstance(answer, list) else str(answer or '')
            results.append({
                'index': idx,
                'qno':   q.get('qno', idx + 1),
                'question': question,
                'answer':   answer_str,
                'score':    0,
                'total':    total_marks if isinstance(total_marks, int) else 0,
                'feedback': 'Grading could not be completed for this question. Please review manually.',
                'correctness_assessment':   '',
                'completeness_assessment':  '',
                'relevance_assessment':     '',
                'depth_assessment':         '',
                'correct_points_found':     [],
                'missing_points':           [],
                'incorrect_points':         [],
                'partial_credit_reasoning': '',
                'confidence':               'low',
                'used_rag_reference':       False,
                '_parse_error':    str(e),
                '_raw_response':   content,
            })

        # Small delay between questions to stay under Groq TPM limits
        if idx < len(questions) - 1:
            time.sleep(INTER_QUESTION_DELAY)

    return results


# ---------------------------------------------------------------------------
# HTTP endpoint — thin wrapper for external / testing use
# ---------------------------------------------------------------------------
@csrf_exempt
def evaluate_answer(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST method is allowed'}, status=405)

    try:
        data          = json.loads(request.body)
        questions     = data.get('questions')
        default_total = data.get('total')

        if not questions or not isinstance(questions, list):
            return JsonResponse({'error': 'Missing or invalid "questions" array'}, status=400)
    except Exception as e:
        return JsonResponse({'error': 'Invalid JSON payload', 'details': str(e)}, status=400)

    results = grade_questions(questions, default_total)
    return JsonResponse({'results': results})
