import path from 'path';
import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import { htmlToText, cleanText } from './text.js';

// ePub: use the book's own structure. The reading order is the OPF spine; the
// titles come from the table of contents (EPUB 3 nav, else EPUB 2 NCX); the
// semantic hints (epub:type, guide/landmarks) say what is front or back
// matter. The old parser flattened everything into one string and guessed
// chapters again from scratch.

const posix = path.posix;

function resolveHref(base, href) {
  const [file] = String(href || '').split('#');
  return posix.normalize(posix.join(posix.dirname(base), decodeURIComponent(file)));
}

export async function parseEpub(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (name) => {
    const f = zip.file(name);
    if (!f) throw Object.assign(new Error(`This ePub is missing ${name}`), { status: 400 });
    return f.async('string');
  };

  const container = cheerio.load(await read('META-INF/container.xml'), { xmlMode: true });
  const opfPath = container('rootfile').attr('full-path');
  if (!opfPath) throw Object.assign(new Error('This ePub has no package file'), { status: 400 });
  const opf = cheerio.load(await read(opfPath), { xmlMode: true });

  const meta = {
    title: cleanText(opf('metadata > dc\\:title, metadata > title').first().text()) || null,
    author: cleanText(opf('metadata > dc\\:creator, metadata > creator').first().text()) || null,
    language: cleanText(opf('metadata > dc\\:language, metadata > language').first().text()) || null,
  };

  const manifest = {};
  opf('manifest > item').each((_, el) => {
    const a = el.attribs;
    manifest[a.id] = { href: resolveHref(opfPath, a.href), type: a['media-type'], props: a.properties || '' };
  });

  // titles and semantics from the table of contents and landmarks
  const titles = {};
  const semantics = {};
  const landmarkTitles = {};
  const navItem = Object.values(manifest).find(m => /\bnav\b/.test(m.props));
  if (navItem && zip.file(navItem.href)) {
    const nav = cheerio.load(await read(navItem.href), { xmlMode: true });
    nav('nav').each((_, n) => {
      const kind = n.attribs['epub:type'] || '';
      nav(n).find('a[href]').each((__, a) => {
        const target = resolveHref(navItem.href, a.attribs.href);
        if (/toc/.test(kind) && !titles[target]) titles[target] = cleanText(nav(a).text());
        if (/landmarks/.test(kind) && a.attribs['epub:type']) {
          semantics[target] = a.attribs['epub:type'];
          if (!landmarkTitles[target]) landmarkTitles[target] = cleanText(nav(a).text());
        }
      });
    });
  }
  const ncxId = opf('spine').attr('toc');
  const ncxItem = (ncxId && manifest[ncxId]) || Object.values(manifest).find(m => /ncx/.test(m.type || ''));
  if (ncxItem && zip.file(ncxItem.href)) {
    const ncx = cheerio.load(await read(ncxItem.href), { xmlMode: true });
    ncx('navPoint').each((_, np) => {
      const src = ncx(np).children('content').attr('src');
      const label = cleanText(ncx(np).children('navLabel').text());
      if (src) {
        const target = resolveHref(ncxItem.href, src);
        if (!titles[target] && label) titles[target] = label;
      }
    });
  }
  opf('guide > reference').each((_, r) => {
    const target = resolveHref(opfPath, r.attribs.href);
    if (!semantics[target] && r.attribs.type) semantics[target] = r.attribs.type;
  });

  // the spine, in reading order
  const sections = [];
  const spine = opf('spine > itemref').toArray();
  for (const ref of spine) {
    const item = manifest[ref.attribs.idref];
    if (!item || !/html|xml/.test(item.type || '') || !zip.file(item.href)) continue;
    const html = await read(item.href);
    const $ = cheerio.load(html, { xmlMode: false });
    const bodyType = $('body').attr('epub:type') || $('section[epub\\:type]').first().attr('epub:type') || '';
    const heading = cleanText($('h1, h2, h3').first().text()) || landmarkTitles[item.href] || cleanText($('head > title').first().text());
    const text = htmlToText(html);
    if (!text) continue; // an image-only page (cover art) has no words to import
    sections.push({
      title: titles[item.href] || heading || null,
      content: text,
      hints: [bodyType, semantics[item.href] || '', posix.basename(item.href), ref.attribs.linear === 'no' ? 'nonlinear' : ''].filter(Boolean).join(' '),
      source: titles[item.href] ? 'toc' : heading ? 'heading' : 'whole',
    });
  }
  if (sections.length === 0) throw Object.assign(new Error('No readable text found in this ePub'), { status: 400 });
  return { meta, sections, warnings: [] };
}
