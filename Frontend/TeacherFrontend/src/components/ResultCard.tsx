import React from 'react';

type ResultItemProps = {
  questionNumber: string | number;
  question: string;
  score: number;
  maxScore: number;
  feedback: string;
  diagramFeedback?: string;
};

const ResultItem: React.FC<ResultItemProps> = ({
  questionNumber,
  question,
  score,
  maxScore,
  feedback,
  diagramFeedback
}) => {
  const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;

  const barColor =
    percentage >= 80 ? 'bg-green-500' :
    percentage >= 60 ? 'bg-blue-500' :
    percentage >= 40 ? 'bg-yellow-500' : 'bg-red-500';

  const scoreColor = percentage >= 60 ? 'text-green-600' : 'text-red-600';

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
      {/* Header row */}
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-base font-semibold text-gray-900">Question {questionNumber}</h3>
        <span className="text-base font-semibold">
          <span className={scoreColor}>{score}</span>
          <span className="text-gray-400">/{maxScore}</span>
        </span>
      </div>

      {/* Question */}
      <div className="mb-3">
        <p className="text-sm text-gray-500 mb-1">Question</p>
        <p className="text-sm text-gray-800 bg-gray-50 p-3 rounded-md">{question}</p>
      </div>

      {/* Score bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Score</span>
          <span className="font-medium">{percentage.toFixed(0)}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full ${barColor}`}
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      </div>

      {/* Feedback */}
      <div>
        <p className="text-sm text-gray-500 mb-1">Feedback</p>
        <p className="text-sm text-gray-800 bg-blue-50 p-3 rounded-md border-l-3 border-blue-500">{feedback}</p>
      </div>

      {/* Diagram feedback */}
      {diagramFeedback && (
        <div className="mt-3">
          <p className="text-sm text-gray-500 mb-1">Diagram Feedback</p>
          <p className="text-sm text-gray-800 bg-amber-50 p-3 rounded-md border-l-3 border-amber-500">{diagramFeedback}</p>
        </div>
      )}
    </div>
  );
};

export default ResultItem;
