import requests
import json
import re
import time
import logging
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

logger = logging.getLogger(__name__)

# Max RAG context characters sent per question (keeps prompts within Groq token limits)
MAX_RAG_CHARS = 4000
# Delay between sequential Groq calls to stay under tokens-per-minute limits
INTER_QUESTION_DELAY = 0.6   # seconds
# Model fallback chain — tried in order when a rate limit is hit
# Primary: large, high quality. Fallback: smaller, 5× higher daily quota.
# Model chain for text-only grading (high quality text models)
GROQ_MODEL_CHAIN = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
]

# Model chain for visual (diagram) grading — MUST be vision-capable models.
# Only llama-4-scout is available as a vision model on Groq's on-demand tier.
# If it's exhausted the grader falls back to text-only (see grade_questions).
GROQ_VISION_MODEL_CHAIN = [
    "meta-llama/llama-4-scout-17b-16e-instruct",
]

# Minimum OCR characters to consider a student has written a theory answer
_HAS_THEORY_THRESHOLD = 50

# Question starters that signal the question ONLY asks for a diagram (no theory expected)
_DIAGRAM_ONLY_STARTERS = (
    'draw ', 'draw a ', 'draw the ', 'sketch ', 'sketch the ',
    'neat sketch of', 'neat diagram of', 'construct a diagram',
    'represent diagrammatically', 'show the figure', 'label the',
    'make a diagram', 'prepare a neat sketch', 'prepare a neat diagram',
)


def _is_diagram_only(question_text: str) -> bool:
    """Return True when the question primarily asks for a drawn figure with no theory."""
    lower = question_text.lower().strip()
    return any(lower.startswith(kw) for kw in _DIAGRAM_ONLY_STARTERS)

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


def _build_user_prompt(question, answer, total_marks, retrieved_context=None, has_diagram=False):
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

    diagram_block = ""
    if has_diagram:
        diagram_block = """

## Diagram Grading
This question includes a diagram. The reference diagram (correct answer) and the student's drawn diagram are attached as images after this text.
Evaluate BOTH:
1. The visual diagram: check structure, labels, connections, completeness against the reference.
2. The written/text description: check conceptual accuracy and explanations.
Award marks for correct visual elements even if the text is incomplete, and vice versa.
Provide a single holistic score that reflects both dimensions."""

    return f"""## Question
{question}

## Student Answer
{answer_text}

## Marks Allotted
{total_marks}{rag_block}{diagram_block}

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

        # Diagram images
        ref_b64             = q.get('reference_image_b64', '')
        student_b64         = q.get('student_diagram_b64', '')
        has_ref_diagram     = bool(ref_b64)
        has_student_diagram = bool(student_b64)
        has_diagram  = False   # resolved below after routing
        marks_scale  = 1.0    # penalty multiplier (1.0 = no deduction)
        penalty_note = ''     # appended to student feedback if marks are capped

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

        # ── Diagram routing ──────────────────────────────────────────────────
        # Determine: (a) whether question is diagram-only or theory+diagram,
        # (b) what the student actually submitted, and (c) how to grade + penalise.
        has_theory_answer = len(answer_text_check) > _HAS_THEORY_THRESHOLD

        if has_ref_diagram:
            if _is_diagram_only(question):
                # ── Case A: question asks ONLY for a diagram ─────────────────
                if not has_student_diagram:
                    # No diagram found → hard zero
                    logger.info(f"Q{idx+1}: Diagram-only question with no student diagram → 0 marks")
                    results.append({
                        'index': idx,
                        'qno':   q.get('qno', idx + 1),
                        'question': question,
                        'answer':   '',
                        'score': 0,
                        'total': total_marks,
                        'feedback': 'The question required a diagram, but no diagram was detected in your answer sheet.',
                        'correctness_assessment':   'No diagram provided.',
                        'completeness_assessment':  'Diagram is absent.',
                        'relevance_assessment':     'Cannot assess — no diagram.',
                        'depth_assessment':         'Cannot assess — no diagram.',
                        'correct_points_found':     [],
                        'missing_points':           ['Required diagram was not drawn.'],
                        'incorrect_points':         [],
                        'partial_credit_reasoning': 'Zero marks awarded because this question exclusively requires a diagram and none was detected.',
                        'confidence': 'high',
                        'used_rag_reference': False,
                    })
                    if idx < len(questions) - 1:
                        time.sleep(INTER_QUESTION_DELAY)
                    continue
                else:
                    # Diagram present → grade visually
                    has_diagram = True

            else:
                # ── Case B: question requires BOTH theory AND diagram ─────────
                if has_theory_answer and has_student_diagram:
                    # Both present → full multimodal grading
                    has_diagram = True
                    logger.info(f"Q{idx+1}: Theory + diagram both present → full multimodal grading")

                elif has_theory_answer and not has_student_diagram:
                    # Theory written, diagram missing → deduct 40 %
                    has_diagram  = False
                    marks_scale  = 0.6
                    penalty_note = '40% marks deducted for missing diagram.'
                    logger.info(f"Q{idx+1}: Theory present but no diagram → capping at 60% of marks")

                elif has_student_diagram and not has_theory_answer:
                    # Diagram drawn, no theory → deduct 50 %
                    has_diagram  = True
                    marks_scale  = 0.5
                    penalty_note = '50% marks deducted for missing written theory.'
                    logger.info(f"Q{idx+1}: Diagram present but no theory → capping at 50% of marks")

                # else: both absent — handled by the empty-answer guard above
        # If no ref_diagram exists, has_diagram stays False → normal text grading
        # ────────────────────────────────────────────────────────────────────────────

        user_prompt = _build_user_prompt(question, answer, total_marks, retrieved_context, has_diagram=has_diagram)

        # Build message content — multimodal if diagram images are present, text-only otherwise
        if has_diagram:
            user_content = [
                {"type": "text",      "text": user_prompt},
                {"type": "text",      "text": "Reference Diagram (correct answer):"},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{ref_b64}"}},
                {"type": "text",      "text": "Student's Drawn Diagram:"},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{student_b64}"}},
            ]
            logger.info(f"Q{idx+1}: Using multimodal grading (text + reference diagram + student diagram)")
        else:
            user_content = user_prompt

        headers = {
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
            "Content-Type": "application/json"
        }

        content = None
        groq_response = None

        # Select model chain: vision-capable models for diagram questions,
        # high-quality text models for text-only questions.
        model_chain = GROQ_VISION_MODEL_CHAIN if has_diagram else GROQ_MODEL_CHAIN

        # Try each model in the fallback chain
        for model_name in model_chain:
            payload = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": GRADING_SYSTEM_PROMPT},
                    {"role": "user",   "content": user_content}
                ],
                "temperature": 0.2,
                "max_tokens": 1024,
            }

            try:
                groq_response = requests.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=60,
                )
            except requests.RequestException as e:
                logger.error(f"Q{idx+1} [{model_name}]: request exception: {e}")
                groq_response = None
                continue  # try next model

            if groq_response.status_code == 200:
                if model_name != model_chain[0]:
                    logger.warning(f"Q{idx+1}: graded with fallback model '{model_name}'")
                break  # success

            # Parse and log the error
            try:
                err_body = groq_response.json()
            except Exception:
                err_body = groq_response.text

            err_str = str(err_body)
            is_429   = groq_response.status_code == 429
            is_tpd   = 'tokens per day' in err_str.lower() or 'tpd' in err_str.lower()
            is_tpm   = is_429 and not is_tpd

            logger.error(f"Q{idx+1} [{model_name}]: HTTP {groq_response.status_code}: {err_str[:300]}")

            if is_tpd:
                # Daily quota exhausted — no point retrying same model; move to fallback
                logger.warning(f"Q{idx+1} [{model_name}]: TPD limit hit — trying next model in chain")
                groq_response = None
                continue

            if is_tpm:
                # Per-minute rate limit — short wait then retry SAME model (not fallback)
                logger.warning(f"Q{idx+1} [{model_name}]: TPM limit — waiting 5s")
                time.sleep(5)
                try:
                    groq_response = requests.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        json=payload, headers=headers, timeout=60,
                    )
                except requests.RequestException:
                    groq_response = None
                if groq_response and groq_response.status_code == 200:
                    break
                # Still failing — try next model
                groq_response = None
                continue

            # Any other non-200 error — try next model in chain rather than failing immediately
            # (e.g. a 404 "model not found" should not silently drop the question)
            is_model_error = groq_response.status_code in (404, 400)
            if is_model_error:
                logger.warning(f"Q{idx+1} [{model_name}]: {groq_response.status_code} error — trying next model")
                groq_response = None
                continue

            # Unrecoverable error (auth, server error, etc.) — stop retrying
            results.append({
                'index': idx, 'error': 'Groq API error',
                'details': err_body, 'status_code': groq_response.status_code
            })
            groq_response = None
            break

        if groq_response is None or groq_response.status_code != 200:
            # If this was a vision attempt and the chain is exhausted,
            # degrade gracefully to text-only rather than emitting a zero-score error.
            if has_diagram:
                logger.warning(
                    f"Q{idx+1}: Vision model unavailable — retrying as text-only (diagram quality not assessed)"
                )
                # Re-grade without images using the text model chain
                text_prompt   = _build_user_prompt(question, answer, total_marks, retrieved_context, has_diagram=False)
                text_response = None
                for tm in GROQ_MODEL_CHAIN:
                    try:
                        text_response = requests.post(
                            "https://api.groq.com/openai/v1/chat/completions",
                            json={
                                "model": tm,
                                "messages": [
                                    {"role": "system", "content": GRADING_SYSTEM_PROMPT},
                                    {"role": "user",   "content": text_prompt},
                                ],
                                "temperature": 0.2,
                                "max_tokens": 1024,
                            },
                            headers=headers, timeout=60,
                        )
                        if text_response.status_code == 200:
                            break
                    except requests.RequestException:
                        pass
                if text_response and text_response.status_code == 200:
                    groq_response = text_response
                    penalty_note  = (
                        (penalty_note + " " if penalty_note else "") +
                        "[Diagram quality could not be assessed — vision model unavailable; graded on written text only.]"
                    )
                    marks_scale = min(marks_scale, 0.6)  # cap at 60 % when diagram unverified
                    # Continue to the normal JSON-parsing block below
                else:
                    # Text fallback also failed — last resort placeholder
                    if not any(r.get('index') == idx for r in results):
                        results.append({'index': idx, 'error': 'Groq API error after all retries (vision + text)'})
                    if idx < len(questions) - 1:
                        time.sleep(INTER_QUESTION_DELAY)
                    continue
            else:
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
            # Apply partial-answer penalty (diagram or theory missing)
            marks_awarded = round(marks_awarded * marks_scale, 1)

            answer_str = ' '.join(answer) if isinstance(answer, list) else str(answer)

            base_feedback = grading.get('final_feedback', '')
            final_feedback = f"{base_feedback} [{penalty_note}]" if penalty_note else base_feedback

            results.append({
                'index': idx,
                'qno':   q.get('qno', idx + 1),
                'question': question,
                'answer':   answer_str,
                'score':    marks_awarded,
                'total':    total_marks,
                'feedback': final_feedback,
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
