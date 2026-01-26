import React, { useState } from 'react';
import { Film, Sparkles, ChevronDown, ChevronUp, Download, Trash2, Copy, FileText } from 'lucide-react';
import { jsPDF } from 'jspdf';

const TranscriptsTab = ({ data, setData, onGenerateTranscript, generatingAI }) => {
  const [selectedChapter, setSelectedChapter] = useState('');
  const [generatingFor, setGeneratingFor] = useState(null);
  const [expandedTranscripts, setExpandedTranscripts] = useState({});

  const sortedChapters = [...(data.chapters || [])].sort((a, b) =>
    (parseInt(a.number) || 0) - (parseInt(b.number) || 0)
  );

  const transcripts = data.transcripts || [];

  const handleGenerate = async () => {
    if (!selectedChapter) return;

    const chapter = data.chapters.find(c => c.id.toString() === selectedChapter);
    if (!chapter) return;

    setGeneratingFor(chapter.id);

    const prompt = `Chapter ${chapter.number}: ${chapter.title}\n\n${chapter.summary}\n\nContent:\n${chapter.content}`;

    const result = await onGenerateTranscript('transcript', prompt);

    if (result) {
      const newTranscript = {
        id: Date.now(),
        chapterId: chapter.id,
        chapterNumber: chapter.number,
        chapterTitle: chapter.title,
        title: result.title || `Episode ${chapter.number}`,
        sceneCount: result.sceneCount || 0,
        estimatedDuration: result.estimatedDuration || 'TBD',
        transcript: result.transcript || '',
        createdAt: new Date().toISOString()
      };

      setData(prev => ({
        ...prev,
        transcripts: [...(prev.transcripts || []), newTranscript]
      }));

      setSelectedChapter('');
    }

    setGeneratingFor(null);
  };

  const handleDelete = (transcriptId) => {
    setData(prev => ({
      ...prev,
      transcripts: (prev.transcripts || []).filter(t => t.id !== transcriptId)
    }));
  };

  const toggleExpand = (transcriptId) => {
    setExpandedTranscripts(prev => ({
      ...prev,
      [transcriptId]: !prev[transcriptId]
    }));
  };

  const handleCopy = (transcript) => {
    navigator.clipboard.writeText(transcript);
    alert('Transcript copied to clipboard!');
  };

  const handleDownload = (transcriptObj) => {
    const content = `${transcriptObj.title}\n${'='.repeat(transcriptObj.title.length)}\n\n${transcriptObj.transcript}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${transcriptObj.title.replace(/[^a-z0-9]/gi, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = (transcriptObj) => {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let yPosition = margin;

    // Helper function to add new page if needed
    const checkPageBreak = (requiredSpace) => {
      if (yPosition + requiredSpace > pageHeight - margin) {
        pdf.addPage();
        yPosition = margin;
        return true;
      }
      return false;
    };

    // Title Page
    pdf.setFillColor(147, 51, 234); // Purple
    pdf.rect(0, 0, pageWidth, 80, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(28);
    pdf.setFont(undefined, 'bold');
    const titleLines = pdf.splitTextToSize(transcriptObj.title, contentWidth - 20);
    yPosition = 30;
    titleLines.forEach(line => {
      pdf.text(line, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 10;
    });

    // Metadata
    yPosition = 90;
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(12);
    pdf.setFont(undefined, 'normal');
    pdf.text(`Animation Transcript`, margin, yPosition);
    yPosition += 8;
    pdf.text(`Scenes: ${transcriptObj.sceneCount} | Duration: ${transcriptObj.estimatedDuration}`, margin, yPosition);
    yPosition += 8;
    if (transcriptObj.chapterNumber) {
      pdf.text(`Based on Chapter ${transcriptObj.chapterNumber}: ${transcriptObj.chapterTitle}`, margin, yPosition);
      yPosition += 8;
    }
    pdf.text(`Generated: ${new Date(transcriptObj.createdAt).toLocaleDateString()}`, margin, yPosition);

    yPosition += 15;

    // Transcript Content
    pdf.setFontSize(10);
    pdf.setFont('courier', 'normal'); // Monospace font for screenplay format

    const lines = transcriptObj.transcript.split('\n');

    lines.forEach(line => {
      checkPageBreak(5);

      // Handle different screenplay elements with formatting
      if (line.trim().toUpperCase() === line.trim() && line.trim().length > 0 && line.trim().length < 50) {
        // Scene headings or character names - bold
        pdf.setFont('courier', 'bold');
        const wrappedLines = pdf.splitTextToSize(line, contentWidth);
        wrappedLines.forEach(wrapped => {
          checkPageBreak(5);
          pdf.text(wrapped, margin, yPosition);
          yPosition += 5;
        });
        pdf.setFont('courier', 'normal');
      } else if (line.trim().startsWith('(') && line.trim().endsWith(')')) {
        // Parentheticals - italic style (simulated with lighter text)
        pdf.setTextColor(80, 80, 80);
        const wrappedLines = pdf.splitTextToSize(line, contentWidth - 10);
        wrappedLines.forEach(wrapped => {
          checkPageBreak(5);
          pdf.text(wrapped, margin + 5, yPosition);
          yPosition += 5;
        });
        pdf.setTextColor(0, 0, 0);
      } else if (line.trim()) {
        // Regular dialogue or action
        const wrappedLines = pdf.splitTextToSize(line, contentWidth);
        wrappedLines.forEach(wrapped => {
          checkPageBreak(5);
          pdf.text(wrapped, margin, yPosition);
          yPosition += 5;
        });
      } else {
        // Empty line - add spacing
        yPosition += 3;
      }
    });

    // Save PDF
    const filename = `${transcriptObj.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`;
    pdf.save(filename);
  };

  const handleExportAllPDF = () => {
    if (transcripts.length === 0) return;

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let yPosition = margin;

    // Helper function to add new page if needed
    const checkPageBreak = (requiredSpace) => {
      if (yPosition + requiredSpace > pageHeight - margin) {
        pdf.addPage();
        yPosition = margin;
        return true;
      }
      return false;
    };

    // Cover Page
    pdf.setFillColor(147, 51, 234); // Purple
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(32);
    pdf.setFont(undefined, 'bold');
    yPosition = 80;
    const bookTitleLines = pdf.splitTextToSize(data.bookTitle || 'Animation Transcripts', contentWidth - 40);
    bookTitleLines.forEach(line => {
      pdf.text(line, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 12;
    });

    yPosition += 20;
    pdf.setFontSize(24);
    pdf.text('Complete Animation Transcripts', pageWidth / 2, yPosition, { align: 'center' });

    yPosition += 20;
    pdf.setFontSize(16);
    pdf.setFont(undefined, 'normal');
    pdf.text(`${transcripts.length} Episodes`, pageWidth / 2, yPosition, { align: 'center' });

    // Table of Contents
    pdf.addPage();
    yPosition = margin;
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(24);
    pdf.setFont(undefined, 'bold');
    pdf.text('Table of Contents', margin, yPosition);
    yPosition += 15;

    pdf.setFontSize(12);
    pdf.setFont(undefined, 'normal');
    transcripts.forEach((transcript, index) => {
      checkPageBreak(8);
      pdf.text(`${index + 1}. ${transcript.title}`, margin + 5, yPosition);
      yPosition += 8;
    });

    // Transcripts
    transcripts.forEach((transcript, index) => {
      pdf.addPage();
      yPosition = margin;

      // Transcript Header
      pdf.setFillColor(147, 51, 234); // Purple
      pdf.rect(0, 0, pageWidth, 60, 'F');

      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(24);
      pdf.setFont(undefined, 'bold');
      const titleLines = pdf.splitTextToSize(transcript.title, contentWidth - 20);
      yPosition = 25;
      titleLines.forEach(line => {
        pdf.text(line, pageWidth / 2, yPosition, { align: 'center' });
        yPosition += 10;
      });

      yPosition = 70;
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(10);
      pdf.setFont(undefined, 'normal');
      pdf.text(`Scenes: ${transcript.sceneCount} | Duration: ${transcript.estimatedDuration}`, margin, yPosition);
      if (transcript.chapterNumber) {
        yPosition += 6;
        pdf.text(`Chapter ${transcript.chapterNumber}: ${transcript.chapterTitle}`, margin, yPosition);
      }

      yPosition += 12;

      // Transcript Content
      pdf.setFont('courier', 'normal');
      const lines = transcript.transcript.split('\n');

      lines.forEach(line => {
        checkPageBreak(5);

        if (line.trim().toUpperCase() === line.trim() && line.trim().length > 0 && line.trim().length < 50) {
          pdf.setFont('courier', 'bold');
          const wrappedLines = pdf.splitTextToSize(line, contentWidth);
          wrappedLines.forEach(wrapped => {
            checkPageBreak(5);
            pdf.text(wrapped, margin, yPosition);
            yPosition += 5;
          });
          pdf.setFont('courier', 'normal');
        } else if (line.trim().startsWith('(') && line.trim().endsWith(')')) {
          pdf.setTextColor(80, 80, 80);
          const wrappedLines = pdf.splitTextToSize(line, contentWidth - 10);
          wrappedLines.forEach(wrapped => {
            checkPageBreak(5);
            pdf.text(wrapped, margin + 5, yPosition);
            yPosition += 5;
          });
          pdf.setTextColor(0, 0, 0);
        } else if (line.trim()) {
          const wrappedLines = pdf.splitTextToSize(line, contentWidth);
          wrappedLines.forEach(wrapped => {
            checkPageBreak(5);
            pdf.text(wrapped, margin, yPosition);
            yPosition += 5;
          });
        } else {
          yPosition += 3;
        }
      });
    });

    // Save PDF
    const filename = `${(data.bookTitle || 'transcripts').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_all_transcripts.pdf`;
    pdf.save(filename);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-3xl font-bold text-gray-800 mb-3">Animation Transcripts</h2>
            <p className="text-gray-600">Convert chapters into movie-style animation scripts</p>
          </div>
          {transcripts.length > 0 && (
            <button
              onClick={handleExportAllPDF}
              className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 font-semibold"
            >
              <FileText size={20} />
              Export All as PDF
            </button>
          )}
        </div>
      </div>

      {/* Generate Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Film className="text-purple-600" />
          Generate Transcript
        </h3>

        <div className="flex gap-4">
          <select
            value={selectedChapter}
            onChange={(e) => setSelectedChapter(e.target.value)}
            disabled={generatingAI}
            className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-400 outline-none"
          >
            <option value="">Select a chapter to convert...</option>
            {sortedChapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                Chapter {chapter.number}: {chapter.title}
              </option>
            ))}
          </select>

          <button
            onClick={handleGenerate}
            disabled={!selectedChapter || generatingAI}
            className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            <Sparkles size={20} className={generatingAI ? 'animate-spin' : ''} />
            {generatingAI ? 'Generating...' : 'Generate Transcript'}
          </button>
        </div>

        {sortedChapters.length === 0 && (
          <p className="text-sm text-gray-500 mt-3 italic">
            No chapters available. Create chapters first to generate transcripts.
          </p>
        )}
      </div>

      {/* Transcripts List */}
      {transcripts.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <Film className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-600 mb-2">No Transcripts Yet</h3>
          <p className="text-gray-500">Select a chapter above to generate an animation transcript</p>
        </div>
      ) : (
        <div className="space-y-4">
          {transcripts.map((transcript) => {
            const isExpanded = expandedTranscripts[transcript.id];

            return (
              <div
                key={transcript.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Header */}
                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 px-6 py-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <Film className="text-purple-600" size={24} />
                        <div>
                          <h3 className="text-xl font-bold text-gray-800">{transcript.title}</h3>
                          <div className="flex gap-4 mt-1 text-sm text-gray-600">
                            <span>📍 {transcript.sceneCount} scenes</span>
                            <span>⏱️ {transcript.estimatedDuration}</span>
                            {transcript.chapterNumber && (
                              <span>📖 Chapter {transcript.chapterNumber}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopy(transcript.transcript)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Copy to clipboard"
                      >
                        <Copy size={18} />
                      </button>
                      <button
                        onClick={() => handleDownload(transcript)}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                        title="Download as TXT"
                      >
                        <Download size={18} />
                      </button>
                      <button
                        onClick={() => handleExportPDF(transcript)}
                        className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                        title="Export as PDF"
                      >
                        <FileText size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(transcript.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete transcript"
                      >
                        <Trash2 size={18} />
                      </button>
                      <button
                        onClick={() => toggleExpand(transcript.id)}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Transcript Content */}
                {isExpanded && (
                  <div className="p-6 bg-gray-50">
                    <div className="bg-white p-6 rounded-lg border border-gray-200 font-mono text-sm whitespace-pre-wrap max-h-[600px] overflow-y-auto">
                      {transcript.transcript}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TranscriptsTab;
