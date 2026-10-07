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

// Package and TOC files may prefix every tag with a namespace (<opf:package>,
// <opf:itemref>, <ncx:navPoint>): valid XML, and what some publishers' tools
// write (Penguin's "The Love Hypothesis", for one). Selectors match local
// names, so drop the prefix from TAG names; attributes (opf:role,
// epub:type) are left alone.
const unprefixTags = (xml) => xml.replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, '<$1');

// DRM: META-INF/encryption.xml lists the encrypted files. Fonts are routinely
// obfuscated (IDPF/Adobe font mangling) and are harmless; an encrypted
// content document means the text itself is locked.
const FONT_OBFUSCATION = /idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/;

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

  const container = cheerio.load(unprefixTags(await read('META-INF/container.xml')), { xmlMode: true });
  const opfPath = container('rootfile').attr('full-path');
  if (!opfPath) throw Object.assign(new Error('This ePub has no package file'), { status: 400 });
  const opf = cheerio.load(unprefixTags(await read(opfPath)), { xmlMode: true });

  const meta = {
    title: cleanText(opf('metadata > title').first().text()) || null,
    author: cleanText(opf('metadata > creator').first().text()) || null,
    language: cleanText(opf('metadata > language').first().text()) || null,
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
    const nav = cheerio.load(unprefixTags(await read(navItem.href)), { xmlMode: true });
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
    const ncx = cheerio.load(unprefixTags(await read(ncxItem.href)), { xmlMode: true });
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

  // encrypted content documents = DRM; say so instead of "no readable text"
  const spine = opf('spine > itemref').toArray();
  const encryption = zip.file('META-INF/encryption.xml');
  if (encryption) {
    const enc = cheerio.load(unprefixTags(await encryption.async('string')), { xmlMode: true });
    const locked = new Set();
    enc('EncryptedData').each((_, el) => {
      const algorithm = enc(el).find('EncryptionMethod').attr('Algorithm') || '';
      const uri = enc(el).find('CipherReference').attr('URI');
      if (uri && !FONT_OBFUSCATION.test(algorithm)) locked.add(posix.normalize(decodeURIComponent(uri)));
    });
    const lockedPages = spine.filter(ref => locked.has(manifest[ref.attribs.idref]?.href)).length;
    if (lockedPages > 0) {
      throw Object.assign(new Error('This ePub is DRM-protected: its text is encrypted, so it cannot be imported. Export a DRM-free copy (or a Word/text version) and import that.'), { status: 400 });
    }
  }

  // the spine, in reading order
  const sections = [];
  let imageOnly = 0;
  for (const ref of spine) {
    const item = manifest[ref.attribs.idref];
    if (!item || !/html|xml/.test(item.type || '') || !zip.file(item.href)) continue;
    const html = await read(item.href);
    const $ = cheerio.load(html, { xmlMode: false });
    const bodyType = $('body').attr('epub:type') || $('section[epub\\:type]').first().attr('epub:type') || '';
    const heading = cleanText($('h1, h2, h3').first().text()) || landmarkTitles[item.href] || cleanText($('head > title').first().text());
    const text = htmlToText(html);
    if (!text) { // an image-only page (cover art) has no words to import
      if ($('img, image, svg').length) imageOnly++;
      continue;
    }
    sections.push({
      title: titles[item.href] || heading || null,
      content: text,
      hints: [bodyType, semantics[item.href] || '', posix.basename(item.href), ref.attribs.linear === 'no' ? 'nonlinear' : ''].filter(Boolean).join(' '),
      source: titles[item.href] ? 'toc' : heading ? 'heading' : 'whole',
    });
  }
  if (sections.length === 0) {
    throw Object.assign(new Error(spine.length === 0
      ? 'This ePub lists no pages to read (its package file has no reading order)'
      : imageOnly > 0
        ? 'This ePub\'s pages are images (a scanned or fixed-layout book), so there is no text to import'
        : 'No readable text found in this ePub'), { status: 400 });
  }
  return { meta, sections, warnings: [] };
}
