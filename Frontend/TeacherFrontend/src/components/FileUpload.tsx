import React, { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';

type FileUploadProps = {
  onChange: (files: File[]) => void;
  acceptedTypes?: string;
  label: string;
  description?: string;
  multiple?: boolean;
  maxFiles?: number;
  minFiles?: number;
  className?: string;
  files?: File[];
};

const FileUpload: React.FC<FileUploadProps> = ({
  onChange,
  acceptedTypes = 'image/*',
  label,
  description,
  multiple = true,
  maxFiles = 5,
  minFiles = 1,
  className = '',
  files = [],
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;
    const fileArray = Array.from(selectedFiles);
    if (fileArray.length < minFiles || fileArray.length > maxFiles) {
      alert(`Please select between ${minFiles} and ${maxFiles} files.`);
      return;
    }
    onChange(fileArray);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const removeFile = (index: number) => {
    const updated = files?.filter((_, i) => i !== index) || [];
    onChange(updated);
  };

  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>

      <div
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`relative cursor-pointer border-2 border-dashed rounded-lg p-5 text-center transition-colors ${
          dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <Upload className="mx-auto h-6 w-6 text-gray-400 mb-1.5" />
        <p className="text-sm text-gray-600 font-medium">Click to upload or drag & drop</p>
        {description && <p className="text-xs text-gray-400 mt-1">{description}</p>}
        <input
          ref={inputRef}
          type="file"
          accept={acceptedTypes}
          multiple={multiple}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {files && files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {files.map((file, idx) => (
            <div key={idx} className="flex items-center justify-between px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
              <span className="text-sm text-gray-700 truncate max-w-[85%]">{file.name}</span>
              <button onClick={() => removeFile(idx)} className="text-gray-400 hover:text-red-500 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileUpload;
