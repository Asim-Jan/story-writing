// The book's art style: one look for every image the book makes (portraits,
// reference sheets, location and chapter pictures, the cover, comic panels,
// film keyframes). Without it each image picked its own, some realistic, some
// cartoon. book.metadata.artStyle = { id, custom? } ('custom': the author's words).
// The ids match the film styles where they overlap, so a film defaults to it.

export const ART_STYLES = {
  'live-action': {
    label: 'Realistic',
    prompt: 'photorealistic, natural cinematic lighting, shot on 35mm, realistic skin and fabric',
    negative: 'cartoon, anime, 3D render, CGI character, illustration, painting, drawing',
  },
  animated: {
    label: '3D animated',
    prompt: 'stylised 3D animated feature film, expressive character design, soft cinematic lighting, rich colour',
    negative: 'photorealistic, live action, photograph, real people, 2D anime, sketch',
  },
  anime: {
    label: 'Anime',
    prompt: '2D anime, clean cel shading, crisp line art, painted backgrounds',
    negative: 'photorealistic, live action, photograph, 3D render, CGI',
  },
  storybook: {
    label: 'Storybook',
    prompt: 'painterly storybook illustration, soft watercolour and gouache textures, warm light',
    negative: 'photorealistic, live action, photograph, 3D render, anime',
  },
  comic: {
    label: 'Comic book',
    prompt: 'graphic novel comic art, bold ink lines, flat colours with halftone shading',
    negative: 'photorealistic, photograph, 3D render, watercolour',
  },
  painting: {
    label: 'Painted',
    prompt: 'digital painting, fantasy book illustration, painterly brushwork, dramatic lighting',
    negative: 'photograph, photorealistic, 3D render, anime, cartoon',
  },
};

/** The book's style as { id, label, prompt, negative }, or null when it has none. */
export function artStyleOf(book) {
  const s = book?.metadata?.artStyle;
  if (!s?.id) return null;
  if (s.id === 'custom') {
    const custom = String(s.custom || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return custom ? { id: 'custom', label: 'Custom', prompt: custom, negative: '' } : null;
  }
  return ART_STYLES[s.id] ? { id: s.id, ...ART_STYLES[s.id] } : null;
}

/** Two negative prompts as one, without repeats. */
export const joinNegatives = (...parts) => [...new Set(parts.join(', ').split(',').map(s => s.trim()).filter(Boolean))].join(', ');
