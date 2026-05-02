import { useState, useRef } from 'react';
import { ChevronUp, ChevronDown, ImagePlus, AlertTriangle } from 'lucide-react';

type QuestionItemProps = {
  questionNum: string;
  questionText: string;
  marks: number;
  requiresDiagram: boolean;
  onDiagramUpload: (questionNum: string, file: File | null) => void;
};

const QuestionItem: React.FC<QuestionItemProps> = ({
  questionNum,
  questionText,
  marks,
  requiresDiagram,
  onDiagramUpload,
}) => {
  // Start expanded so the teacher immediately sees the question text
  const [isExpanded, setIsExpanded] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      onDiagramUpload(questionNum, file);
      setUploaded(true);
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') setPreviewUrl(reader.result);
      };
      reader.readAsDataURL(file);
    } else {
      onDiagramUpload(questionNum, null);
      setPreviewUrl(null);
      setUploaded(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">

      {/* ── Header row (always visible) ── */}
      <div
        className="px-5 py-4 cursor-pointer flex items-start justify-between gap-3"
        onClick={() => setIsExpanded(v => !v)}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-base font-semibold text-gray-900 leading-snug">
            Question {questionNum}
          </h3>
          <span className="inline-flex items-center text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
            {marks} marks
          </span>

          {/* Diagram badge — always visible so teacher knows at a glance */}
          {requiresDiagram && (
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 ${
                uploaded
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}
            >
              {uploaded ? (
                <>✓ Diagram uploaded</>
              ) : (
                <><AlertTriangle className="h-3 w-3" /> Diagram required</>
              )}
            </span>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          className="flex-shrink-0 text-gray-400 hover:text-gray-600 mt-0.5"
          onClick={e => { e.stopPropagation(); setIsExpanded(v => !v); }}
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded
            ? <ChevronUp className="h-5 w-5" />
            : <ChevronDown className="h-5 w-5" />}
        </button>
      </div>

      {/* ── Expandable body ── */}
      {isExpanded && (
        <div className="px-5 pb-5 border-t border-gray-100">

          {/* Question text — always readable */}
          <p className="text-gray-700 text-sm leading-relaxed pt-4 pb-3">
            {questionText}
          </p>

          {/* Diagram upload — always shown if required, no extra click needed */}
          {requiresDiagram && (
            <div className="mt-1 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <ImagePlus className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-800">
                  Upload Diagram Image
                </span>
              </div>
              <p className="text-xs text-amber-700 mb-3">
                This question requires a reference diagram. Upload an image before saving.
              </p>

              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="block w-full border border-amber-300 rounded-md p-2 bg-white text-sm focus:ring-blue-500 focus:border-blue-500"
              />

              {previewUrl && (
                <div className="mt-3">
                  <p className="text-xs text-gray-500 mb-1">Preview:</p>
                  <img
                    src={previewUrl}
                    alt={`Diagram for Q${questionNum}`}
                    className="max-w-full max-h-64 rounded border object-contain"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestionItem;
