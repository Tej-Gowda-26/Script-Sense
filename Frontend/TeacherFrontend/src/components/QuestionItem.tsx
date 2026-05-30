import React, { useState, useRef } from 'react';
import { ChevronUp, ChevronDown, ImagePlus, AlertTriangle } from 'lucide-react';

type QuestionItemProps = {
  questionNum: string;
  questionText: string;
  marks: number;
  requiresDiagram: boolean;
  onDiagramUpload: (questionNum: string, file: File | null) => void;
  onDiagramMarksChange: (questionNum: string, value: number | null) => void;
};

const QuestionItem: React.FC<QuestionItemProps> = ({
  questionNum,
  questionText,
  marks,
  requiresDiagram,
  onDiagramUpload,
  onDiagramMarksChange,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [diagramMarksInput, setDiagramMarksInput] = useState<string>('');
  const [diagramMarksError, setDiagramMarksError] = useState<string>('');
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
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">

      <div
        className="px-5 py-3.5 cursor-pointer flex items-center justify-between gap-3"
        onClick={() => setIsExpanded(v => !v)}
      >
        <div className="flex items-center gap-2.5 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900">
            Question {questionNum}
          </h3>
          <span className="status-badge text-blue-700 bg-blue-50 border border-blue-200">
            {marks} marks
          </span>

          {requiresDiagram && (
            <span
              className={`status-badge gap-1 ${
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

        <button
          className="flex-shrink-0 text-gray-400 hover:text-gray-600"
          onClick={e => { e.stopPropagation(); setIsExpanded(v => !v); }}
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded
            ? <ChevronUp className="h-4 w-4" />
            : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Expandable body */}
      {isExpanded && (
        <div className="px-5 pb-4 border-t border-gray-100">
          <p className="text-sm text-gray-700 leading-relaxed pt-3 pb-2">
            {questionText}
          </p>

          {requiresDiagram && (
            <div className="mt-2 p-4 bg-amber-50 border border-amber-200 rounded-lg">
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
                    className="max-w-full max-h-48 rounded border object-contain"
                  />
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-amber-200">
                <label className="block text-sm font-semibold text-amber-800 mb-1">
                  Marks allocated to diagram
                </label>
                <p className="text-xs text-amber-700 mb-2">
                  Enter how many of the {marks} marks are for the diagram.
                  The remaining marks will be for the written answer.
                </p>
                <input
                  type="number"
                  min={1}
                  max={marks - 1}
                  value={diagramMarksInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setDiagramMarksInput(raw);
                    const num = parseInt(raw, 10);
                    if (isNaN(num) || num < 1 || num >= marks) {
                      setDiagramMarksError(`Must be between 1 and ${marks - 1}`);
                      onDiagramMarksChange(questionNum, null);
                    } else {
                      setDiagramMarksError('');
                      onDiagramMarksChange(questionNum, num);
                    }
                  }}
                  placeholder={`e.g. ${Math.round(marks / 2)}`}
                  className={`w-32 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ${
                    diagramMarksError
                      ? 'border-red-400 focus:ring-red-200'
                      : 'border-amber-300 focus:ring-amber-200'
                  } bg-white`}
                />
                {diagramMarksError && (
                  <p className="text-xs text-red-600 mt-1">{diagramMarksError}</p>
                )}
                {!diagramMarksError && diagramMarksInput && (
                  <p className="text-xs text-green-700 mt-1">
                    ✓ Diagram: {diagramMarksInput} marks · Written answer: {marks - parseInt(diagramMarksInput, 10)} marks
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestionItem;
