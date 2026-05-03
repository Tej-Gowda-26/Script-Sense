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

  // RAG artifacts — set once via the textbook upload on UploadQuestionPage
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

    return (
      <div className="mt-10">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">Evaluation Results</h2>
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
        <div className="mt-10 p-6 rounded-lg shadow border">
          <h3 className="text-lg font-semibold mb-5">Performance Summary</h3>
          <div className="mb-4">
            <div className="flex justify-between mb-1">
              <span>Overall Score</span>
              <span>{scorePercentage.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-200 h-2.5 rounded-full">
              <div
                className={`h-2.5 rounded-full ${scorePercentage >= 80 ? 'bg-green-500' : scorePercentage >= 60 ? 'bg-blue-500' : scorePercentage >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${scorePercentage}%` }}
              ></div>
            </div>
          </div>
          <div className="flex justify-between">
            <p>Total Questions: <strong>{results.length}</strong></p>
            <p className="text-xl font-bold">{totalScored.toFixed(1)} / {totalPossible}</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Upload Answer Sheets</h2>
        <p className="text-gray-600">Upload images of student answer sheets for automated grading.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <input
              id="subject"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              required
              placeholder="Enter Subject"
              className="w-full p-2.5 border rounded-md"
            />
          </div>
          <div>
            <label htmlFor="examType" className="block text-sm font-medium text-gray-700 mb-1">Exam Type</label>
            <input
              id="examType"
              value={examType}
              onChange={e => setExamType(e.target.value)}
              required
              placeholder="Enter Exam Type"
              className="w-full p-2.5 border rounded-md"
            />
          </div>
        </div>

        <div className="mb-6">
          <label htmlFor="usn" className="block text-sm font-medium text-gray-700 mb-1">Student USN</label>
          <input
            id="usn"
            value={usn}
            onChange={e => setUsn(e.target.value)}
            required
            placeholder="Enter USN"
            className="w-full p-2.5 border rounded-md"
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


        {error && <p className="mt-4 p-3 bg-red-100 text-red-700 rounded">{error}</p>}

        <div className="mt-6 flex items-stretch gap-3">
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
              className="flex-[1] flex items-center justify-center text-sm font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
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
