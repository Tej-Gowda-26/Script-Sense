import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, AlertTriangle, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { studentService } from '../services/api';

interface Feedback {
  qno: string | number;
  question: string;
  answer: string;
  feedback: string;
  score: number;
  total: number;
}

interface SubjectData {
  subject: string;
  sem: string;
  paperTypes: string[];
}

const SubjectDetail: React.FC = () => {
  const { subject } = useParams<{ subject: string }>();
  const { usn } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [subjectData, setSubjectData] = useState<SubjectData | null>(null);
  const [selectedExamType, setSelectedExamType] = useState<string>('');

  useEffect(() => {
    const fetchSubjectData = async () => {
      if (!usn || !subject) return;
      try {
        setIsLoading(true);
        const data = await studentService.getSubjects(usn);
        const foundSubject = data.subjectsData?.find((s: SubjectData) => s.subject === subject);
        if (foundSubject) {
          setSubjectData(foundSubject);
          if (foundSubject.paperTypes?.length > 0) {
            setSelectedExamType(foundSubject.paperTypes[0]);
          }
        } else {
          setError('Subject not found');
        }
      } catch {
        setError('Failed to load subject data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchSubjectData();
  }, [usn, subject]);

  useEffect(() => {
    const fetchFeedback = async () => {
      if (!usn || !subject || !selectedExamType) return;
      try {
        setIsLoading(true);
        const data = await studentService.getSubjectDetails(usn, subject, selectedExamType);
        setFeedbacks(data.feedbacks || []);
      } catch {
        setFeedbacks([]);
      } finally {
        setIsLoading(false);
      }
    };
    if (selectedExamType) fetchFeedback();
  }, [usn, subject, selectedExamType]);

  const calculateTotalScore = () => {
    if (!feedbacks.length) return { earned: 0, total: 0 };
    const earned = feedbacks.reduce((sum, item) => sum + (item.score || 0), 0);
    const total  = feedbacks.reduce((sum, item) => sum + (item.total  || 0), 0);
    return { earned, total };
  };

  const { earned, total } = calculateTotalScore();
  const scorePercentage = total > 0 ? (earned / total) * 100 : 0;

  const barColor =
    scorePercentage >= 70 ? 'bg-green-500' :
    scorePercentage >= 40 ? 'bg-yellow-500' : 'bg-red-500';

  const scoreLabel =
    scorePercentage >= 70 ? 'Good' :
    scorePercentage >= 40 ? 'Satisfactory' : 'Needs improvement';

  return (
    <div>
      {/* Back link */}
      <button
        onClick={() => navigate('/dashboard')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        <ArrowLeft size={15} />
        Back to Dashboard
      </button>

      {/* Subject header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {subject}
            {subjectData?.sem && (
              <span className="ml-2 text-sm font-normal text-gray-400">Semester {subjectData.sem}</span>
            )}
          </h1>
        </div>

        {/* Exam type tabs */}
        {subjectData?.paperTypes && subjectData.paperTypes.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {subjectData.paperTypes.map((type) => (
              <button
                key={type}
                onClick={() => setSelectedExamType(type)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  selectedExamType === type
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 size={28} className="text-blue-600 animate-spin mb-3" />
          <p className="text-sm text-gray-500">Loading exam data...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-lg">
            <AlertTriangle size={18} />
            <div>
              <p className="font-medium text-sm">{error}</p>
              <button
                onClick={() => navigate('/dashboard')}
                className="text-xs underline mt-1"
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {selectedExamType && (
            <div>
              {/* Score summary card */}
              <div className="card p-5 mb-5">
                <h2 className="text-base font-semibold text-gray-900 mb-4">{selectedExamType} — Score Summary</h2>
                <div className="flex flex-col md:flex-row md:items-center gap-5">
                  <div className="bg-gray-50 rounded-lg p-4 md:w-56">
                    <p className="text-sm text-gray-500 mb-1">Overall Score</p>
                    <div className="flex items-end gap-1">
                      <span className="text-2xl font-bold text-blue-700">{earned}</span>
                      <span className="text-lg text-gray-400">/ {total}</span>
                    </div>
                    <div className="mt-2 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${scorePercentage}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5">
                      {scorePercentage.toFixed(1)}% · {scoreLabel}
                    </p>
                  </div>
                  <div className="flex gap-6">
                    <div>
                      <p className="text-sm text-gray-500">Questions</p>
                      <p className="text-lg font-semibold text-gray-900">{feedbacks.length}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Exam Type</p>
                      <p className="text-lg font-semibold text-gray-900">{selectedExamType}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Question-wise feedback */}
              <div className="card p-5">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Question-wise Feedback</h2>

                {feedbacks.length === 0 ? (
                  <div className="text-center py-10">
                    <FileText size={28} className="mx-auto text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-500">No feedback available</p>
                    <p className="text-xs text-gray-400 mt-1">Feedback for this exam has not been provided yet.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {feedbacks.map((item, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
                        {/* Q header */}
                        <div className="flex justify-between items-center mb-3">
                          <h3 className="text-sm font-semibold text-gray-900">Question {item.qno}</h3>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-gray-800">
                              {item.score} / {item.total}
                            </span>
                            {item.score === item.total ? (
                              <CheckCircle size={15} className="text-green-500" />
                            ) : item.score === 0 ? (
                              <XCircle size={15} className="text-red-500" />
                            ) : (
                              <span className="text-yellow-500 text-xs">●</span>
                            )}
                          </div>
                        </div>

                        {/* Question text */}
                        <div className="mb-3">
                          <p className="text-xs font-medium text-gray-500 mb-1">Question</p>
                          <p className="text-sm text-gray-800 bg-gray-50 p-2.5 rounded-md">{item.question}</p>
                        </div>

                        {/* Feedback */}
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-1">Feedback</p>
                          <p className="text-sm text-gray-800 bg-blue-50 p-2.5 rounded-md border-l-4 border-blue-400">{item.feedback}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SubjectDetail;