import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, FileText, AlertTriangle, Loader2,
  CheckCircle, XCircle, Eye, X, ChevronDown, ChevronUp,
  CheckCircle2, AlertCircle, BookOpen, Info,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { studentService } from '../services/api';

// ── Full feedback shape (matches all 14 fields from the grading engine) ──
interface Feedback {
  qno: string | number;
  question: string;
  answer: string;
  feedback: string;
  score: number;
  total: number;
  // Rich assessment fields
  correctness_assessment?: string;
  completeness_assessment?: string;
  relevance_assessment?: string;
  depth_assessment?: string;
  correct_points_found?: string[];
  missing_points?: string[];
  incorrect_points?: string[];
  partial_credit_reasoning?: string;
  confidence?: string;           // 'high' | 'medium' | 'low'
  used_rag_reference?: boolean;
}

interface SubjectData {
  subject: string;
  sem: string;
  paperTypes: string[];
}

// ── Shared sub-components ──────────────────────────────────────────────────

const ConfidenceBadge: React.FC<{ level?: string }> = ({ level }) => {
  if (!level) return null;
  const cfg: Record<string, { label: string; cls: string }> = {
    high:   { label: 'High confidence',   cls: 'bg-green-50 text-green-700 border-green-200' },
    medium: { label: 'Medium confidence', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
    low:    { label: 'Low confidence',    cls: 'bg-red-50 text-red-700 border-red-200' },
  };
  const c = cfg[level.toLowerCase()] ?? cfg.medium;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${c.cls}`}>
      <Info size={10} />
      {c.label}
    </span>
  );
};

const PointList: React.FC<{
  items?: string[];
  icon: React.ReactNode;
  colorCls: string;
  label: string;
}> = ({ items, icon, colorCls, label }) => {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className={`text-xs font-semibold mb-1.5 ${colorCls}`}>{label}</p>
      <ul className="space-y-1">
        {items.map((pt, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-gray-700">
            <span className={`mt-0.5 shrink-0 ${colorCls}`}>{icon}</span>
            {pt}
          </li>
        ))}
      </ul>
    </div>
  );
};

const AssessmentPill: React.FC<{ label: string; text?: string }> = ({ label, text }) => {
  if (!text) return null;
  return (
    <div className="bg-gray-50 rounded-md px-3 py-2 border border-gray-100">
      <p className="text-xs font-semibold text-gray-500 mb-0.5">{label}</p>
      <p className="text-xs text-gray-800 leading-relaxed">{text}</p>
    </div>
  );
};

// ── Question feedback card (collapsible detail panel) ─────────────────────

const FeedbackCard: React.FC<{ item: Feedback; index: number }> = ({ item, index }) => {
  const [expanded, setExpanded] = useState(false);

  const hasDetail =
    item.correctness_assessment || item.completeness_assessment ||
    item.relevance_assessment   || item.depth_assessment        ||
    (item.correct_points_found  && item.correct_points_found.length > 0) ||
    (item.missing_points        && item.missing_points.length   > 0)     ||
    (item.incorrect_points      && item.incorrect_points.length > 0)     ||
    item.partial_credit_reasoning;

  return (
    <div key={index} className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      {/* Q header */}
      <div className="flex justify-between items-start mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900">Question {item.qno}</h3>
          <ConfidenceBadge level={item.confidence} />
          {item.used_rag_reference && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200">
              <BookOpen size={10} />
              RAG used
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
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
        <p className="text-sm text-gray-800 bg-blue-50 p-2.5 rounded-md border-l-4 border-blue-400 leading-relaxed">
          {item.feedback}
        </p>
      </div>

      {/* Expand / collapse trigger */}
      {hasDetail && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-3 flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? 'Hide detailed assessment' : 'Show detailed assessment'}
        </button>
      )}

      {/* Detailed assessment panel */}
      {hasDetail && expanded && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-3">
          {/* Assessment pills */}
          {(item.correctness_assessment || item.completeness_assessment ||
            item.relevance_assessment   || item.depth_assessment) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <AssessmentPill label="Correctness"  text={item.correctness_assessment} />
              <AssessmentPill label="Completeness" text={item.completeness_assessment} />
              <AssessmentPill label="Relevance"    text={item.relevance_assessment} />
              <AssessmentPill label="Depth"        text={item.depth_assessment} />
            </div>
          )}

          {/* Point lists */}
          {(item.correct_points_found?.length || item.missing_points?.length ||
            item.incorrect_points?.length) && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <PointList
                items={item.correct_points_found}
                label="✓ Correct points"
                colorCls="text-green-600"
                icon={<CheckCircle2 size={12} />}
              />
              <PointList
                items={item.missing_points}
                label="⚠ Missing points"
                colorCls="text-amber-600"
                icon={<AlertCircle size={12} />}
              />
              <PointList
                items={item.incorrect_points}
                label="✗ Incorrect points"
                colorCls="text-red-600"
                icon={<XCircle size={12} />}
              />
            </div>
          )}

          {/* Partial credit reasoning */}
          {item.partial_credit_reasoning && (
            <div className="bg-indigo-50 rounded-md px-3 py-2 border border-indigo-100">
              <p className="text-xs font-semibold text-indigo-700 mb-0.5">Partial credit reasoning</p>
              <p className="text-xs text-indigo-900 italic leading-relaxed">
                {item.partial_credit_reasoning}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main page ──────────────────────────────────────────────────────────────

const SubjectDetail: React.FC = () => {
  const { subject } = useParams<{ subject: string }>();
  const { usn } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [subjectData, setSubjectData] = useState<SubjectData | null>(null);
  const [selectedExamType, setSelectedExamType] = useState<string>('');

  // Answer sheet viewer
  const [showSheets, setShowSheets] = useState(false);
  const [sheets, setSheets] = useState<string[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [sheetIdx, setSheetIdx] = useState(0);

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

  const openSheets = async () => {
    setSheetIdx(0);
    setShowSheets(true);
    if (sheets.length > 0) return;
    setLoadingSheets(true);
    try {
      const data = await studentService.getAnswerSheets(usn!, subject!, selectedExamType);
      setSheets(data.answer_sheets || []);
    } catch {
      setSheets([]);
    } finally {
      setLoadingSheets(false);
    }
  };

  // Reset sheets cache when exam type changes
  useEffect(() => { setSheets([]); }, [selectedExamType]);

  const calculateTotalScore = () => {
    if (!feedbacks.length) return { earned: 0, total: 0 };
    const earned = feedbacks.reduce((sum, item) => sum + (item.score || 0), 0);
    const total  = feedbacks.reduce((sum, item) => sum + (item.total  || 0), 0);
    return { earned, total };
  };

  const { earned, total } = calculateTotalScore();
  const scorePercentage = total > 0 ? (earned / total) * 100 : 0;

  const barColor =
    scorePercentage >= 85 ? 'bg-green-500' :
    scorePercentage >= 60 ? 'bg-blue-500'  :
    scorePercentage >= 40 ? 'bg-yellow-500' : 'bg-red-500';

  const scoreLabel =
    scorePercentage >= 85 ? 'Excellent' :
    scorePercentage >= 60 ? 'Good'       :
    scorePercentage >= 40 ? 'Satisfactory' : 'Needs improvement';

  const scoreLabelColor =
    scorePercentage >= 85 ? 'text-green-600 bg-green-50 border-green-200' :
    scorePercentage >= 60 ? 'text-blue-600 bg-blue-50 border-blue-200'   :
    scorePercentage >= 40 ? 'text-yellow-600 bg-yellow-50 border-yellow-200' :
    'text-red-600 bg-red-50 border-red-200';

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

        {/* Exam type tabs + View Sheets button */}
        {subjectData?.paperTypes && subjectData.paperTypes.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
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
            {selectedExamType && feedbacks.length > 0 && (
              <button
                onClick={openSheets}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors"
              >
                <Eye size={14} />
                View Answer Sheets
              </button>
            )}
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
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-5 mb-5">
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-base font-semibold text-blue-900">{selectedExamType} — Score Summary</h2>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${scoreLabelColor}`}>
                    {scoreLabel}
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

                {/* Stat tiles */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-white rounded-lg p-4 text-center shadow-sm flex flex-col items-center justify-center min-h-[96px]">
                    <p className="text-xs text-gray-500 mb-1.5">Score</p>
                    <p className="text-blue-700 font-bold flex items-baseline justify-center gap-0.5">
                      <span className="text-2xl">{earned}</span>
                      <span className="text-sm text-gray-400">/{total}</span>
                    </p>
                  </div>
                  <div className="bg-white rounded-lg p-4 text-center shadow-sm flex flex-col items-center justify-center min-h-[96px]">
                    <p className="text-xs text-gray-500 mb-1.5">Percentage</p>
                    <p className="text-2xl font-bold text-gray-900">{scorePercentage.toFixed(1)}%</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 text-center shadow-sm flex flex-col items-center justify-center min-h-[96px]">
                    <p className="text-xs text-gray-500 mb-1.5">Total Questions</p>
                    <p className="text-2xl font-bold text-gray-900">{feedbacks.length}</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 text-center shadow-sm flex flex-col items-center justify-center min-h-[96px]">
                    <p className="text-xs text-gray-500 mb-1.5">Exam Type</p>
                    <p className="text-2xl font-bold text-gray-900">{selectedExamType}</p>
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
                      <FeedbackCard key={index} item={item} index={index} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Answer Sheet Viewer Modal ── */}
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
                <h3 className="font-semibold text-gray-900">Answer Sheets — {selectedExamType} — {usn}</h3>
                {sheets.length > 0 && (
                  <p className="text-xs text-gray-500 mt-0.5">Page {sheetIdx + 1} of {sheets.length}</p>
                )}
              </div>
              <button
                onClick={() => setShowSheets(false)}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Image area */}
            <div className="flex-1 flex items-center justify-center bg-gray-100 min-h-[50vh] relative">
              {loadingSheets ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 size={28} className="text-blue-600 animate-spin" />
                  <p className="text-sm text-gray-500">Loading answer sheets...</p>
                </div>
              ) : sheets.length === 0 ? (
                <div className="text-center p-8">
                  <FileText size={36} className="mx-auto text-gray-300 mb-3" />
                  <p className="text-sm font-medium text-gray-500">No answer sheets found</p>
                  <p className="text-xs text-gray-400 mt-1">Sheets for this exam have not been stored yet.</p>
                </div>
              ) : (
                <>
                  <img
                    src={`data:image/jpeg;base64,${sheets[sheetIdx]}`}
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
                  {sheetIdx < sheets.length - 1 && (
                    <button
                      onClick={() => setSheetIdx(i => i + 1)}
                      className="absolute right-3 p-2.5 bg-white/90 hover:bg-white rounded-full shadow-md text-gray-700 text-lg transition-colors"
                    >
                      →
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Thumbnail strip */}
            {sheets.length > 1 && (
              <div className="flex gap-2 p-3 border-t border-gray-200 overflow-x-auto bg-white">
                {sheets.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setSheetIdx(i)}
                    className={`flex-shrink-0 w-12 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                      i === sheetIdx ? 'border-blue-500' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <img src={`data:image/jpeg;base64,${s}`} alt={`Page ${i + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SubjectDetail;