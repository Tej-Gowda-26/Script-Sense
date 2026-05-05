import React, { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertCircle, BookOpen, Info } from 'lucide-react';

type ResultItemProps = {
  questionNumber: string | number;
  question: string;
  score: number;
  maxScore: number;
  feedback: string;
  diagramFeedback?: string;
  // Rich assessment fields returned by the grading engine
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
};

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

const ResultItem: React.FC<ResultItemProps> = ({
  questionNumber,
  question,
  score,
  maxScore,
  feedback,
  diagramFeedback,
  correctness_assessment,
  completeness_assessment,
  relevance_assessment,
  depth_assessment,
  correct_points_found,
  missing_points,
  incorrect_points,
  partial_credit_reasoning,
  confidence,
  used_rag_reference,
}) => {
  const [expanded, setExpanded] = useState(false);

  const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;

  const barColor =
    percentage >= 80 ? 'bg-green-500' :
    percentage >= 60 ? 'bg-blue-500'  :
    percentage >= 40 ? 'bg-yellow-500' : 'bg-red-500';

  const scoreColor = percentage >= 60 ? 'text-green-600' : 'text-red-600';

  // Determine if there's any rich detail to expand
  const hasDetail =
    correctness_assessment || completeness_assessment ||
    relevance_assessment   || depth_assessment        ||
    (correct_points_found  && correct_points_found.length > 0) ||
    (missing_points        && missing_points.length   > 0)     ||
    (incorrect_points      && incorrect_points.length > 0)     ||
    partial_credit_reasoning;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
      {/* ── Header row ── */}
      <div className="flex justify-between items-start mb-3 gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-semibold text-gray-900">Question {questionNumber}</h3>
          <ConfidenceBadge level={confidence} />
          {used_rag_reference && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200">
              <BookOpen size={10} />
              RAG used
            </span>
          )}
        </div>
        <span className="text-base font-semibold shrink-0">
          <span className={scoreColor}>{score}</span>
          <span className="text-gray-400">/{maxScore}</span>
        </span>
      </div>

      {/* ── Question ── */}
      <div className="mb-3">
        <p className="text-sm text-gray-500 mb-1">Question</p>
        <p className="text-sm text-gray-800 bg-gray-50 p-3 rounded-md">{question}</p>
      </div>

      {/* ── Score bar ── */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Score</span>
          <span className="font-medium">{percentage.toFixed(0)}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${percentage}%` }} />
        </div>
      </div>

      {/* ── Feedback ── */}
      <div>
        <p className="text-sm text-gray-500 mb-1">Feedback</p>
        <p className="text-sm text-gray-800 bg-blue-50 p-3 rounded-md border-l-4 border-blue-400 leading-relaxed">
          {feedback}
        </p>
      </div>

      {/* ── Diagram feedback ── */}
      {diagramFeedback && (
        <div className="mt-3">
          <p className="text-sm text-gray-500 mb-1">Diagram Feedback</p>
          <p className="text-sm text-gray-800 bg-amber-50 p-3 rounded-md border-l-4 border-amber-400">
            {diagramFeedback}
          </p>
        </div>
      )}

      {/* ── Expand / collapse trigger ── */}
      {hasDetail && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-4 flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {expanded ? 'Hide detailed assessment' : 'Show detailed assessment'}
        </button>
      )}

      {/* ── Detailed assessment panel ── */}
      {hasDetail && expanded && (
        <div className="mt-4 border-t border-gray-100 pt-4 space-y-4">

          {/* Assessment pills */}
          {(correctness_assessment || completeness_assessment ||
            relevance_assessment   || depth_assessment) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <AssessmentPill label="Correctness"   text={correctness_assessment} />
              <AssessmentPill label="Completeness"  text={completeness_assessment} />
              <AssessmentPill label="Relevance"     text={relevance_assessment} />
              <AssessmentPill label="Depth"         text={depth_assessment} />
            </div>
          )}

          {/* Point lists */}
          {(correct_points_found?.length  || missing_points?.length ||
            incorrect_points?.length) && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <PointList
                items={correct_points_found}
                label="✓ Correct points"
                colorCls="text-green-600"
                icon={<CheckCircle2 size={12} />}
              />
              <PointList
                items={missing_points}
                label="⚠ Missing points"
                colorCls="text-amber-600"
                icon={<AlertCircle size={12} />}
              />
              <PointList
                items={incorrect_points}
                label="✗ Incorrect points"
                colorCls="text-red-600"
                icon={<XCircle size={12} />}
              />
            </div>
          )}

          {/* Partial credit reasoning */}
          {partial_credit_reasoning && (
            <div className="bg-indigo-50 rounded-md px-3 py-2.5 border border-indigo-100">
              <p className="text-xs font-semibold text-indigo-700 mb-0.5">Partial credit reasoning</p>
              <p className="text-xs text-indigo-900 italic leading-relaxed">{partial_credit_reasoning}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ResultItem;
