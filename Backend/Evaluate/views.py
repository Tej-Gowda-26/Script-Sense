import requests
import json
import re
import time
import logging
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

logger = logging.getLogger(__name__)

# Max RAG context characters injected per question prompt
MAX_RAG_CHARS = 4000

# Adaptive inter-question delay: longer after a TPM 429 hit.
INTER_QUESTION_DELAY_NORMAL    = 0.3
INTER_QUESTION_DELAY_AFTER_429 = 0.6

# Text model chain — tried in order on rate-limit.
GROQ_MODEL_CHAIN = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
]

# Vision model chain — falls back to text-only if all models are exhausted.
GROQ_VISION_MODEL_CHAIN = [
    "meta-llama/llama-4-scout-17b-16e-instruct",
]

# Minimum OCR chars before a response is treated as a real theory answer.
_HAS_THEORY_THRESHOLD = 50

# Question starters that signal the question ONLY asks for a diagram (no theory expected)
_DIAGRAM_ONLY_STARTERS = (
    'draw ', 'draw a ', 'draw the ', 'sketch ', 'sketch the ',
    'neat sketch of', 'neat diagram of', 'construct a diagram',
    'represent diagrammatically', 'show the figure', 'label the',
    'make a diagram', 'prepare a neat sketch', 'prepare a neat diagram',
)


def _parse_retry_after(err_str: str, default: float = 12.0) -> float:
    """Extract the wait time (seconds) from a Groq 429 error message.

    Groq 429 bodies include text like "Please try again in 365ms", "9.888s",
    or "1m30s".  Returns the parsed duration plus a small safety buffer, or
    *default* if the pattern is absent.

    NOTE: "365ms" must NOT be mis-read as "365 minutes" — we check for the
    explicit 'ms' suffix first, before the minutes pattern.
    """
    # Check for milliseconds first (e.g. "365ms") to avoid confusing the "m"
    # in "ms" with the minutes group in the pattern below.
    ms_match = re.search(r'try again in\s+([\d.]+)\s*ms', err_str, re.IGNORECASE)
    if ms_match:
        wait_ms = float(ms_match.group(1))
        # Add a 0.5 s safety buffer and clamp to a sane maximum (60 s)
        return min(wait_ms / 1000.0 + 0.5, 60.0)

    # Seconds / minutes pattern: "9.888s" or "1m30s"
    m = re.search(r'try again in\s+(?:(\d+)m)?\s*(?:([\d.]+)s)?', err_str, re.IGNORECASE)
    if m:
        total = float(m.group(1) or 0) * 60 + float(m.group(2) or 0)
        if total > 0:
            return total + 2.0
    return default


def _is_diagram_only(question_text: str) -> bool:
    """Return True when the question primarily asks for a drawn figure with no theory."""
    lower = question_text.lower().strip()
    return any(lower.startswith(kw) for kw in _DIAGRAM_ONLY_STARTERS)

# System prompts
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

GRADING_SYSTEM_PROMPT_SPLIT = """You are an expert academic examiner. Your job is to evaluate a student's written answer and their drawn diagram SEPARATELY, then award marks for each component fairly.

## Core Grading Philosophy
- Do NOT use binary thinking (correct/incorrect only).
- Award partial marks wherever a component is partially correct.
- Do NOT penalize harmless wording or drawing differences.
- Do NOT require exact similarity to any reference text or diagram.

## How to Judge Each Component

### Written/Text Answer
- Correctness — which parts are factually right or wrong?
- Completeness — which key ideas are present or missing?
- Relevance — does the answer address the question?
- Depth — is the answer shallow, adequate, or insightful?

### Diagram
- Structure — are major components drawn correctly?
- Labels — are labels present and accurate?
- Connections — are relationships between parts correct?
- Completeness — are key elements missing?

## Output Format
Return ONLY a valid JSON object with EXACTLY these fields — no extra text:
{
  "text_marks_awarded": <number out of text_max_marks, can be decimal>,
  "diagram_marks_awarded": <number out of diagram_max_marks, can be decimal>,
  "max_marks": <total marks = text_max_marks + diagram_max_marks>,
  "correctness_assessment": "<one concise sentence about the written answer>",
  "completeness_assessment": "<one concise sentence>",
  "relevance_assessment": "<one concise sentence>",
  "depth_assessment": "<one concise sentence>",
  "diagram_assessment": "<one concise sentence about the drawn diagram>",
  "correct_points_found": ["<point1>", "<point2>"],
  "missing_points": ["<point1>", "<point2>"],
  "incorrect_points": ["<point1>", "<point2>"],
  "partial_credit_reasoning": "<explanation of how marks were split between text and diagram>",
  "final_feedback": "<constructive, student-facing feedback covering both text and diagram>",
  "confidence": "<high|medium|low>",
  "used_rag_reference": <true|false>
}"""

GRADING_SYSTEM_PROMPT_DIAGRAM_ONLY = """You are an expert academic examiner. Your job is to evaluate a student's HAND-DRAWN DIAGRAM against a reference diagram and award marks fairly.

This question ONLY requires a diagram — there is no written/text answer to assess.

## How to Judge the Diagram
- Structure — are major components drawn correctly?
- Labels — are labels present and accurate?
- Connections — are relationships between parts correct?
- Completeness — are key elements missing?

## Scoring Rules
- Award marks for correct visual elements even if the diagram is not perfect.
- Deduct marks only for wrong, missing, or incorrect parts.
- A partial diagram MUST receive partial marks.

## Output Format
Return ONLY a valid JSON object with EXACTLY these fields — no extra text:
{
  "marks_awarded": <number, can be decimal>,
  "max_marks": <integer>,
  "correctness_assessment": "<one concise sentence about overall correctness>",
  "completeness_assessment": "<one concise sentence about what is drawn vs missing>",
  "relevance_assessment": "<one concise sentence — is the diagram for the right topic?>",
  "depth_assessment": "<one concise sentence about diagram detail/quality>",
  "diagram_assessment": "<one concise sentence specifically about the drawn diagram>",
  "correct_points_found": ["<point1>", "<point2>"],
  "missing_points": ["<point1>", "<point2>"],
  "incorrect_points": ["<point1>", "<point2>"],
  "partial_credit_reasoning": "<explanation of how marks were calculated from the diagram>",
  "final_feedback": "<constructive, student-facing feedback about the diagram>",
  "confidence": "<high|medium|low>",
  "used_rag_reference": false
}"""


def _build_user_prompt(question, answer, total_marks, retrieved_context=None, has_diagram=False):
    """Build the user-turn prompt for holistic (legacy) grading mode."""
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


def _build_split_prompt(question, answer, theory_marks, diagram_marks_val, retrieved_context=None):
    """Build the user-turn prompt for split grading mode.

    The LLM is given explicit per-component budgets and returns
    'text_marks_awarded' and 'diagram_marks_awarded' separately.
    Images (reference + student diagram) are attached by the caller.
    """
    if isinstance(answer, list):
        answer_text = " ".join(str(a) for a in answer)
    else:
        answer_text = str(answer)

    rag_block = ""
    if retrieved_context and str(retrieved_context).strip():
        rag_block = f"""
## Retrieved Reference Context (use as supporting reference only)
{retrieved_context}"""

    return f"""## Question
{question}

## Student Answer
{answer_text}

## Mark Budget
- Written/text answer: {theory_marks} marks
- Diagram: {diagram_marks_val} marks
- Total: {theory_marks + diagram_marks_val} marks

The reference diagram (correct answer) and the student's drawn diagram are attached as images.
Please:
1. Grade the WRITTEN ANSWER out of {theory_marks} marks.
2. Grade the DRAWN DIAGRAM out of {diagram_marks_val} marks by comparing it against the reference.
3. Return 'text_marks_awarded' (out of {theory_marks}) and 'diagram_marks_awarded' (out of {diagram_marks_val}) separately.{rag_block}

Return the result as a single JSON object matching the required output format exactly."""


def _as_list(val):
    """Coerce model output to a clean list of strings."""
    if isinstance(val, list):
        return [str(v) for v in val if str(v).strip()]
    if isinstance(val, str) and val.strip():
        return [val.strip()]
    return []


# Core grading function — called directly by ImagetoText (no HTTP round-trip)
def grade_questions(questions: list, default_total=None) -> list:
    """Grade a list of questions via Groq (no internal HTTP round-trip).

    Each item in *questions* must contain:
        question (str), answer (str | list), total_marks (int)
    Optional: retrieved_context (str), qno, reference_image_b64,
              student_diagram_b64, diagram_marks

    Returns a list of result dicts (same shape as the evaluate_answer response).
    """
    results = []
    _rate_limited_last = False

    for idx, q in enumerate(questions):
        question          = q.get('question')
        answer            = q.get('answer')
        retrieved_context = q.get('retrieved_context', '')
        if retrieved_context and len(retrieved_context) > MAX_RAG_CHARS:
            retrieved_context = retrieved_context[:MAX_RAG_CHARS] + "\n... [context truncated]"
        total_marks       = q.get('total_marks') or default_total

        ref_b64             = q.get('reference_image_b64', '')
        student_b64         = q.get('student_diagram_b64', '')
        diagram_marks_val   = q.get('diagram_marks')   # None → legacy holistic mode
        has_ref_diagram     = bool(ref_b64)
        has_student_diagram = bool(student_b64)
        has_diagram    = False   # resolved in diagram routing below
        penalty_note   = ''     # appended to feedback on vision fallback
        use_split_mode = False   # True when teacher set diagram_marks

        # Detect diagram intent early so the empty-answer guard can be skipped
        # for diagram-only questions where the student drew (but wrote nothing).
        _is_diag_q_early = bool(ref_b64) or _is_diagram_only(question or '')

        if not question or not total_marks:
            results.append({
                'index': idx,
                'error': 'Missing one or more required fields (question, total_marks)'
            })
            continue

        answer_text_check = (
            ' '.join(answer).strip() if isinstance(answer, list) else str(answer).strip()
        )
        _no_text = (
            not answer_text_check
            or answer_text_check.lower() in ('no answer extracted', 'none', 'n/a', '')
        )
        # For diagram-only questions where the student has drawn something,
        # skip the empty-text early return — visual grading will handle it.
        # For all other question types an empty text answer is 0 marks.
        if _no_text and not (_is_diag_q_early and has_student_diagram):
            results.append({
                'index': idx,
                'qno':   q.get('qno', idx + 1),
                'question': question,
                'answer':   answer_text_check,
                'score': 0,
                'total': (lambda x: int(float(x)) if x is not None else 0)(total_marks),
                'feedback': 'No answer was provided for this question.',
                'correctness_assessment':   'No answer provided.',
                'completeness_assessment':  'Answer is absent.',
                'relevance_assessment':     'Cannot assess — no answer.',
                'depth_assessment':         'Cannot assess — no answer.',
                'diagram_assessment':       '',
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

        # Diagram routing: resolve grading mode (split vs legacy) and prompt structure.
        has_theory_answer = len(answer_text_check) > _HAS_THEORY_THRESHOLD

        # --- Step A: check diagram-only BEFORE checking has_ref_diagram ---
        # This ensures "Draw a diagram" questions always zero-out correctly even
        # when the teacher did not upload a reference image.
        if _is_diagram_only(question):
            if not has_student_diagram:
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
                    'diagram_assessment':       'No diagram found.',
                    'correct_points_found':     [],
                    'missing_points':           ['Required diagram was not drawn.'],
                    'incorrect_points':         [],
                    'partial_credit_reasoning': 'Zero marks awarded because this question exclusively requires a diagram and none was detected.',
                    'confidence': 'high',
                    'used_rag_reference': False,
                })
                if idx < len(questions) - 1:
                    time.sleep(INTER_QUESTION_DELAY_NORMAL)
                continue
            else:
                # Student drew a diagram — grade it visually with diagram-only prompt.
                has_diagram = True
                logger.info(f"Q{idx+1}: Diagram-only question — visual grading (diagram-only prompt)")

        elif has_ref_diagram:
            if diagram_marks_val is not None:
                # Split mode: teacher specified separate marks for text and diagram.
                # theory_marks_val is clamped to >= 0 in case of data inconsistency.
                theory_marks_val = max(0, total_marks - diagram_marks_val)
                use_split_mode   = True
                has_diagram      = True
                logger.info(
                    f"Q{idx+1}: Split mode — text={theory_marks_val}m, "
                    f"diagram={diagram_marks_val}m (teacher-defined)"
                )

            else:
                # Legacy mixed question (text + diagram, no mark split): grade holistically.
                # Include the student diagram visually when present; otherwise text-only.
                if has_student_diagram:
                    has_diagram = True
                    logger.info(f"Q{idx+1}: Legacy mixed question — multimodal grading (no mark split)")
                else:
                    logger.info(f"Q{idx+1}: Legacy mixed question — text-only grading (no student diagram found)")

        if use_split_mode:
            user_prompt = _build_split_prompt(
                question, answer, theory_marks_val, diagram_marks_val, retrieved_context
            )
            active_system_prompt = GRADING_SYSTEM_PROMPT_SPLIT
            if has_student_diagram:
                user_content = [
                    {"type": "text",      "text": user_prompt},
                    {"type": "text",      "text": "Reference Diagram (correct answer):"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{ref_b64}"}},
                    {"type": "text",      "text": "Student's Drawn Diagram:"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{student_b64}"}},
                ]
                logger.info(
                    f"Q{idx+1}: Split-mode multimodal grading — "
                    f"text={theory_marks_val}m, diagram={diagram_marks_val}m"
                )
            else:
                user_content = _build_user_prompt(
                    question, answer, theory_marks_val, retrieved_context, has_diagram=False
                )
                active_system_prompt = GRADING_SYSTEM_PROMPT
                logger.info(
                    f"Q{idx+1}: Split-mode text-only (no student diagram detected) — "
                    f"grading text out of {theory_marks_val}m; diagram=0"
                )
        else:
            is_diag_only_q = _is_diagram_only(question)
            user_prompt = _build_user_prompt(
                question, answer, total_marks, retrieved_context, has_diagram=has_diagram
            )
            if is_diag_only_q and has_diagram:
                # Diagram-only question with student diagram: use dedicated prompt
                active_system_prompt = GRADING_SYSTEM_PROMPT_DIAGRAM_ONLY
                img_blocks: list = [
                    {"type": "text", "text": user_prompt},
                    {"type": "text", "text": "Student's Drawn Diagram:"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{student_b64}"}},
                ]
                if ref_b64:
                    img_blocks.insert(1, {"type": "text",      "text": "Reference Diagram (correct answer):"})
                    img_blocks.insert(2, {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{ref_b64}"}})
                    logger.info(f"Q{idx+1}: Diagram-only grading with reference image")
                else:
                    logger.info(f"Q{idx+1}: Diagram-only grading (no reference image)")
                user_content = img_blocks
            elif has_diagram:
                active_system_prompt = GRADING_SYSTEM_PROMPT
                user_content = [
                    {"type": "text",      "text": user_prompt},
                    {"type": "text",      "text": "Reference Diagram (correct answer):"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{ref_b64}"}},
                    {"type": "text",      "text": "Student's Drawn Diagram:"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{student_b64}"}},
                ]
                logger.info(f"Q{idx+1}: Legacy multimodal grading (text + reference diagram + student diagram)")
            else:
                active_system_prompt = GRADING_SYSTEM_PROMPT
                user_content = user_prompt

        headers = {
            "Authorization": f"Bearer {settings.GROQ_API_KEY}",
            "Content-Type": "application/json"
        }

        content = None
        groq_response = None

        model_chain = (
            GROQ_VISION_MODEL_CHAIN
            if isinstance(user_content, list)
            else GROQ_MODEL_CHAIN
        )

        for model_name in model_chain:
            payload = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": active_system_prompt},
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
                continue

            if groq_response.status_code == 200:
                if model_name != model_chain[0]:
                    logger.warning(f"Q{idx+1}: graded with fallback model '{model_name}'")
                break

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
                logger.warning(f"Q{idx+1} [{model_name}]: TPD limit hit — trying next model in chain")
                groq_response = None
                continue

            if is_tpm:
                wait_secs = _parse_retry_after(err_str)
                logger.warning(f"Q{idx+1} [{model_name}]: TPM limit — waiting {wait_secs:.1f}s (API-specified)")
                _rate_limited_last = True
                time.sleep(wait_secs)
                try:
                    groq_response = requests.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        json=payload, headers=headers, timeout=60,
                    )
                except requests.RequestException:
                    groq_response = None
                if groq_response and groq_response.status_code == 200:
                    break
                groq_response = None
                continue

            if groq_response.status_code in (404, 400):
                logger.warning(f"Q{idx+1} [{model_name}]: {groq_response.status_code} error — trying next model")
                groq_response = None
                continue

            results.append({
                'index': idx, 'error': 'Groq API error',
                'details': err_body, 'status_code': groq_response.status_code
            })
            groq_response = None
            break

        if groq_response is None or groq_response.status_code != 200:
            if has_diagram or use_split_mode:
                logger.warning(
                    f"Q{idx+1}: Vision model unavailable — retrying as text-only (diagram quality not assessed)"
                )
                if use_split_mode:
                    fallback_marks = theory_marks_val
                else:
                    fallback_marks = total_marks

                text_prompt   = _build_user_prompt(question, answer, fallback_marks, retrieved_context, has_diagram=False)
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
                    if use_split_mode:
                        penalty_note = (
                            "Diagram could not be assessed (vision model unavailable) "
                            f"— diagram marks = 0/{diagram_marks_val}."
                        )
                        logger.warning(
                            f"Q{idx+1}: Split-mode vision fallback "
                            f"— text graded out of {fallback_marks}m; diagram = 0/{diagram_marks_val}m"
                        )
                    else:
                        penalty_note = (
                            (penalty_note + " " if penalty_note else "") +
                            "Diagram could not be assessed (vision model unavailable) — graded on written text only."
                        )
                else:
                    if not any(r.get('index') == idx for r in results):
                        results.append({'index': idx, 'error': 'Groq API error after all retries (vision + text)'})
                    if idx < len(questions) - 1:
                        time.sleep(INTER_QUESTION_DELAY_NORMAL)
                    continue
            else:
                if not any(r.get('index') == idx for r in results):
                    results.append({'index': idx, 'error': 'Groq API error after all retries'})
                if idx < len(questions) - 1:
                    time.sleep(INTER_QUESTION_DELAY_NORMAL)
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
                    time.sleep(INTER_QUESTION_DELAY_NORMAL)
                continue

            grading = json.loads(json_match.group(0))

            answer_str = ' '.join(answer) if isinstance(answer, list) else str(answer)

            if use_split_mode:
                text_awarded    = float(grading.get('text_marks_awarded', 0))
                diagram_awarded = float(grading.get('diagram_marks_awarded', 0))

                if 'marks_awarded' in grading and 'text_marks_awarded' not in grading:
                    text_awarded = float(grading.get('marks_awarded', 0))
                    diagram_awarded = 0.0

                text_awarded    = max(0.0, min(text_awarded,    float(theory_marks_val)))
                diagram_awarded = max(0.0, min(diagram_awarded, float(diagram_marks_val)))

                if not has_student_diagram:
                    diagram_awarded = 0.0

                marks_awarded = round(text_awarded + diagram_awarded, 1)

                split_note = (
                    f"Text: {text_awarded}/{theory_marks_val}m, "
                    f"Diagram: {diagram_awarded}/{diagram_marks_val}m"
                )
                if not has_student_diagram:
                    split_note += " (no diagram detected in answer sheet — diagram marks = 0)"
                base_feedback  = grading.get('final_feedback', '')
                vision_note    = f" {penalty_note}" if penalty_note else ""
                final_feedback = f"{base_feedback} [{split_note}]{vision_note}"

                logger.info(
                    f"Q{idx+1}: Split score — text={text_awarded}/{theory_marks_val}, "
                    f"diagram={diagram_awarded}/{diagram_marks_val}, total={marks_awarded}/{total_marks}"
                )
            else:
                marks_awarded = float(grading.get('marks_awarded', 0))
                marks_awarded = round(max(0.0, min(marks_awarded, float(total_marks))), 1)

                base_feedback  = grading.get('final_feedback', '')
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
                'diagram_assessment':       grading.get('diagram_assessment', ''),
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
                'diagram_assessment':       '',
                'correct_points_found':     [],
                'missing_points':           [],
                'incorrect_points':         [],
                'partial_credit_reasoning': '',
                'confidence':               'low',
                'used_rag_reference':       False,
                '_parse_error':    str(e),
                '_raw_response':   content,
            })

        if idx < len(questions) - 1:
            delay = INTER_QUESTION_DELAY_AFTER_429 if _rate_limited_last else INTER_QUESTION_DELAY_NORMAL
            _rate_limited_last = False
            time.sleep(delay)

    return results


# HTTP endpoint — wraps grade_questions() for external/test callers.
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
