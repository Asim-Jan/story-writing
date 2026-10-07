// The book's art style (book.metadata.artStyle = { id, custom? }): one look
// for every image the book makes. Mirrors server/services/artStyles.js, which
// applies it; this side only picks and shows it.

export const ART_STYLES = [
  { id: 'live-action', label: 'Realistic', description: 'Photoreal, like stills from a live-action film.', prompt: 'photorealistic, natural cinematic lighting, shot on 35mm, realistic skin and fabric' },
  { id: 'animated', label: '3D animated', description: 'Stylised 3D animation, expressive characters, soft light.', prompt: 'stylised 3D animated feature film, expressive character design, soft cinematic lighting, rich colour' },
  { id: 'anime', label: 'Anime', description: '2D anime with cel shading and clean line art.', prompt: '2D anime, clean cel shading, crisp line art, painted backgrounds' },
  { id: 'storybook', label: 'Storybook', description: 'Watercolour and gouache, like a picture book.', prompt: 'painterly storybook illustration, soft watercolour and gouache textures, warm light' },
  { id: 'comic', label: 'Comic book', description: 'Graphic novel art: bold ink lines, flat colour.', prompt: 'graphic novel comic art, bold ink lines, flat colours with halftone shading' },
  { id: 'painting', label: 'Painted', description: 'Digital painting, like a fantasy book illustration.', prompt: 'digital painting, fantasy book illustration, painterly brushwork, dramatic lighting' },
];

/** The book's style as { id, label, prompt } (custom: the author's words), or null. */
export const bookArtStyle = (book) => {
  const s = book?.metadata?.artStyle;
  if (!s?.id) return null;
  if (s.id === 'custom') {
    const custom = String(s.custom || '').trim();
    return custom ? { id: 'custom', label: 'Custom', prompt: custom } : null;
  }
  return ART_STYLES.find(a => a.id === s.id) || null;
};
