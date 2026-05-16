import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/Button';
import FileUpload from '../components/FileUpload';
import ResultItem from '../components/ResultCard';

type EvaluationResult = {
  qno: string | number;
  question: string;
  answer: string;
  score: number;
  total: number;
  feedback: string;
  correctness_assessment: string;
  completeness_assessment: string;
  relevance_assessment: string;
  depth_assessment: string;
  correct_points_found: string[];
  missing_points: string[];
  incorrect_points: string[];
  partial_credit_reasoning: string;
  confidence: string;
  used_rag_reference: boolean;
};

type ServerResponse = {
  results: EvaluationResult[];
};

const UploadAnswerPage = () => {
  const navigate = useNavigate();
  const [subject, setSubject] = useState('');
  const [examType, setExamType] = useState('');
  const [usn, setUsn] = useState('');
  const [images, setImages] = useState<File[]>([]);

  // RAG artifacts
  const [ragIndexFile, setRagIndexFile] = useState('');
  const [ragMetaFile, setRagMetaFile] = useState('');
  const [ragName, setRagName] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [responseData, setResponseData] = useState<ServerResponse | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Answer sheet viewer
  const [showSheets, setShowSheets] = useState(false);
  const [sheetIdx, setSheetIdx] = useState(0);

  // Revoke object URLs created from uploaded File objects when files change
  const sheetUrls = useMemo(
    () => images.map(file => URL.createObjectURL(file)),
    [images]
  );
  useEffect(() => () => sheetUrls.forEach(url => URL.revokeObjectURL(url)), [sheetUrls]);

  useEffect(() => {
    setSubject(localStorage.getItem('subject') || '');
    setExamType(localStorage.getItem('examType') || '');
    setRagIndexFile(localStorage.getItem('rag_index_file') || '');
    setRagMetaFile(localStorage.getItem('rag_meta_file') || '');
    setRagName(localStorage.getItem('rag_indexed_name') || '');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (images.length < 1 || images.length > 5) {
      setError('Please select between 1 and 5 images.');
      return;
    }

    setLoading(true);
    setError('');
    setResponseData(null);

    try {
      const formData = new FormData();
      formData.append('subject', subject);
      formData.append('exam_type', examType);
      formData.append('total', '10'); // fallback when no per-question marks are stored in DB
      formData.append('usn', usn);

      // Forward RAG artifacts if the teacher indexed a textbook
      if (ragIndexFile && ragMetaFile) {
        formData.append('index_file', ragIndexFile);
        formData.append('meta_file', ragMetaFile);
      }

      images.forEach(file => formData.append('images', file));

      const res = await fetch('http://127.0.0.1:8000/imageto/text/', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);

      const contentType = res.headers.get('content-type');
      const data = contentType?.includes('application/json') ? await res.json() : { message: await res.text() };

      if (data.forwarded_response) {
        try {
          const parsed = JSON.parse(data.forwarded_response);
          setResponseData(parsed);
          setSubmitSuccess(true);
        } catch {
          setError('Invalid server response format.');
        }
      } else {
        setError('No evaluation results received.');
      }
    } catch (err: any) {
      setError(err.message || 'Submission error.');
    } finally {
      setLoading(false);
    }
  };

  const renderResults = () => {
    if (!responseData?.results) return null;

    const results = responseData.results;
    const totalScored    = results.reduce((sum: number, r: any) => sum + (Number(r.score)        || 0),  0);
    const totalPossible  = results.reduce((sum: number, r: any) => sum + (Number(r.total ?? 10) || 10), 0);
    const scorePercentage = totalPossible > 0 ? (totalScored / totalPossible) * 100 : 0;

    const barColor =
      scorePercentage >= 85 ? 'bg-green-500' :
      scorePercentage >= 60 ? 'bg-blue-500' :
      scorePercentage >= 40 ? 'bg-yellow-500' : 'bg-red-500';

    const scoreLabelColor =
      scorePercentage >= 85 ? 'text-green-600 bg-green-50 border-green-200' :
      scorePercentage >= 60 ? 'text-blue-600 bg-blue-50 border-blue-200' :
      scorePercentage >= 40 ? 'text-yellow-600 bg-yellow-50 border-yellow-200' :
      'text-red-600 bg-red-50 border-red-200';

    return (
      <><div className="mt-8">
        <div className="flex items-center gap-3 mb-5">
          <h2 className="text-xl font-bold text-gray-900">Evaluation Results</h2>
          {sheetUrls.length > 0 && (
            <button
              onClick={() => { setSheetIdx(0); setShowSheets(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors"
            >
              👁 View Answer Sheets
            </button>
          )}
        </div>

        {results.map((res: any, idx: number) => (
          <ResultItem
            key={idx}
            questionNumber={res.qno ?? idx + 1}
            question={res.question}
            score={res.score}
            maxScore={Number(res.total ?? 10)}
            feedback={res.feedback}
            correctness_assessment={res.correctness_assessment}
            completeness_assessment={res.completeness_assessment}
            relevance_assessment={res.relevance_assessment}
            depth_assessment={res.depth_assessment}
            correct_points_found={res.correct_points_found}
            missing_points={res.missing_points}
            incorrect_points={res.incorrect_points}
            partial_credit_reasoning={res.partial_credit_reasoning}
            confidence={res.confidence}
            used_rag_reference={res.used_rag_reference}
          />
        ))}

        {/* Performance Summary */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-5 mt-6">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-base font-semibold text-blue-900">Performance Summary</h3>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${scoreLabelColor}`}>
              {scorePercentage >= 85 ? 'Excellent' : scorePercentage >= 60 ? 'Good' : scorePercentage >= 40 ? 'Satisfactory' : 'Needs improvement'}
            </span>
          </div>

          {/* Progress bar */}
          <div className="mb-5">
            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
              <span>Overall Score</span>
              <span className="font-medium">{scorePercentage.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${scorePercentage}%` }} />
            </div>
          </div>

          {/* Stat tiles — fills the full width */}
          <div className="grid grid-cols-3 gap-4">
            {/* Score */}
            <div className="bg-white rounded-lg p-4 text-center shadow-sm flex flex-col items-center justify-center min-h-[96px]">
              <p className="text-xs text-gray-500 mb-1.5">Score</p>
              <p className="text-blue-700 font-bold flex items-baseline justify-center gap-0.5">
                <span className="text-2xl">{totalScored.toFixed(1)}</span>
                <span className="text-sm text-gray-400">/{totalPossible}</span>
              </p>
            </div>
            <div className="bg-white rounded-lg p-4 text-center shadow-sm flex flex-col items-center justify-center min-h-[96px]">
              <p className="text-xs text-gray-500 mb-1.5">Percentage</p>
              <p className="text-2xl font-bold text-gray-900">{scorePercentage.toFixed(1)}%</p>
            </div>
            <div className="bg-white rounded-lg p-4 text-center shadow-sm flex flex-col items-center justify-center min-h-[96px]">
              <p className="text-xs text-gray-500 mb-1.5">Total Questions</p>
              <p className="text-2xl font-bold text-gray-900">{results.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Answer Sheet Viewer Modal */}
      {showSheets && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowSheets(false)}
        >
          <div
            className="bg-white rounded-xl overflow-hidden w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h3 className="font-semibold text-gray-900">Answer Sheets — {examType} — {usn}</h3>
                <p className="text-xs text-gray-500 mt-0.5">Page {sheetIdx + 1} of {sheetUrls.length}</p>
              </div>
              <button
                onClick={() => setShowSheets(false)}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors text-lg"
              >
                ✕
              </button>
            </div>

            {/* Image area */}
            <div className="flex-1 flex items-center justify-center bg-gray-100 min-h-[50vh] relative">
              <img
                src={sheetUrls[sheetIdx]}
                alt={`Answer sheet page ${sheetIdx + 1}`}
                className="max-h-[60vh] max-w-full object-contain"
              />
              {sheetIdx > 0 && (
                <button
                  onClick={() => setSheetIdx(i => i - 1)}
                  className="absolute left-3 p-2.5 bg-white/90 hover:bg-white rounded-full shadow-md text-gray-700 text-lg transition-colors"
                >
                  ←
                </button>
              )}
              {sheetIdx < sheetUrls.length - 1 && (
                <button
                  onClick={() => setSheetIdx(i => i + 1)}
                  className="absolute right-3 p-2.5 bg-white/90 hover:bg-white rounded-full shadow-md text-gray-700 text-lg transition-colors"
                >
                  →
                </button>
              )}
            </div>

            {/* Thumbnail strip */}
            {sheetUrls.length > 1 && (
              <div className="flex gap-2 p-3 border-t border-gray-200 overflow-x-auto bg-white">
                {sheetUrls.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => setSheetIdx(i)}
                    className={`flex-shrink-0 w-12 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                      i === sheetIdx ? 'border-blue-500' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <img src={url} alt={`Page ${i + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      </>
    );
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="page-header">
        <h2>Upload Answer Sheets</h2>
        <p>Upload images of student answer sheets for automated grading.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
          <div>
            <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-1.5">Subject</label>
            <input
              id="subject"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              required
              placeholder="Enter Subject"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label htmlFor="examType" className="block text-sm font-medium text-gray-700 mb-1.5">Exam Type</label>
            <input
              id="examType"
              value={examType}
              onChange={e => setExamType(e.target.value)}
              required
              placeholder="Enter Exam Type"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        </div>

        <div className="mb-5">
          <label htmlFor="usn" className="block text-sm font-medium text-gray-700 mb-1.5">Student USN</label>
          <input
            id="usn"
            value={usn}
            onChange={e => setUsn(e.target.value)}
            required
            placeholder="Enter USN"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <FileUpload
          label="Upload Answer Sheet Images"
          description="Upload between 1 and 5 images"
          onChange={setImages}
          multiple
          maxFiles={5}
          minFiles={1}
          acceptedTypes="image/*"
          files={images}
        />

        {error && (
          <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-stretch gap-3">
          <div className="flex-[3]">
            <Button type="submit" disabled={loading || !subject || !examType || !usn || images.length === 0} isLoading={loading} fullWidth>
              {loading ? 'Processing...' : 'Submit for Evaluation'}
            </Button>
          </div>
          {ragName && (
            <button
              type="button"
              onClick={() => navigate('/upload_textbook')}
              title={`RAG active: ${ragName} — click to change`}
              className="flex-[1] flex items-center justify-center text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
            >
              RAG active
            </button>
          )}
        </div>
      </form>

      {submitSuccess && responseData && renderResults()}
    </div>
  );
};

export default UploadAnswerPage;