import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import Button from '../components/Button';
import QuestionItem from '../components/QuestionItem';

type ExtractedQuestion = { question: string; marks: number };
type ExtractedQuestions = Record<string, ExtractedQuestion>;
type DiagramRequirement = Record<string, boolean>;
type DiagramImages = Record<string, File | null>;

/** Extracts the first balanced JSON object from a string, even when
 *  the LLM adds explanatory text or markdown fences around it. */
function extractFirstJSON(text: string): any {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in model response');

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape)          { escape = false; continue; }
    if (c === '\\' && inString) { escape = true;  continue; }
    if (c === '"')       { inString = !inString; continue; }
    if (inString)        continue;
    if (c === '{')       depth++;
    else if (c === '}')  { depth--; if (depth === 0) return JSON.parse(text.slice(start, i + 1)); }
  }
  throw new Error('Unbalanced braces — could not extract JSON from model response');
}

const UploadQuestionPage = () => {
  const navigate = useNavigate();

  const [numQuestions, setNumQuestions] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [examType, setExamType] = useState('');
  const [questionPaper, setQuestionPaper] = useState<File | null>(null);
  const [paperPreview, setPaperPreview] = useState('');

  const [extractedQuestions, setExtractedQuestions] = useState<ExtractedQuestions>({});
  const [questionRequiresDiagram, setQuestionRequiresDiagram] = useState<DiagramRequirement>({});
  const [diagramImages, setDiagramImages] = useState<DiagramImages>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);

  const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';
  const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

  const handleQuestionPaperChange = (file: File | null) => {
    if (!file) {
      setQuestionPaper(null);
      setPaperPreview('');
      return;
    }
    setQuestionPaper(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        setPaperPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const convertImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const extractQuestions = async () => {
    if (!questionPaper) return;

    setIsLoading(true);
    setError('');

    try {
      const base64Image = await convertImageToBase64(questionPaper);

      const prompt = `
You are an expert at reading exam question papers.

Task:
This paper has ${numQuestions} main questions. Extract ALL questions and subquestions as SEPARATE entries.

CRITICAL — How to decide if something is a subquestion or just part of a question:

TRUE subquestions (use keys like "2a", "2b"):
- The Q.No. column of the table has SEPARATE ROWS labeled "a." and "b." (or (a) and (b)) each with THEIR OWN separate mark value.
- Example: Q2 has two rows — row "a" worth 6 marks and row "b" worth 4 marks → extract as "2a" and "2b".

NOT subquestions — keep as ONE single question:
- The question is ONE row in the table and has ONE mark value.
- Inline bullet points like i), ii), iii), iv), v) or a., b., c. that appear INSIDE the question text body are NOT subquestions — they are parts of the question asking for multiple items.
- Example: Q2 asks "Explain the following: i) Visual Field ii) Field of View iii) Latency" with 10 marks total → this is ONE question "2" worth 10 marks. Do NOT split into "2a", "2b", "2c".

Key naming rules:
- Main questions with no subparts: use keys "1", "2", "3", etc.
- Main questions with true subparts (separate rows + separate marks): use keys "2a", "2b", "3a", "3b", etc. (lowercase letter suffix).

Each value must contain:
  - "question": the full question text exactly as written (including any inline i), ii) bullets)
  - "marks": the integer marks for that specific entry from the Marks column
  - "requires_diagram": true or false

Diagram detection rules:
Set "requires_diagram" to true ONLY if the question explicitly asks the student to draw, sketch, label, or provide a figure/diagram.
Examples that imply true:
- draw, sketch, neat sketch, neat diagram, draw and label, sketch and label
- label the diagram, with a diagram, with a sketch, show a figure, draw the figure
- illustrate with a diagram, represent with a diagram, construct a diagram

Set "requires_diagram" to false if the question only says:
- explain, describe, discuss, define, list, compare, differentiate, write short notes, illustrate
unless it explicitly asks for a drawn sketch/diagram/figure.

Important:
- If unsure about diagram, prefer false.
- Do NOT infer diagrams unless wording clearly asks for one.

Output format examples — ALL common exam paper formats:

Example 1 — all plain questions (no subquestions anywhere):
{
  "1": { "question": "<full text of question 1>", "marks": 10, "requires_diagram": false },
  "2": { "question": "<full text of question 2, which may include inline items like i) ... ii) ... iii) ...>", "marks": 10, "requires_diagram": false },
  "3": { "question": "<full text of question 3 — asks to draw/sketch something>", "marks": 10, "requires_diagram": true },
  "4": { "question": "<full text of question 4>", "marks": 10, "requires_diagram": false },
  "5": { "question": "<full text of question 5>", "marks": 10, "requires_diagram": false }
}

Example 2 — all questions have true subparts (each subpart is a separate row with its own marks):
{
  "1a": { "question": "<full text of subpart 1a>", "marks": 6, "requires_diagram": false },
  "1b": { "question": "<full text of subpart 1b — asks to draw/sketch>", "marks": 4, "requires_diagram": true },
  "2a": { "question": "<full text of subpart 2a>", "marks": 5, "requires_diagram": false },
  "2b": { "question": "<full text of subpart 2b>", "marks": 5, "requires_diagram": false },
  "3a": { "question": "<full text of subpart 3a>", "marks": 7, "requires_diagram": false },
  "3b": { "question": "<full text of subpart 3b — asks to draw/sketch>", "marks": 3, "requires_diagram": true }
}

Example 3 — MIXED paper (most common): some questions are plain, some have true subparts:
{
  "1":  { "question": "<full text of plain question 1 — one row, one mark value>", "marks": 5, "requires_diagram": false },
  "2a": { "question": "<full text of subpart 2a — Q2 has two separate rows with separate marks>", "marks": 6, "requires_diagram": false },
  "2b": { "question": "<full text of subpart 2b>", "marks": 4, "requires_diagram": false },
  "3":  { "question": "<full text of plain question 3, which internally lists items like (a) ... (b) ... (c) ... but is ONE row with ONE mark>", "marks": 10, "requires_diagram": false },
  "4a": { "question": "<full text of subpart 4a>", "marks": 5, "requires_diagram": true },
  "4b": { "question": "<full text of subpart 4b>", "marks": 5, "requires_diagram": false },
  "5":  { "question": "<full text of plain question 5>", "marks": 10, "requires_diagram": false }
}

Edge cases to remember:
- Subpart labels in the Q.No. column can appear as: a., b., (a), (b), A, B — all are true subquestions if they have their own mark.
- Inline enumeration styles that are NOT subquestions: i), ii), iii) / a), b), c) / 1., 2., 3. appearing INSIDE the question text body.
- A question that says "Explain/List the following: i) X ii) Y iii) Z" is ONE question. Do NOT split it.
- Only create "2a", "2b" keys when the paper's Q.No. column ITSELF shows separate labeled rows for that question.

Return ONLY the raw JSON object, no markdown, no extra text.
      `;


      const payload = {
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: `This is a ${subjectName} ${examType} question paper.` },
              { type: 'image_url', image_url: { url: base64Image } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 4000,
      };

      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`Groq API error: ${response.status}`);
      const data = await response.json();
      const assistantMessage = data.choices?.[0]?.message?.content;

      // Use balanced-brace extractor so trailing text/markdown from the LLM never breaks parsing
      const questionsJson = extractFirstJSON(assistantMessage);

      if (!Object.keys(questionsJson).length) throw new Error('No questions extracted');

      const requiresDiagram: DiagramRequirement = {};
      const processedQuestions: ExtractedQuestions = {};

      // ── Diagram detection: combined LLM hint + keyword scan ──
      // Keywords use compound phrases only — broad single words like 'diagram' or 'sketch'
      // are intentionally excluded to prevent false positives on questions that merely
      // mention those concepts without asking the student to draw anything.
      const DIAGRAM_KEYWORDS = [
        'neat sketch', 'neat diagram', 'with a sketch', 'with sketch',
        'with a diagram', 'with diagram', 'with a neat', 'draw ', 'draw a',
        'show with a figure', 'label the diagram', 'show diagram',
        'draw the diagram', 'draw and label', 'sketch and label',
        'labelled diagram', 'labeled diagram', 'with labels', 'mark the diagram',
        'illustrate with a diagram', 'illustrate with a sketch',
        'make a diagram', 'construct a diagram', 'represent diagrammatically',
        'show a figure', 'show a labeled figure', 'draw a labeled diagram',
        'prepare a neat sketch', 'prepare a neat diagram',
        'depict with a diagram', 'depict with a sketch',
        'include a diagram', 'include a sketch',
      ];

      Object.entries(questionsJson).forEach(([qNum, val]) => {
        const raw    = typeof val === 'string' ? val : (val as any).question || '';
        const marks  = typeof val === 'object' && (val as any).marks ? Number((val as any).marks) : 10;
        const text   = String(raw).replace(/\(requires diagram\)/gi, '').trim();
        const lower  = text.toLowerCase();

        // ── Layer 1: reliable keyword scan on the question text ──
        const keywordMatch = DIAGRAM_KEYWORDS.some(kw => lower.includes(kw));

        // ── Layer 2: LLM hint (if the model returned the boolean) ──
        const llmHint = typeof val === 'object' && typeof (val as any).requires_diagram === 'boolean'
          ? (val as any).requires_diagram as boolean
          : null;

        // Writing verbs that the LLM often mis-flags as requiring a diagram
        const WRITING_VERBS = [
          'illustrate', 'explain', 'describe', 'discuss',
          'define', 'list', 'compare', 'differentiate', 'elaborate',
        ];
        const startsWithWritingVerb = WRITING_VERBS.some(
          v => lower.startsWith(v) || lower.includes('. ' + v)
        );

        // Final decision:
        //   - keyword matched → always true (most reliable)
        //   - LLM says true AND question doesn't start with a pure writing verb → trust it
        //   - otherwise false
        const needsDiagram =
          keywordMatch || (llmHint === true && !startsWithWritingVerb);

        requiresDiagram[qNum] = needsDiagram;
        processedQuestions[qNum] = { question: text, marks };
      });

      const diagramInit: DiagramImages = {};
      Object.keys(processedQuestions).forEach((qNum) => {
        if (requiresDiagram[qNum]) {
          diagramInit[qNum] = null;
        }
      });

      setExtractedQuestions(processedQuestions);
      setQuestionRequiresDiagram(requiresDiagram);
      setDiagramImages(diagramInit);

      // ── Verify: extracted main-question count vs manually entered count ──
      // Keys like "1","2a","2b","3a","3b" → main numbers are 1,2,3
      const mainQNumbers = new Set(
        Object.keys(processedQuestions).map(k => k.replace(/[a-zA-Z]+$/, ''))
      );
      const expected = parseInt(numQuestions, 10);
      if (!isNaN(expected) && mainQNumbers.size !== expected) {
        alert(
          `You entered ${expected} main question(s), but ${mainQNumbers.size} were extracted.\n\n` +
          `Extracted main questions: ${[...mainQNumbers].sort((a, b) => Number(a) - Number(b)).join(', ')}\n\n` +
          `Please review the extracted questions below before saving.`
        );
      }

      setStep(2);

    } catch (err: any) {
      console.error('Extraction error:', err);
      setError(`Failed to extract questions: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDiagramUpload = (qNum: string, file: File | null) => {
    setDiagramImages((prev) => ({ ...prev, [qNum]: file }));
  };

  const saveToBackend = async () => {
    setIsLoading(true);
    setError('');

    try {
      const questions = Object.entries(extractedQuestions).map(([qno, { question, marks }]) => ({
        qno,        // keep as string: "1", "2a", "2b", etc.
        question,
        marks,
      }));

      const formData = new FormData();
      formData.append('exam_type', examType);
      formData.append('subject', subjectName);
      formData.append('questions', JSON.stringify(questions));

      Object.entries(diagramImages).forEach(([qNum, file]) => {
        if (file) formData.append(`image_${qNum}`, file);
      });

      const response = await fetch('http://127.0.0.1:8000/upload/upload_qp_json/', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save questions');
      }

      localStorage.setItem('subject', subjectName);
      localStorage.setItem('examType', examType);
      alert('Questions saved successfully!');
      navigate('/upload_answer');

    } catch (err: any) {
      console.error('Save error:', err);
      setError(`Failed to save questions: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setNumQuestions('');
    setSubjectName('');
    setExamType('');
    setQuestionPaper(null);
    setPaperPreview('');
    setExtractedQuestions({});
    setQuestionRequiresDiagram({});
    setDiagramImages({});
    setStep(1);
    setError('');
  };

  const isSubmitDisabled = () =>
    Object.entries(questionRequiresDiagram).some(
      ([qNum, required]) => required && !diagramImages[qNum]
    );

  return (
    <div className="max-w-3xl mx-auto">
      {/* Page header */}
      <div className="page-header">
        <h2>{step === 1 ? 'Upload Question Paper' : 'Review Questions'}</h2>
        <p>{step === 1 ? 'Upload an image of the question paper to extract questions.' : 'Review extracted questions before saving.'}</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center mb-6">
        <div className="flex items-center">
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
            {step > 1 ? <CheckCircle className="h-4 w-4" /> : '1'}
          </div>
          <span className={`ml-2 text-sm font-medium ${step >= 1 ? 'text-gray-900' : 'text-gray-400'}`}>Upload</span>
        </div>
        <div className={`mx-3 h-px w-12 ${step >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`} />
        <div className="flex items-center">
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>2</div>
          <span className={`ml-2 text-sm font-medium ${step >= 2 ? 'text-gray-900' : 'text-gray-400'}`}>Review & Save</span>
        </div>
      </div>

      {step === 1 && (
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <Input label="Subject Name" value={subjectName} onChange={setSubjectName} placeholder="e.g. Database Systems" />
            <Input label="Type of Exam" value={examType} onChange={setExamType} placeholder="e.g. CE/SEE" />
          </div>

          <Input
            label="Number of Questions"
            value={numQuestions}
            onChange={setNumQuestions}
            placeholder="Enter total number of questions"
            type="number"
          />

          <div className="mt-5 mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Upload Question Paper Image
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleQuestionPaperChange(e.target.files?.[0] || null)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border p-2.5"
            />
            {paperPreview && (
              <div className="mt-4">
                <img src={paperPreview} alt="Preview" className="max-w-full max-h-96 rounded border" />
              </div>
            )}
          </div>

          <div className="flex justify-end mt-6">
            <Button
              onClick={extractQuestions}
              disabled={!numQuestions || !subjectName || !examType || !questionPaper || isLoading}
              isLoading={isLoading}
            >
              Extract Questions
            </Button>
          </div>

          {error && <ErrorBox message={error} />}
        </div>
      )}

      {step === 2 && (
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Extracted Questions</h3>
          <div className="space-y-4">
            {Object.entries(extractedQuestions).map(([qNum, { question, marks }]) => (
              <QuestionItem
                key={qNum}
                questionNum={qNum}
                questionText={question}
                marks={marks}
                requiresDiagram={questionRequiresDiagram[qNum]}
                onDiagramUpload={handleDiagramUpload}
              />
            ))}
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-center gap-3 mt-6 pt-4 border-t border-gray-100">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <div className="flex gap-4">
              <Button variant="danger" onClick={resetForm}>Reset</Button>
              <Button onClick={saveToBackend} disabled={isSubmitDisabled() || isLoading} isLoading={isLoading}>
                Save & Continue
              </Button>
            </div>
          </div>

          {error && <ErrorBox message={error} />}
        </div>
      )}
    </div>
  );
};

const Input = ({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  type?: string;
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
    />
  </div>
);

const ErrorBox = ({ message }: { message: string }) => (
  <div className="mt-4 px-4 py-3 bg-red-50 rounded-lg border border-red-200 text-red-700 text-sm">{message}</div>
);

export default UploadQuestionPage;