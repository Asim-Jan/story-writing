import { jsPDF } from 'jspdf';

/**
 * Professional Comic PDF Exporter
 * Creates print-ready PDF files from comic pages
 */
export class ComicPDFExporter {
  constructor(options = {}) {
    this.dpi = options.dpi || 300;
    this.pageWidth = options.pageWidth || 6.625; // inches
    this.pageHeight = options.pageHeight || 10.25; // inches
  }

  /**
   * Export comic pages as PDF
   * @param {Array<HTMLCanvasElement>} pageCanvases - Array of rendered page canvases
   * @param {Object} metadata - Comic metadata
   * @param {string} filename - Output filename (without extension)
   */
  async exportPDF(pageCanvases, metadata, filename = 'comic') {
    // Create PDF with custom dimensions
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'in',
      format: [this.pageWidth, this.pageHeight],
      compress: true,
    });

    // Set metadata
    pdf.setProperties({
      title: metadata.title || 'Untitled Comic',
      author: metadata.writer || 'Unknown',
      subject: metadata.summary || '',
      keywords: metadata.genre || 'comic',
      creator: 'Fiction Writing Studio',
    });

    // Add pages
    for (let i = 0; i < pageCanvases.length; i++) {
      if (i > 0) {
        pdf.addPage([this.pageWidth, this.pageHeight], 'portrait');
      }

      // Convert canvas to image data
      const imgData = pageCanvases[i].toDataURL('image/jpeg', 0.95);

      // Add image to PDF (full page, respecting margins)
      pdf.addImage(
        imgData,
        'JPEG',
        0,
        0,
        this.pageWidth,
        this.pageHeight,
        undefined,
        'FAST' // Compression
      );

      // Add page number at bottom
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100);
      pdf.text(
        `${i + 1}`,
        this.pageWidth / 2,
        this.pageHeight - 0.15,
        { align: 'center' }
      );
    }

    // Save PDF
    pdf.save(`${filename}.pdf`);
  }

  /**
   * Export single page as PDF
   * @param {HTMLCanvasElement} pageCanvas - Rendered page canvas
   * @param {Object} metadata - Comic metadata
   * @param {number} pageNumber - Page number
   * @param {string} filename - Output filename
   */
  async exportSinglePage(pageCanvas, metadata, pageNumber, filename = 'comic-page') {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'in',
      format: [this.pageWidth, this.pageHeight],
      compress: true,
    });

    pdf.setProperties({
      title: `${metadata.title || 'Comic'} - Page ${pageNumber}`,
      author: metadata.writer || 'Unknown',
      creator: 'Fiction Writing Studio',
    });

    const imgData = pageCanvas.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData, 'JPEG', 0, 0, this.pageWidth, this.pageHeight);

    // Add page number
    pdf.setFontSize(8);
    pdf.setTextColor(100, 100, 100);
    pdf.text(
      `${pageNumber}`,
      this.pageWidth / 2,
      this.pageHeight - 0.15,
      { align: 'center' }
    );

    pdf.save(`${filename}_page_${pageNumber}.pdf`);
  }
}
