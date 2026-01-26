import React, { useState } from 'react';
import { X, Download, FileArchive, FileText, Image, Loader } from 'lucide-react';

const ComicExportModal = ({ isOpen, onClose, onExport }) => {
  const [format, setFormat] = useState('cbz');
  const [layout, setLayout] = useState('grid-2x3');
  const [quality, setQuality] = useState('print');
  const [exporting, setExporting] = useState(false);

  if (!isOpen) return null;

  const qualities = {
    web: { dpi: 150, label: 'Web (150 DPI)', description: 'Smaller file size, good for screens' },
    print: { dpi: 300, label: 'Print (300 DPI)', description: 'Standard print quality' },
    high: { dpi: 600, label: 'High (600 DPI)', description: 'Premium quality, larger files' },
  };

  const layouts = {
    'grid-2x2': { label: '2×2 Grid', description: 'Large panels (4 per page)' },
    'grid-2x3': { label: '2×3 Grid', description: 'Standard layout (6 per page)' },
    'grid-3x3': { label: '3×3 Grid', description: 'Dense layout (9 per page)' },
    'cinematic': { label: 'Cinematic', description: 'Wide horizontal panels' },
    'manga': { label: 'Manga Style', description: 'Dynamic varying sizes' },
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await onExport({
        format,
        layout,
        dpi: qualities[quality].dpi,
      });
    } catch (error) {
      console.error('Export error:', error);
      alert('Export failed: ' + error.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-white">Export Comic</h2>
            <p className="text-gray-400 text-sm mt-1">
              Choose your export format and quality settings
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={exporting}
            className="text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Format Selection */}
          <div>
            <h3 className="text-white font-bold mb-3 flex items-center gap-2">
              <Download className="w-5 h-5" />
              Export Format
            </h3>
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer p-4 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors">
                <input
                  type="radio"
                  name="format"
                  value="cbz"
                  checked={format === 'cbz'}
                  onChange={(e) => setFormat(e.target.value)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <FileArchive className="w-5 h-5 text-blue-400" />
                    <p className="text-white font-medium">CBZ (Comic Book Archive)</p>
                    <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">Recommended</span>
                  </div>
                  <p className="text-gray-400 text-sm mt-1">
                    Industry standard format. Works with all comic readers. Contains pages + metadata.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer p-4 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors">
                <input
                  type="radio"
                  name="format"
                  value="pdf"
                  checked={format === 'pdf'}
                  onChange={(e) => setFormat(e.target.value)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-red-400" />
                    <p className="text-white font-medium">PDF (Print-Ready)</p>
                  </div>
                  <p className="text-gray-400 text-sm mt-1">
                    Perfect for printing or publishing. High-quality PDF with proper sizing.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer p-4 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors">
                <input
                  type="radio"
                  name="format"
                  value="images"
                  checked={format === 'images'}
                  onChange={(e) => setFormat(e.target.value)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Image className="w-5 h-5 text-purple-400" />
                    <p className="text-white font-medium">PNG Images (ZIP)</p>
                  </div>
                  <p className="text-gray-400 text-sm mt-1">
                    Individual high-resolution PNG files bundled in a ZIP. Best for sharing/editing.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Layout Selection */}
          <div>
            <h3 className="text-white font-bold mb-3">Panel Layout</h3>
            <select
              value={layout}
              onChange={(e) => setLayout(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
            >
              {Object.entries(layouts).map(([key, config]) => (
                <option key={key} value={key}>
                  {config.label} - {config.description}
                </option>
              ))}
            </select>
          </div>

          {/* Quality Selection */}
          <div>
            <h3 className="text-white font-bold mb-3">Quality</h3>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(qualities).map(([key, config]) => (
                <label
                  key={key}
                  className={`cursor-pointer p-3 rounded-lg border-2 transition-all ${
                    quality === key
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-gray-600 bg-gray-700 hover:border-gray-500'
                  }`}
                >
                  <input
                    type="radio"
                    name="quality"
                    value={key}
                    checked={quality === key}
                    onChange={(e) => setQuality(e.target.value)}
                    className="hidden"
                  />
                  <p className="text-white font-medium text-sm">{config.label}</p>
                  <p className="text-gray-400 text-xs mt-1">{config.description}</p>
                </label>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="bg-blue-500/10 border border-blue-500 rounded-lg p-4">
            <p className="text-blue-400 text-sm">
              <strong>Selected:</strong> {format.toUpperCase()} format • {layouts[layout].label} • {qualities[quality].label}
            </p>
            <p className="text-blue-400/70 text-xs mt-2">
              {format === 'cbz' && 'CBZ files can be read by ComiCat, CDisplayEx, ComicRack, YACReader, and most comic apps.'}
              {format === 'pdf' && 'PDF will be optimized for printing at standard US comic book dimensions.'}
              {format === 'images' && 'All pages will be exported as high-resolution PNG images in a ZIP file.'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-700 p-6 flex gap-3">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-all font-medium flex items-center justify-center gap-2"
          >
            {exporting ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Export Comic
              </>
            )}
          </button>
          <button
            onClick={onClose}
            disabled={exporting}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComicExportModal;
