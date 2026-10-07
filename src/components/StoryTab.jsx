import React, { useState } from 'react';
import { BookOpen, Edit3, Save, X, Sparkles, Plus, ChevronDown, ChevronUp, Download, FileText, Book, Settings } from 'lucide-react';
import AISuggestionBox from './AISuggestionBox';
import RichTextEditor from './RichTextEditor';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import epub from 'epub-gen-memory/bundle';
import { chapterHeading, chapterLabel } from '../utils/chapters';

const StoryTab = ({ data, setData, onGenerateChapter, generatingAI }) => {
  const [editingChapterId, setEditingChapterId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [expandedChapters, setExpandedChapters] = useState({});
  const [showStyleOptions, setShowStyleOptions] = useState(false);
  const [pdfStyle, setPdfStyle] = useState({
    fontSize: 12,
    fontFamily: 'serif',
    lineSpacing: 1.5,
    margins: 20,
    includePageNumbers: true,
    includeCover: true,
    includeToC: true
  });

  const sortedChapters = [...data.chapters].sort((a, b) => {
    const numA = parseInt(a.number) || 0;
    const numB = parseInt(b.number) || 0;
    return numA - numB;
  });

  const handleEdit = (chapter) => {
    setEditingChapterId(chapter.id);
    setEditContent(chapter.content);
  };

  const handleSave = (chapterId) => {
    setData(prev => ({
      ...prev,
      chapters: prev.chapters.map(ch =>
        ch.id === chapterId ? { ...ch, content: editContent } : ch
      )
    }));
    setEditingChapterId(null);
    setEditContent('');
  };

  const handleCancel = () => {
    setEditingChapterId(null);
    setEditContent('');
  };

  const handleGenerateChapter = async () => {
    if (!aiPrompt.trim()) return;

    const result = await onGenerateChapter('chapter', aiPrompt);
    if (result) {
      setAiSuggestion(result);
    }
  };

  const handleAcceptChapter = () => {
    if (!aiSuggestion) return;

    const newChapter = {
      id: Date.now(),
      number: (sortedChapters.length + 1).toString(),
      title: aiSuggestion.title || 'Untitled Chapter',
      summary: aiSuggestion.summary || '',
      content: aiSuggestion.content || '',
      wordCount: (aiSuggestion.content || '').trim().split(/\s+/).filter(w => w).length
    };

    setData(prev => ({
      ...prev,
      chapters: [...prev.chapters, newChapter]
    }));

    setAiSuggestion(null);
    setAiPrompt('');
    setShowAIGenerator(false);
  };

  const handleRejectChapter = () => {
    setAiSuggestion(null);
  };

  const handleRegenerateChapter = () => {
    handleGenerateChapter();
  };

  const toggleChapter = (chapterId) => {
    setExpandedChapters(prev => ({
      ...prev,
      [chapterId]: !prev[chapterId]
    }));
  };

  const handleExportPDF = async () => {
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

    // Helper function to detect image format from Data URL or filename
    const getImageFormat = (imageSource) => {
      if (imageSource.startsWith('data:image/')) {
        const format = imageSource.substring(11, imageSource.indexOf(';'));
        if (format === 'jpeg' || format === 'jpg') return 'JPEG';
        if (format === 'png') return 'PNG';
        if (format === 'gif') return 'GIF';
        if (format === 'webp') return 'WEBP';
        return 'JPEG'; // default fallback
      }
      // For URL-based images, try to detect from extension
      const lowerSrc = imageSource.toLowerCase();
      if (lowerSrc.includes('.png')) return 'PNG';
      if (lowerSrc.includes('.gif')) return 'GIF';
      if (lowerSrc.includes('.webp')) return 'WEBP';
      return 'JPEG'; // default for URLs
    };

    // Helper function to add new page if needed
    const checkPageBreak = (requiredSpace) => {
      if (yPosition + requiredSpace > pageHeight - margin) {
        pdf.addPage();
        yPosition = margin;
        return true;
      }
      return false;
    };

    // Cover Page - Full page image
    if (data.metadata?.coverImage) {
      try {
        const imageFormat = getImageFormat(data.metadata.coverImage);

        // For base64 images, we can directly add them without creating Image object
        if (data.metadata.coverImage.startsWith('data:image/')) {
          // Extract just the base64 data
          const base64Data = data.metadata.coverImage;

          // Create temporary image to get dimensions
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = base64Data;
          });

          // Calculate dimensions to fill entire page while maintaining aspect ratio
          const imgRatio = img.width / img.height;
          const pageRatio = pageWidth / pageHeight;

          let imgWidth, imgHeight, imgX, imgY;

          if (imgRatio > pageRatio) {
            imgHeight = pageHeight;
            imgWidth = imgHeight * imgRatio;
            imgX = (pageWidth - imgWidth) / 2;
            imgY = 0;
          } else {
            imgWidth = pageWidth;
            imgHeight = imgWidth / imgRatio;
            imgX = 0;
            imgY = (pageHeight - imgHeight) / 2;
          }

          pdf.addImage(base64Data, imageFormat, imgX, imgY, imgWidth, imgHeight);
        } else {
          // For URL-based images
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = data.metadata.coverImage;
          });

          // Calculate dimensions to fill entire page while maintaining aspect ratio
          const imgRatio = img.width / img.height;
          const pageRatio = pageWidth / pageHeight;

          let imgWidth, imgHeight, imgX, imgY;

          if (imgRatio > pageRatio) {
            imgHeight = pageHeight;
            imgWidth = imgHeight * imgRatio;
            imgX = (pageWidth - imgWidth) / 2;
            imgY = 0;
          } else {
            imgWidth = pageWidth;
            imgHeight = imgWidth / imgRatio;
            imgX = 0;
            imgY = (pageHeight - imgHeight) / 2;
          }

          pdf.addImage(img, imageFormat, imgX, imgY, imgWidth, imgHeight);
        }
      } catch (error) {
        console.error('Error loading cover image:', error);
        // Fallback to colored page
        pdf.setFillColor(79, 70, 229);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      }
    } else {
      // No cover image - use colored background
      pdf.setFillColor(79, 70, 229);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
    }

    // Title Page (second page with title and author)
    pdf.addPage();
    pdf.setFillColor(79, 70, 229); // Indigo
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(32);
    pdf.setFont(undefined, 'bold');
    yPosition = 100;
    const titleLines = pdf.splitTextToSize(data.bookTitle || 'Untitled Book', contentWidth - 40);
    titleLines.forEach(line => {
      pdf.text(line, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 12;
    });

    // Author
    if (data.metadata?.author) {
      yPosition += 20;
      pdf.setFontSize(24);
      pdf.setFont(undefined, 'normal');
      pdf.text(`by ${data.metadata.author}`, pageWidth / 2, yPosition, { align: 'center' });
    }

    // Add new page for content
    pdf.addPage();
    yPosition = margin;
    pdf.setTextColor(0, 0, 0);

    // Table of Contents
    pdf.setFontSize(24);
    pdf.setFont(undefined, 'bold');
    pdf.text('Table of Contents', margin, yPosition);
    yPosition += 15;

    pdf.setFontSize(12);
    pdf.setFont(undefined, 'normal');
    sortedChapters.forEach((chapter, index) => {
      checkPageBreak(10);
      const chapterText = chapterHeading(chapter);
      pdf.text(chapterText, margin + 5, yPosition);
      yPosition += 8;
    });

    // Chapters
    for (const chapter of sortedChapters) {
      // Chapter Intro Page with background image
      pdf.addPage();

      // Add chapter cover image as background if available
      if (chapter.coverImage) {
        try {
          const imageFormat = getImageFormat(chapter.coverImage);

          // For base64 images
          if (chapter.coverImage.startsWith('data:image/')) {
            const base64Data = chapter.coverImage;

            // Create temporary image to get dimensions
            const img = new Image();
            await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
              img.src = base64Data;
            });

            // Calculate dimensions to fill entire page
            const imgRatio = img.width / img.height;
            const pageRatio = pageWidth / pageHeight;

            let imgWidth, imgHeight, imgX, imgY;

            if (imgRatio > pageRatio) {
              imgHeight = pageHeight;
              imgWidth = imgHeight * imgRatio;
              imgX = (pageWidth - imgWidth) / 2;
              imgY = 0;
            } else {
              imgWidth = pageWidth;
              imgHeight = imgWidth / imgRatio;
              imgX = 0;
              imgY = (pageHeight - imgHeight) / 2;
            }

            pdf.addImage(base64Data, imageFormat, imgX, imgY, imgWidth, imgHeight);
          } else {
            // For URL-based images
            const img = new Image();
            img.crossOrigin = 'anonymous';
            await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
              img.src = chapter.coverImage;
            });

            // Calculate dimensions to fill entire page
            const imgRatio = img.width / img.height;
            const pageRatio = pageWidth / pageHeight;

            let imgWidth, imgHeight, imgX, imgY;

            if (imgRatio > pageRatio) {
              imgHeight = pageHeight;
              imgWidth = imgHeight * imgRatio;
              imgX = (pageWidth - imgWidth) / 2;
              imgY = 0;
            } else {
              imgWidth = pageWidth;
              imgHeight = imgWidth / imgRatio;
              imgX = 0;
              imgY = (pageHeight - imgHeight) / 2;
            }

            pdf.addImage(img, imageFormat, imgX, imgY, imgWidth, imgHeight);
          }

          // Add semi-transparent overlay for text readability
          pdf.setFillColor(0, 0, 0);
          pdf.setGState(new pdf.GState({ opacity: 0.5 }));
          pdf.rect(0, 0, pageWidth, pageHeight, 'F');
          pdf.setGState(new pdf.GState({ opacity: 1 }));
        } catch (error) {
          console.error('Error loading chapter image:', error);
          // Fallback to gradient
          pdf.setFillColor(79, 70, 229);
          pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        }
      } else {
        // No chapter image - use gradient background
        pdf.setFillColor(79, 70, 229);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      }

      // Chapter Number and Title on intro page
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(28);
      pdf.setFont(undefined, 'bold');
      yPosition = pageHeight / 2 - 20;
      // a title like "Prologue" or "Chapter One" stands alone
      if (chapterLabel(chapter)) pdf.text(chapterLabel(chapter), pageWidth / 2, yPosition, { align: 'center' });

      yPosition += 15;
      pdf.setFontSize(36);
      const titleLines = pdf.splitTextToSize(chapter.title, contentWidth - 40);
      titleLines.forEach(line => {
        pdf.text(line, pageWidth / 2, yPosition, { align: 'center' });
        yPosition += 14;
      });

      // Chapter Content - starts on new page
      pdf.addPage();
      yPosition = margin;
      pdf.setFontSize(12);
      pdf.setFont(undefined, 'normal');
      pdf.setTextColor(0, 0, 0);

      if (chapter.content) {
        // Split content into paragraphs
        const paragraphs = chapter.content.split(/\n\n+/);

        paragraphs.forEach((paragraph, pIndex) => {
          if (paragraph.trim()) {
            const lines = pdf.splitTextToSize(paragraph.trim(), contentWidth);

            lines.forEach(line => {
              checkPageBreak(7);
              pdf.text(line, margin, yPosition);
              yPosition += 7;
            });

            // Add space between paragraphs
            yPosition += 5;
          }
        });
      } else {
        pdf.setTextColor(150, 150, 150);
        pdf.setFont(undefined, 'italic');
        pdf.text('No content for this chapter yet.', margin, yPosition);
      }
    }

    // Ending Page with Book Information
    pdf.addPage();
    pdf.setFillColor(79, 70, 229); // Indigo
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(28);
    pdf.setFont(undefined, 'bold');
    yPosition = 60;
    pdf.text('THE END', pageWidth / 2, yPosition, { align: 'center' });

    yPosition += 30;

    // Book Information Section
    pdf.setFontSize(16);
    pdf.setFont(undefined, 'normal');

    if (data.bookTitle) {
      const titleLines = pdf.splitTextToSize(data.bookTitle, contentWidth - 40);
      titleLines.forEach(line => {
        pdf.text(line, pageWidth / 2, yPosition, { align: 'center' });
        yPosition += 8;
      });
      yPosition += 5;
    }

    if (data.metadata?.author) {
      pdf.setFontSize(14);
      pdf.text(`Written by ${data.metadata.author}`, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 15;
    }

    // Additional metadata
    pdf.setFontSize(12);
    const metadata = [];

    if (data.metadata?.genre) {
      metadata.push(`Genre: ${data.metadata.genre}`);
    }

    if (data.metadata?.targetAudience) {
      metadata.push(`Audience: ${data.metadata.targetAudience}`);
    }

    metadata.push(`Chapters: ${sortedChapters.length}`);
    metadata.push(`Total Words: ${totalWords.toLocaleString()}`);

    if (data.metadata?.series) {
      metadata.push(`Series: ${data.metadata.series}`);
    }

    metadata.forEach(info => {
      pdf.text(info, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 7;
    });

    // Tagline or blurb at bottom
    if (data.metadata?.tagline || data.overview) {
      yPosition = pageHeight - 60;
      pdf.setFontSize(11);
      pdf.setFont(undefined, 'italic');
      const tagline = data.metadata?.tagline || data.overview;
      const taglineLines = pdf.splitTextToSize(tagline, contentWidth - 40);
      taglineLines.forEach(line => {
        pdf.text(line, pageWidth / 2, yPosition, { align: 'center' });
        yPosition += 6;
      });
    }

    // Generated date at very bottom
    yPosition = pageHeight - 20;
    pdf.setFontSize(9);
    pdf.setFont(undefined, 'normal');
    pdf.text(`Generated on ${new Date().toLocaleDateString()}`, pageWidth / 2, yPosition, { align: 'center' });

    // Save PDF
    const filename = `${(data.bookTitle || 'book').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`;
    pdf.save(filename);
  };

  // Export as DOCX
  const handleExportDOCX = async () => {
    const sections = [];

    // Title page
    sections.push(
      new Paragraph({
        text: data.bookTitle || 'Untitled Book',
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { before: 2000, after: 1000 }
      })
    );

    if (data.metadata?.author) {
      sections.push(
        new Paragraph({
          text: `by ${data.metadata.author}`,
          alignment: AlignmentType.CENTER,
          spacing: { after: 2000 }
        })
      );
    }

    // Page break
    sections.push(
      new Paragraph({ text: '', pageBreakBefore: true })
    );

    // Table of Contents
    sections.push(
      new Paragraph({
        text: 'Table of Contents',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      })
    );

    sortedChapters.forEach((chapter) => {
      sections.push(
        new Paragraph({
          text: chapterHeading(chapter),
          spacing: { before: 100, after: 100 }
        })
      );
    });

    // Chapters
    sortedChapters.forEach((chapter) => {
      // Chapter title page
      sections.push(
        new Paragraph({ text: '', pageBreakBefore: true })
      );

      if (chapterLabel(chapter)) {
        sections.push(
          new Paragraph({
            text: chapterLabel(chapter),
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { before: 1000, after: 400 }
          })
        );
      }

      sections.push(
        new Paragraph({
          text: chapter.title,
          heading: HeadingLevel.HEADING_2,
          alignment: AlignmentType.CENTER,
          spacing: { after: 1000 }
        })
      );

      // Chapter content
      if (chapter.content) {
        const paragraphs = chapter.content.split(/\n\n+/);
        paragraphs.forEach((para) => {
          if (para.trim()) {
            sections.push(
              new Paragraph({
                text: para.trim(),
                spacing: { before: 200, after: 200 },
                indent: { firstLine: 720 } // 0.5 inch indent
              })
            );
          }
        });
      }
    });

    // Create document
    const doc = new Document({
      sections: [{
        properties: {},
        children: sections
      }]
    });

    // Generate and save
    const blob = await Packer.toBlob(doc);
    const filename = `${(data.bookTitle || 'book').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.docx`;
    saveAs(blob, filename);
  };

  // Export as EPUB (client-side generation)
  const handleExportEPUB = async () => {
    try {
      console.log('Starting EPUB export...');
      console.log('sortedChapters:', sortedChapters);

      if (!sortedChapters || sortedChapters.length === 0) {
        alert('No chapters to export');
        return;
      }

      // Check if any chapters have content
      const chaptersWithContent = sortedChapters.filter(ch => ch.content && ch.content.trim());
      if (chaptersWithContent.length === 0) {
        if (!confirm('Warning: No chapters have content written yet. The EPUB will contain chapter titles only. Continue?')) {
          return;
        }
      } else if (chaptersWithContent.length < sortedChapters.length) {
        const emptyCount = sortedChapters.length - chaptersWithContent.length;
        if (!confirm(`Warning: ${emptyCount} chapter(s) don't have content yet. They will show "No content available". Continue?`)) {
          return;
        }
      }

      // Prepare chapter data for EPUB
      const chapters = sortedChapters.map((chapter) => {
        console.log('Processing chapter:', chapter.number, chapter.title, 'content length:', chapter.content?.length);

        // Handle missing or undefined content
        const rawContent = chapter.content || '';

        const contentHtml = rawContent.trim()
          ? rawContent.split(/\n\n+/).map(p => {
              if (!p || typeof p !== 'string' || !p.trim()) {
                return '';
              }
              return `<p>${p.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
            }).filter(p => p).join('\n')
          : '<p><em>No content available for this chapter</em></p>';

        // Don't duplicate the heading - epub-gen-memory renders the title automatically
        console.log('Generated content length for chapter', chapter.number, ':', contentHtml.length);

        return {
          title: chapterHeading(chapter),
          content: contentHtml  // Just the content, no duplicate heading
        };
      });

      console.log('Generated chapters array:', chapters.length, 'chapters');
      console.log('First chapter sample:', chapters[0]);

      const options = {
        title: data.bookTitle || 'Untitled Book',
        author: [data.metadata?.author || 'Unknown Author'], // Must be array
        publisher: 'Fiction Writing Studio',
        description: data.overview || 'A story created with Fiction Writing Studio',
        version: 3
      };

      // Don't include cover if it's a data URL (not supported in browser version)
      if (data.metadata?.coverImage && !data.metadata.coverImage.startsWith('data:')) {
        options.cover = data.metadata.coverImage;
      }

      console.log('Calling epub() with options:', options);
      console.log('Content (chapters):', chapters);

      // Generate EPUB in browser - Pass options as first param, content as second param
      const epubBlob = await epub(options, chapters);

      console.log('EPUB generated, blob size:', epubBlob.size);

      const filename = `${(data.bookTitle || 'book').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.epub`;
      saveAs(epubBlob, filename);

      alert('EPUB exported successfully!');
    } catch (error) {
      console.error('EPUB export error:', error);
      console.error('Error stack:', error.stack);
      alert('Failed to export as EPUB: ' + error.message);
    }
  };

  const totalWords = sortedChapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header Stats */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-6 mb-4 pb-4 border-b border-[var(--line)]">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold text-[var(--ink)] mb-1">{data.bookTitle}</h2>
            <p className="text-sm text-[var(--dim)] line-clamp-2">{data.overview}</p>
          </div>
          <div className="text-right flex-none">
            <div className="text-2xl font-bold text-[var(--ink)] num">{sortedChapters.length}</div>
            <div className="lbl">Chapters</div>
            <div className="text-lg font-semibold text-[var(--ink)] num mt-2">{totalWords.toLocaleString()}</div>
            <div className="lbl">Total Words</div>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setShowStyleOptions(!showStyleOptions)}
            className="btn"
            title="Export Options"
          >
            <Settings size={20} />
          </button>
          <button
            onClick={handleExportPDF}
            disabled={sortedChapters.length === 0}
            className="btn"
          >
            <Download size={20} />
            PDF
          </button>
          <button
            onClick={handleExportDOCX}
            disabled={sortedChapters.length === 0}
            className="btn"
          >
            <FileText size={20} />
            DOCX
          </button>
          <button
            onClick={handleExportEPUB}
            disabled={sortedChapters.length === 0}
            className="btn"
          >
            <Book size={20} />
            EPUB
          </button>
        </div>

        {/* Style Options Panel */}
        {showStyleOptions && (
          <div className="card mt-4 p-5">
            <p className="lbl rule2 inline-block mb-4">
              <Settings size={13} />
              PDF Export Options
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="lbl block mb-1.5">Font Size</label>
                <select
                  value={pdfStyle.fontSize}
                  onChange={(e) => setPdfStyle({...pdfStyle, fontSize: parseInt(e.target.value)})}
                  className="w-full p-2 text-sm"
                >
                  <option value="10">10pt (Small)</option>
                  <option value="12">12pt (Standard)</option>
                  <option value="14">14pt (Large)</option>
                  <option value="16">16pt (Extra Large)</option>
                </select>
              </div>

              <div>
                <label className="lbl block mb-1.5">Line Spacing</label>
                <select
                  value={pdfStyle.lineSpacing}
                  onChange={(e) => setPdfStyle({...pdfStyle, lineSpacing: parseFloat(e.target.value)})}
                  className="w-full p-2 text-sm"
                >
                  <option value="1">Single</option>
                  <option value="1.5">1.5 Lines</option>
                  <option value="2">Double</option>
                </select>
              </div>

              <div>
                <label className="lbl block mb-1.5">Margins (mm)</label>
                <select
                  value={pdfStyle.margins}
                  onChange={(e) => setPdfStyle({...pdfStyle, margins: parseInt(e.target.value)})}
                  className="w-full p-2 text-sm"
                >
                  <option value="15">Narrow (15mm)</option>
                  <option value="20">Normal (20mm)</option>
                  <option value="25">Wide (25mm)</option>
                </select>
              </div>

              <div>
                <label className="lbl block mb-1.5">Font Family</label>
                <select
                  value={pdfStyle.fontFamily}
                  onChange={(e) => setPdfStyle({...pdfStyle, fontFamily: e.target.value})}
                  className="w-full p-2 text-sm"
                >
                  <option value="serif">Serif (Times)</option>
                  <option value="sans-serif">Sans-serif (Helvetica)</option>
                  <option value="monospace">Monospace (Courier)</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pdfStyle.includeCover}
                    onChange={(e) => setPdfStyle({...pdfStyle, includeCover: e.target.checked})}
                    className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                  />
                  Include Cover Image
                </label>
              </div>

              <div className="col-span-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pdfStyle.includeToC}
                    onChange={(e) => setPdfStyle({...pdfStyle, includeToC: e.target.checked})}
                    className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                  />
                  Include Table of Contents
                </label>
              </div>

              <div className="col-span-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pdfStyle.includePageNumbers}
                    onChange={(e) => setPdfStyle({...pdfStyle, includePageNumbers: e.target.checked})}
                    className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                  />
                  Include Page Numbers
                </label>
              </div>
            </div>

            <div className="mt-4 text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
              <strong>Note:</strong> These options will be applied the next time you export as PDF
            </div>
          </div>
        )}
      </div>

      {/* AI Chapter Generator */}
      <div className="mb-6">
        <button
          onClick={() => setShowAIGenerator(!showAIGenerator)}
          className="w-full px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 font-semibold"
        >
          <Plus size={20} />
          Generate New Chapter with AI
        </button>

        {showAIGenerator && (
          <div className="mt-4 bg-purple-50 border-2 border-purple-200 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Sparkles className="text-purple-600" size={24} />
              <h3 className="text-xl font-bold text-purple-900">AI Chapter Generator</h3>
            </div>

            {!aiSuggestion && (
              <>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Describe what should happen in this chapter. E.g., 'The protagonist confronts the antagonist in the abandoned warehouse'"
                  className="w-full p-4 border border-purple-300 rounded-lg resize-none h-32 focus:ring-2 focus:ring-purple-400 outline-none mb-4"
                  disabled={generatingAI}
                />
                <div className="flex gap-3">
                  <button
                    onClick={handleGenerateChapter}
                    disabled={generatingAI || !aiPrompt.trim()}
                    className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                  >
                    <Sparkles size={20} />
                    {generatingAI ? 'Generating...' : 'Generate Chapter'}
                  </button>
                  <button
                    onClick={() => {
                      setShowAIGenerator(false);
                      setAiPrompt('');
                    }}
                    className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {aiSuggestion && (
              <AISuggestionBox
                suggestion={aiSuggestion}
                onAccept={handleAcceptChapter}
                onReject={handleRejectChapter}
                onRegenerate={handleRegenerateChapter}
                loading={generatingAI}
                title="AI Generated Chapter"
              />
            )}
          </div>
        )}
      </div>

      {/* Chapters List */}
      {sortedChapters.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <BookOpen className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-600 mb-2">No Chapters Yet</h3>
          <p className="text-gray-500">Start writing your story by generating or adding chapters</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedChapters.map((chapter, index) => {
            const isEditing = editingChapterId === chapter.id;
            const isExpanded = expandedChapters[chapter.id];

            return (
              <div
                key={chapter.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Chapter Header */}
                <div className="bg-gradient-to-r from-indigo-50 to-purple-50 px-6 py-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        {chapterLabel(chapter) && (
                          <span className="px-3 py-1 bg-indigo-600 text-white rounded-full text-sm font-bold">
                            {chapterLabel(chapter)}
                          </span>
                        )}
                        <h3 className="text-xl font-bold text-gray-800">{chapter.title}</h3>
                      </div>
                      {chapter.summary && (
                        <p className="text-sm text-gray-600 mt-2 ml-20">{chapter.summary}</p>
                      )}
                      {chapter.wordCount > 0 && (
                        <p className="text-sm text-indigo-600 font-semibold mt-1 ml-20">
                          {chapter.wordCount.toLocaleString()} words
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!isEditing && (
                        <button
                          onClick={() => handleEdit(chapter)}
                          className="p-2 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors"
                          title="Edit chapter"
                        >
                          <Edit3 size={18} />
                        </button>
                      )}
                      <button
                        onClick={() => toggleChapter(chapter.id)}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Chapter Content */}
                {isExpanded && (
                  <div className="p-6">
                    {isEditing ? (
                      <>
                        <RichTextEditor
                          value={editContent}
                          onChange={setEditContent}
                          placeholder="Write your chapter content here..."
                          autoFocus={true}
                        />
                        <div className="flex gap-3 mt-4">
                          <button
                            onClick={() => handleSave(chapter.id)}
                            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 font-semibold"
                          >
                            <Save size={18} />
                            Save Changes
                          </button>
                          <button
                            onClick={handleCancel}
                            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex items-center gap-2 font-semibold"
                          >
                            <X size={18} />
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="prose prose-lg max-w-none">
                        {chapter.content ? (
                          <div className="font-serif text-lg leading-relaxed text-gray-800 whitespace-pre-wrap">
                            {chapter.content}
                          </div>
                        ) : (
                          <p className="text-gray-400 italic">No content yet</p>
                        )}
                      </div>
                    )}
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

export default StoryTab;
