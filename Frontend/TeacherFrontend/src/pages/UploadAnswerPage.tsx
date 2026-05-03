import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/Button';
import FileUpload from '../components/FileUpload';
import ResultItem from '../components/ResultCard';

type EvaluationResult = {
  question: string;
  score: number;
  feedback: string;
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
      formData.append('total', '10');
      formData.append('usn', usn);

      // Forward RAG artifacts if available so the backend uses them for grading
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
      scorePercentage >= 80 ? 'bg-green-500' :
      scorePercentage >= 60 ? 'bg-blue-500' :
      scorePercentage >= 40 ? 'bg-yellow-500' : 'bg-red-500';

    return (
      <div className="mt-8">
        <h2 className="text-xl font-bold text-gray-900 mb-5">Evaluation Results</h2>

        {results.map((res: any, idx: number) => (
          <ResultItem
            key={idx}
            questionNumber={res.qno ?? idx + 1}
            question={res.question}
            score={res.score}
            maxScore={Number(res.total ?? 10)}
            feedback={res.feedback}
          />
        ))}

        {/* Performance Summary */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 mt-6">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Performance Summary</h3>

          <div className="flex flex-col md:flex-row md:items-center gap-5">
            {/* Score box */}
            <div className="bg-gray-50 rounded-lg p-4 md:w-1/3">
              <p className="text-sm text-gray-500 mb-1">Overall Score</p>
              <div className="flex items-end gap-1">
                <span className="text-2xl font-bold text-gray-900">{totalScored.toFixed(1)}</span>
                <span className="text-lg text-gray-400">/ {totalPossible}</span>
              </div>
              <div className="mt-2 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${scorePercentage}%` }}></div>
              </div>
              <p className="text-xs text-gray-500 mt-1.5">{scorePercentage.toFixed(1)}%</p>
            </div>

            {/* Stats */}
            <div className="flex gap-6">
              <div>
                <p className="text-sm text-gray-500">Questions</p>
                <p className="text-lg font-semibold text-gray-900">{results.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Page header */}
      <div className="page-header">
        <h2>Upload Answer Sheets</h2>
        <p>Upload images of student answer sheets for automated grading.</p>
      </div>

      {/* Form card */}
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
