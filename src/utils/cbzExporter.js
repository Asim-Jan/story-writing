import JSZip from 'jszip';
import { saveAs } from 'file-saver';

/**
 * CBZ (Comic Book Archive) Exporter
 * Creates industry-standard CBZ files from comic pages
 */
export class CBZExporter {
  constructor(options = {}) {
    this.metadata = options.metadata || {};
  }

  /**
   * Generate ComicInfo.xml metadata file
   * @param {Object} comicInfo - Comic metadata
   * @returns {string} XML string
   */
  generateComicInfoXML(comicInfo) {
    const {
      title = 'Untitled Comic',
      series = '',
      number = 1,
      summary = '',
      publisher = 'Fiction Writing Studio',
      writer = 'Unknown',
      penciller = 'AI Generated',
      colorist = 'AI Generated',
      pageCount = 0,
      year = new Date().getFullYear(),
      month = new Date().getMonth() + 1,
      day = new Date().getDate(),
      genre = 'Fiction',
      languageISO = 'en',
      manga = 'No', // Reading direction: No = Left-to-Right, Yes = Right-to-Left
    } = comicInfo;

    return `<?xml version="1.0"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>${this.escapeXml(title)}</Title>
  ${series ? `<Series>${this.escapeXml(series)}</Series>` : ''}
  <Number>${number}</Number>
  <Summary>${this.escapeXml(summary)}</Summary>
  <Publisher>${this.escapeXml(publisher)}</Publisher>
  <Writer>${this.escapeXml(writer)}</Writer>
  <Penciller>${this.escapeXml(penciller)}</Penciller>
  <Colorist>${this.escapeXml(colorist)}</Colorist>
  <PageCount>${pageCount}</PageCount>
  <Year>${year}</Year>
  <Month>${month}</Month>
  <Day>${day}</Day>
  <Genre>${this.escapeXml(genre)}</Genre>
  <LanguageISO>${languageISO}</LanguageISO>
  <Manga>${manga}</Manga>
</ComicInfo>`;
  }

  /**
   * Escape XML special characters
   */
  escapeXml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Export comic pages as CBZ file
   * @param {Array<HTMLCanvasElement>} pageCanvases - Array of rendered page canvases
   * @param {Object} metadata - Comic metadata
   * @param {string} filename - Output filename (without extension)
   */
  async exportCBZ(pageCanvases, metadata, filename = 'comic') {
    const zip = new JSZip();

    // Add metadata
    const comicInfoXML = this.generateComicInfoXML({
      ...metadata,
      pageCount: pageCanvases.length,
    });
    zip.file('ComicInfo.xml', comicInfoXML);

    // Add pages (numbered with leading zeros for proper sorting)
    for (let i = 0; i < pageCanvases.length; i++) {
      const pageNumber = String(i + 1).padStart(3, '0');
      const blob = await this.canvasToBlob(pageCanvases[i], 'image/jpeg', 0.95);

      zip.file(`page_${pageNumber}.jpg`, blob);
    }

    // Generate and download CBZ
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${filename}.cbz`);
  }

  /**
   * Convert canvas to blob
   */
  canvasToBlob(canvas, type = 'image/jpeg', quality = 0.95) {
    return new Promise((resolve) => {
      canvas.toBlob(resolve, type, quality);
    });
  }

  /**
   * Export individual pages as high-res images
   * @param {Array<HTMLCanvasElement>} pageCanvases - Array of rendered page canvases
   * @param {string} filename - Base filename
   * @param {boolean} asZip - If true, bundle in ZIP file
   */
  async exportImages(pageCanvases, filename = 'comic', asZip = false) {
    if (asZip) {
      const zip = new JSZip();

      for (let i = 0; i < pageCanvases.length; i++) {
        const pageNumber = String(i + 1).padStart(3, '0');
        const blob = await this.canvasToBlob(pageCanvases[i], 'image/png', 1.0);
        zip.file(`${filename}_page_${pageNumber}.png`, blob);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `${filename}_pages.zip`);
    } else {
      // Download individual files
      for (let i = 0; i < pageCanvases.length; i++) {
        const pageNumber = String(i + 1).padStart(3, '0');
        const blob = await this.canvasToBlob(pageCanvases[i], 'image/png', 1.0);
        saveAs(blob, `${filename}_page_${pageNumber}.png`);
      }
    }
  }
}
