/**
 * Professional Comic Book Rendering Engine
 * Creates high-quality comic pages with proper layouts, speech bubbles, and formatting
 */

export class ComicRenderer {
  constructor(options = {}) {
    this.dpi = options.dpi || 300;
    this.pageWidth = options.pageWidth || 6.625; // inches (US comic standard)
    this.pageHeight = options.pageHeight || 10.25; // inches
    this.bleed = options.bleed || 0.125; // inches
    this.margin = options.margin || 0.25; // inches
    this.gutterSize = options.gutterSize || 0.125; // inches between panels

    // Calculate pixel dimensions
    this.canvasWidth = (this.pageWidth + this.bleed * 2) * this.dpi;
    this.canvasHeight = (this.pageHeight + this.bleed * 2) * this.dpi;
  }

  /**
   * Create a canvas for rendering a comic page
   */
  createCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = this.canvasWidth;
    canvas.height = this.canvasHeight;
    return canvas;
  }

  /**
   * Calculate panel positions for different grid layouts
   * @param {string} layout - Layout type (grid-2x2, grid-2x3, grid-3x3, cinematic, etc.)
   * @param {number} panelCount - Number of panels on this page
   * @returns {Array<Object>} Panel position rectangles
   */
  calculatePanelLayout(layout, panelCount) {
    const bleedPx = this.bleed * this.dpi;
    const marginPx = this.margin * this.dpi;
    const gutterPx = this.gutterSize * this.dpi;

    const workAreaX = bleedPx + marginPx;
    const workAreaY = bleedPx + marginPx;
    const workAreaWidth = this.canvasWidth - (bleedPx + marginPx) * 2;
    const workAreaHeight = this.canvasHeight - (bleedPx + marginPx) * 2;

    const layouts = {
      'grid-2x2': this.createGrid(2, 2, workAreaX, workAreaY, workAreaWidth, workAreaHeight, gutterPx),
      'grid-2x3': this.createGrid(2, 3, workAreaX, workAreaY, workAreaWidth, workAreaHeight, gutterPx),
      'grid-3x3': this.createGrid(3, 3, workAreaX, workAreaY, workAreaWidth, workAreaHeight, gutterPx),
      'cinematic': this.createCinematicLayout(workAreaX, workAreaY, workAreaWidth, workAreaHeight, gutterPx, panelCount),
      'manga': this.createMangaLayout(workAreaX, workAreaY, workAreaWidth, workAreaHeight, gutterPx, panelCount),
    };

    return layouts[layout] || layouts['grid-2x3'];
  }

  createGrid(cols, rows, x, y, width, height, gutter) {
    const panels = [];
    const panelWidth = (width - (gutter * (cols - 1))) / cols;
    const panelHeight = (height - (gutter * (rows - 1))) / rows;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        panels.push({
          x: x + col * (panelWidth + gutter),
          y: y + row * (panelHeight + gutter),
          width: panelWidth,
          height: panelHeight,
        });
      }
    }

    return panels;
  }

  createCinematicLayout(x, y, width, height, gutter, panelCount) {
    // Wide panels for cinematic effect
    const panelHeight = (height - (gutter * (panelCount - 1))) / panelCount;
    const panels = [];

    for (let i = 0; i < panelCount; i++) {
      panels.push({
        x,
        y: y + i * (panelHeight + gutter),
        width,
        height: panelHeight,
      });
    }

    return panels;
  }

  createMangaLayout(x, y, width, height, gutter, panelCount) {
    // Dynamic manga-style layout with varying panel sizes
    const panels = [];

    if (panelCount <= 4) {
      // 2x2 grid for small counts
      return this.createGrid(2, 2, x, y, width, height, gutter).slice(0, panelCount);
    } else if (panelCount <= 6) {
      // 2x3 grid
      return this.createGrid(2, 3, x, y, width, height, gutter).slice(0, panelCount);
    } else {
      // 3x3 grid for more panels
      return this.createGrid(3, 3, x, y, width, height, gutter).slice(0, panelCount);
    }
  }

  /**
   * Render a complete comic page
   * @param {Object} pageData - Page data with panels
   * @param {string} layout - Layout type
   * @returns {Promise<HTMLCanvasElement>} Rendered canvas
   */
  async renderPage(pageData, layout = 'grid-2x3') {
    const canvas = this.createCanvas();
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const panelPositions = this.calculatePanelLayout(layout, pageData.panels.length);

    // Render each panel
    for (let i = 0; i < pageData.panels.length; i++) {
      const panel = pageData.panels[i];
      const position = panelPositions[i];

      if (!position) continue;

      await this.renderPanel(ctx, panel, position);
    }

    return canvas;
  }

  /**
   * Render a single panel
   */
  async renderPanel(ctx, panel, position) {
    const { x, y, width, height } = position;

    // Draw panel border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 8;
    ctx.strokeRect(x, y, width, height);

    // If panel has image, draw it
    if (panel.imageUrl) {
      const img = await this.loadImage(panel.imageUrl);

      // Draw image maintaining aspect ratio
      const imgAspect = img.width / img.height;
      const panelAspect = width / height;

      let drawWidth, drawHeight, imgX, imgY;

      if (imgAspect > panelAspect) {
        // Image wider - fit to width
        drawWidth = width;
        drawHeight = width / imgAspect;
        imgX = x;
        imgY = y + (height - drawHeight) / 2;
      } else {
        // Image taller - fit to height
        drawHeight = height;
        drawWidth = height * imgAspect;
        imgX = x + (width - drawWidth) / 2;
        imgY = y;
      }

      ctx.drawImage(img, imgX, imgY, drawWidth, drawHeight);
    } else {
      // No image - draw placeholder
      ctx.fillStyle = '#F0F0F0';
      ctx.fillRect(x + 4, y + 4, width - 8, height - 8);

      ctx.fillStyle = '#999999';
      ctx.font = `${this.dpi * 0.15}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No Image', x + width / 2, y + height / 2);
    }

    // Draw dialogue/caption if present
    if (panel.dialogue && panel.dialogue.trim()) {
      this.renderSpeechBubble(ctx, panel.dialogue, x, y, width, height);
    }
  }

  /**
   * Render speech bubble with dialogue
   */
  renderSpeechBubble(ctx, text, panelX, panelY, panelWidth, panelHeight) {
    const padding = 20;
    const bubbleY = panelY + panelHeight - 150; // Position near bottom
    const bubbleWidth = panelWidth - padding * 2;
    const bubbleHeight = 100;
    const bubbleX = panelX + padding;

    // Draw white bubble background
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 15);
    ctx.fill();

    // Draw black border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Render text
    ctx.fillStyle = '#000000';
    ctx.font = `bold ${this.dpi * 0.08}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Word wrap
    const words = text.split(' ');
    const lines = this.wrapText(ctx, words, bubbleWidth - 40);

    // Draw lines (max 3)
    const lineHeight = this.dpi * 0.1;
    const startY = bubbleY + bubbleHeight / 2 - ((lines.length - 1) * lineHeight) / 2;

    lines.slice(0, 3).forEach((line, idx) => {
      ctx.fillText(line, bubbleX + bubbleWidth / 2, startY + idx * lineHeight);
    });
  }

  /**
   * Word wrap helper
   */
  wrapText(ctx, words, maxWidth) {
    const lines = [];
    let currentLine = '';

    words.forEach(word => {
      const testLine = currentLine + word + ' ';
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine !== '') {
        lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        currentLine = testLine;
      }
    });

    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    return lines;
  }

  /**
   * Load image with promise
   */
  loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  /**
   * Convert canvas to blob
   */
  canvasToBlob(canvas, type = 'image/png', quality = 1.0) {
    return new Promise((resolve) => {
      canvas.toBlob(resolve, type, quality);
    });
  }
}
