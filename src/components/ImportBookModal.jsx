import React, { useState } from 'react';
import { X, Upload, FileText, CheckCircle2, AlertCircle } from 'lucide-react';

const ImportBookModal = ({ isOpen, onClose, onImportComplete }) => {
  const [step, setStep] = useState('upload'); // upload, extracting, review
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState(null);
  const [importId, setImportId] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);
  const [useAI, setUseAI] = useState(true); // AI detection enabled by default

  if (!isOpen) return null;

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      // Check file type
      const ext = selectedFile.name.split('.').pop().toLowerCase();
      if (!['epub', 'pdf', 'docx', 'txt'].includes(ext)) {
        setError('Invalid file type. Please upload EPUB, PDF, DOCX, or TXT files.');
        return;
      }
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = localStorage.getItem('token');
      const response = await fetch('/api/books/import/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const result = await response.json();
      setUploadResult(result);
      setImportId(result.importId);
      setStep('extracting');

      // Auto-start extraction
      await handleExtractChapters(result.importId);
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.message || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleExtractChapters = async (targetImportId) => {
    const idToUse = targetImportId || importId;
    if (!idToUse) return;

    setExtracting(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/books/import/${idToUse}/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          minChapterLength: 500,
          maxChapterLength: 100000,
          useAI: useAI,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Extraction failed');
      }

      const result = await response.json();
      setStep('review');
      // Pass to review modal
      if (onImportComplete) {
        onImportComplete({ importId: idToUse, ...result });
      }
    } catch (err) {
      console.error('Extraction error:', err);
      setError(err.message || 'Failed to extract chapters');
    } finally {
      setExtracting(false);
    }
  };

  const handleClose = () => {
    setStep('upload');
    setFile(null);
    setImportId(null);
    setUploadResult(null);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-white">Import Book</h2>
            <p className="text-gray-400 text-sm mt-1">
              Upload an existing book to extend or adapt
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Upload Step */}
          {step === 'upload' && (
            <div className="space-y-6">
              {/* File Input */}
              <div className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center hover:border-blue-500 transition-colors">
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-white font-medium mb-2">
                  {file ? file.name : 'Choose a book file to import'}
                </p>
                <p className="text-gray-400 text-sm mb-4">
                  Supports EPUB, PDF, DOCX, and TXT files (max 50MB)
                </p>
                <label className="inline-block">
                  <input
                    type="file"
                    accept=".epub,.pdf,.docx,.txt"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <span className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer transition-colors">
                    Select File
                  </span>
                </label>
              </div>

              {/* File Info */}
              {file && (
                <div className="bg-gray-700 rounded-lg p-4 flex items-center gap-3">
                  <FileText className="w-6 h-6 text-blue-400" />
                  <div className="flex-1">
                    <p className="text-white font-medium">{file.name}</p>
                    <p className="text-gray-400 text-sm">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <CheckCircle2 className="w-6 h-6 text-green-400" />
                </div>
              )}

              {/* Detection Method Selection */}
              {file && (
                <div className="bg-gray-700 rounded-lg p-4 space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      checked={useAI}
                      onChange={() => setUseAI(true)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-white font-medium">AI-Powered Detection</p>
                        <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded">Recommended</span>
                      </div>
                      <p className="text-gray-400 text-sm mt-1">
                        Uses AI to intelligently detect chapter boundaries. Works best for books with inconsistent formatting or non-standard chapter markers.
                      </p>
                      <p className="text-yellow-400 text-xs mt-1">⚡ Costs ~$0.01-0.05 per book</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      checked={!useAI}
                      onChange={() => setUseAI(false)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-white font-medium">Pattern-Based Detection</p>
                        <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">Free</span>
                      </div>
                      <p className="text-gray-400 text-sm mt-1">
                        Uses regex patterns to find common chapter markers ("Chapter 1", "I", "II", etc.). Fast and free, but may miss unconventional chapter breaks.
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="bg-red-500/10 border border-red-500 rounded-lg p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={handleUpload}
                  disabled={!file || uploading}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
                >
                  {uploading ? 'Uploading...' : useAI ? 'Upload & Detect with AI' : 'Upload & Detect Chapters'}
                </button>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Extracting Step */}
          {step === 'extracting' && (
            <div className="space-y-6 text-center py-8">
              <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <div>
                <h3 className="text-xl font-bold text-white mb-2">
                  {useAI ? 'AI Analyzing Chapters...' : 'Detecting Chapters...'}
                </h3>
                <p className="text-gray-400">
                  {useAI
                    ? 'Using AI to intelligently find chapter boundaries...'
                    : 'Using pattern matching to detect chapter markers...'
                  }
                </p>
                {uploadResult && (
                  <p className="text-gray-500 text-sm mt-2">
                    File: {uploadResult.filename} ({(uploadResult.textLength / 1000).toFixed(0)}k characters)
                  </p>
                )}
                {useAI && (
                  <p className="text-purple-400 text-xs mt-2">
                    This may take 1-2 minutes for large books
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Review Step - Will open ChapterReviewModal */}
          {step === 'review' && (
            <div className="text-center py-8">
              <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Chapters Extracted!</h3>
              <p className="text-gray-400">
                Opening chapter review screen...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImportBookModal;
