import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ArrowLeft, ArrowUp, ArrowDown, Merge, Scissors, Trash2, Pencil, BookOpen, Loader, AlertTriangle, X, Check, Sparkles } from 'lucide-react';
import { importsApi, KIND_LABEL, SOURCE_LABEL, formatBytes } from '../utils/importsApi';

// Step 2 of an import: review the detected sections before the book is made.
// Every action is ONE small op (PATCH /api/imports/:id/chapters); the server's
// reply replaces the list, so indexes are always the server's. The whole book
// is never sent.

const KINDS = ['front', 'chapter', 'back'];
const POLL_MS = 2000;
const fmtWords = (n) => `${Number(n || 0).toLocaleString()} word${n === 1 ? '' : 's'}`;

// Paragraph starts (character offsets) of a section's full text. A split point
// is the start of a paragraph after the first.
const paragraphsOf = (content) => {
  const text = String(content || '');
  const out = [];
  const re = /\S[\s\S]*?(?=\n\s*\n|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, text: m[0] });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
};

// Full text of one section, for reading and choosing where to split.
const SectionReader = ({ importId, section, nextNumber, busy, onSplit, onClose }) => {
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  const [at, setAt] = useState(null); // chosen paragraph index (split before it)
  const [title, setTitle] = useState('');

  useEffect(() => {
    let cancelled = false;
    importsApi.chapter(importId, section.index)
      .then(d => { if (!cancelled) setContent(d.chapter?.content ?? ''); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [importId, section.index]);

  const paragraphs = useMemo(() => paragraphsOf(content), [content]);

  const choose = (i) => {
    setAt(i);
    if (!title) setTitle(section.kind === 'chapter' ? `Chapter ${nextNumber}` : `${section.title} (part 2)`);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true" aria-labelledby="reader-title" data-testid="section-reader">
      <div className="card bg-[var(--bg2)] w-full max-w-3xl h-[88vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-[var(--line)]">
          <div className="min-w-0">
            <h3 id="reader-title" className="text-lg font-bold text-[var(--ink)] truncate">{section.title || 'Untitled section'}</h3>
            <p className="text-xs text-[var(--dim)] mono">{fmtWords(section.wordCount)} · {KIND_LABEL[section.kind] || section.kind}. To split, click the line between two paragraphs.</p>
          </div>
          <button type="button" onClick={onClose} className="iconb" title="Close" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <div className="border border-[var(--red)] text-[var(--red)] text-sm px-3 py-2" role="alert">{error}</div>}
          {content === null && !error && <p className="text-sm text-[var(--dim)] flex items-center gap-2"><Loader size={14} className="animate-spin" />Loading the text...</p>}
          {paragraphs.map((p, i) => (
            <React.Fragment key={p.start}>
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => choose(i)}
                  data-testid="split-point"
                  data-offset={p.start}
                  className={`group w-full flex items-center gap-2 py-1 text-xs ${at === i ? 'text-[var(--blue)]' : 'text-transparent hover:text-[var(--dim)]'}`}
                  title="Split here"
                >
                  <span className={`flex-1 border-t ${at === i ? 'border-[var(--blue)] border-dashed' : 'border-transparent group-hover:border-[var(--line2)]'}`} />
                  <Scissors size={12} />
                  <span>{at === i ? 'New section starts here' : 'Split here'}</span>
                  <span className={`flex-1 border-t ${at === i ? 'border-[var(--blue)] border-dashed' : 'border-transparent group-hover:border-[var(--line2)]'}`} />
                </button>
              )}
              <p className="text-sm text-[var(--ink)] leading-relaxed whitespace-pre-wrap" data-testid="reader-paragraph">{p.text}</p>
            </React.Fragment>
          ))}
        </div>

        {at !== null && (
          <div className="border-t border-[var(--line)] p-4 flex flex-wrap items-end gap-3" data-testid="split-form">
            <label className="flex-1 min-w-[200px]">
              <span className="lbl block mb-1">Title of the new section</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full" data-testid="split-title" />
            </label>
            <button type="button" onClick={() => setAt(null)} className="btn sm">Cancel</button>
            <button
              type="button"
              onClick={() => onSplit(paragraphs[at].start, title.trim() || 'Untitled')}
              disabled={busy}
              className="btn pri sm"
              data-testid="split-confirm"
            >
              {busy ? <Loader size={14} className="animate-spin" /> : <Scissors size={14} />}
              Split here
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const SectionRow = ({ section, number, prevSame, nextSame, next, busy, onOp, onRead }) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(section.title || '');
  useEffect(() => { if (!editing) setTitle(section.title || ''); }, [section.title, editing]);

  const saveTitle = () => {
    setEditing(false);
    const t = title.trim();
    if (t && t !== section.title) onOp({ op: 'rename', index: section.index, title: t });
  };

  const remove = () => {
    if (!confirm(`Delete "${section.title || 'this section'}"? Its ${fmtWords(section.wordCount)} of text are dropped from the import.`)) return;
    onOp({ op: 'delete', index: section.index });
  };

  return (
    <li className="card px-3 py-2" data-testid="import-section" data-index={section.index} data-kind={section.kind} data-title={section.title}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-xs text-[var(--dim2)] w-8 flex-shrink-0">{number}</span>
        {editing ? (
          <span className="flex items-center gap-1 flex-1 min-w-[160px]">
            <input
              type="text"
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setTitle(section.title || ''); setEditing(false); } }}
              className="flex-1 text-sm"
              data-testid="rename-input"
            />
            <Check size={14} className="text-[var(--dim)]" />
          </span>
        ) : (
          <button type="button" onClick={() => setEditing(true)} disabled={busy} className="flex-1 min-w-[160px] text-left text-sm font-semibold text-[var(--ink)] flex items-center gap-1 group" title="Rename" data-testid="section-title">
            <span className="truncate">{section.title || 'Untitled section'}</span>
            <Pencil size={12} className="text-[var(--dim2)] opacity-0 group-hover:opacity-100 flex-shrink-0" />
          </button>
        )}
        <span className="text-xs text-[var(--dim)] mono">{fmtWords(section.wordCount)}</span>
        {section.source && <span className="pill" title="How this section was found">{SOURCE_LABEL[section.source] || section.source}</span>}
        <select
          value={section.kind}
          onChange={(e) => onOp({ op: 'kind', index: section.index, kind: e.target.value })}
          disabled={busy}
          className="text-xs py-1"
          aria-label="Section kind"
          data-testid="section-kind"
        >
          {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>
      {section.preview && <p className="text-xs text-[var(--dim)] mt-1 line-clamp-2 pl-10">{section.preview}</p>}
      <div className="flex flex-wrap gap-1 mt-1 pl-9">
        <button type="button" onClick={onRead} className="btn ghost sm" data-testid="section-read"><BookOpen size={13} />Read / split</button>
        <button type="button" onClick={() => onOp({ op: 'move', from: section.index, to: prevSame })} disabled={busy || prevSame === null} className="btn ghost sm" title="Move up" aria-label="Move up" data-testid="section-up"><ArrowUp size={13} /></button>
        <button type="button" onClick={() => onOp({ op: 'move', from: section.index, to: nextSame })} disabled={busy || nextSame === null} className="btn ghost sm" title="Move down" aria-label="Move down" data-testid="section-down"><ArrowDown size={13} /></button>
        <button type="button" onClick={() => onOp({ op: 'merge', index: section.index })} disabled={busy || !next} className="btn ghost sm" title={next ? `Merge with "${next.title}"` : 'Nothing after this section'} data-testid="section-merge">
          <Merge size={13} />Merge with next
        </button>
        <button type="button" onClick={remove} disabled={busy} className="btn ghost sm" title="Delete section" aria-label="Delete section" data-testid="section-delete"><Trash2 size={13} className="text-[var(--red)]" /></button>
      </div>
    </li>
  );
};

// What a suggestion does, as the one op the buttons would send.
const suggestionOp = (s) => (s.type === 'kind' ? { op: 'kind', index: s.index, kind: s.value }
  : s.type === 'merge' ? { op: 'merge', index: s.index }
    : { op: 'rename', index: s.index, title: s.value });

const describe = (s, chapters) => {
  const at = chapters[s.index];
  const name = `"${at?.title || 'Untitled section'}"`;
  if (s.type === 'kind') return `Move ${name} to ${KIND_LABEL[s.value] || s.value}`;
  if (s.type === 'merge') return `Merge ${name} with "${chapters[s.index + 1]?.title || 'the next section'}"`;
  return `Rename ${name} to "${s.value}"`;
};

// The outline review: sai-chat-fast read the whole outline and suggests fixes.
// Nothing changes until the user applies a suggestion.
const SuggestionsPanel = ({ status, suggestions, chapters, busy, onApply, onApplyAll, onDismiss }) => {
  if (!status || status === 'skipped') return null;
  if (status === 'checking') {
    return (
      <p className="text-sm text-[var(--dim)] flex items-center gap-2" role="status" data-testid="suggestions-checking">
        <Loader size={14} className="animate-spin" />SAI is checking the structure. You can keep editing.
      </p>
    );
  }
  if (status === 'failed') {
    return <p className="text-xs text-[var(--dim)]" data-testid="suggestions-failed">The SAI structure check did not finish. The sections below are as the file was read.</p>;
  }
  if (!suggestions.length) {
    return <p className="text-sm text-[var(--dim)] flex items-center gap-2" data-testid="suggestions-none"><Sparkles size={14} />SAI checked the structure: nothing to change.</p>;
  }
  return (
    <section className="card p-4" data-testid="suggestions">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <h2 className="text-base font-bold text-[var(--ink)] flex items-center gap-2"><Sparkles size={16} className="text-[var(--blue)]" />SAI suggestions</h2>
        <span className="text-xs text-[var(--dim)]">{suggestions.length} to check. Nothing changes until you apply one.</span>
        <button type="button" onClick={onApplyAll} disabled={busy} className="btn sm ml-auto" data-testid="suggestions-apply-all">
          <Check size={14} />Apply all
        </button>
      </div>
      <ul className="space-y-2">
        {suggestions.map(s => (
          <li key={s.id} className="flex flex-wrap items-start gap-2 border-t border-[var(--line)] pt-2" data-testid="suggestion" data-type={s.type}>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm text-[var(--ink)]">{describe(s, chapters)}</p>
              {s.reason && <p className="text-xs text-[var(--dim)]">{s.reason}</p>}
            </div>
            <button type="button" onClick={() => onApply(s)} disabled={busy} className="btn pri sm" data-testid="suggestion-apply"><Check size={13} />Apply</button>
            <button type="button" onClick={() => onDismiss(s)} disabled={busy} className="btn ghost sm" data-testid="suggestion-dismiss"><X size={13} />Dismiss</button>
          </li>
        ))}
      </ul>
    </section>
  );
};

const ImportReview = ({ importId, onBack, onOpenBook }) => {
  const [imp, setImp] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(null); // section index
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [includeFront, setIncludeFront] = useState(false);
  const [includeBack, setIncludeBack] = useState(false);
  const [analyze, setAnalyze] = useState(true);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false); // a double click must not make two books

  const adopt = (record) => {
    setImp(record);
    setTitle(record?.title || '');
    setAuthor(record?.author || '');
  };

  useEffect(() => {
    importsApi.get(importId).then(d => adopt(d.import)).catch(err => setError(err.message));
  }, [importId]);

  // still being read (or created): poll
  useEffect(() => {
    if (!imp || (imp.status !== 'parsing' && imp.status !== 'creating')) return undefined;
    const t = setTimeout(() => importsApi.get(importId).then(d => adopt(d.import)).catch(() => setImp(p => ({ ...p }))), POLL_MS);
    return () => clearTimeout(t);
  }, [imp, importId]);

  // the structure check answers after the review opens: poll for it, merging
  // only the suggestions so the title being typed is never overwritten
  useEffect(() => {
    if (!imp || imp.status !== 'review' || imp.suggestionsStatus !== 'checking') return undefined;
    const t = setTimeout(() => importsApi.get(importId)
      .then(d => setImp(prev => ({ ...prev, suggestions: d.import?.suggestions || [], suggestionsStatus: d.import?.suggestionsStatus })))
      .catch(() => setImp(p => ({ ...p }))), POLL_MS);
    return () => clearTimeout(t);
  }, [imp, importId]);

  const dismissSuggestion = async (s) => {
    try {
      const d = await importsApi.update(importId, { dismissSuggestions: [s.id] });
      setImp(prev => ({ ...prev, suggestions: d.import?.suggestions || [] }));
    } catch (err) {
      setError(err.message);
    }
  };

  // one at a time: every applied op moves indexes, and the server's reply
  // carries the remaining suggestions at their new indexes
  const applyAll = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let current = imp;
      for (let n = 0; n < 100 && current?.suggestions?.length; n++) {
        const d = await importsApi.ops(importId, [suggestionOp(current.suggestions[0])]);
        current = { ...current, ...d.import };
        setImp(current);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runOp = async (op) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const d = await importsApi.ops(importId, [op]);
      setImp(prev => ({ ...prev, ...d.import }));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveMeta = async (field, value) => {
    const v = value.trim();
    if (!imp || v === (imp[field] || '')) return;
    try {
      const d = await importsApi.update(importId, { [field]: v });
      setImp(prev => ({ ...prev, ...d.import, chapters: d.import?.chapters || prev.chapters }));
    } catch (err) {
      setError(err.message);
    }
  };

  const create = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError(null);
    try {
      const d = await importsApi.create(importId, { includeFront, includeBack, analyze });
      if (!d?.bookId) throw new Error('The server did not return the new book');
      onOpenBook(d.bookId);
    } catch (err) {
      setError(err.status === 403 || err.status === 429 ? `${err.message}. Delete a book or upgrade, then try again.` : err.message);
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const chapters = imp?.chapters || [];
  const byKind = useMemo(() => Object.fromEntries(KINDS.map(k => [k, chapters.filter(c => c.kind === k)])), [chapters]);
  const storyWords = byKind.chapter.reduce((n, c) => n + (c.wordCount || 0), 0);
  const included = [...(includeFront ? byKind.front : []), ...byKind.chapter, ...(includeBack ? byKind.back : [])].length;
  const readingSection = reading !== null ? chapters.find(c => c.index === reading) : null;

  const neighbours = (section) => {
    const same = byKind[section.kind] || [];
    const at = same.findIndex(c => c.index === section.index);
    return {
      prevSame: at > 0 ? same[at - 1].index : null,
      nextSame: at >= 0 && at < same.length - 1 ? same[at + 1].index : null,
      next: chapters.find(c => c.index === section.index + 1) || null,
    };
  };

  if (!imp) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6">
        {error ? (
          <div className="card p-6 max-w-md text-center">
            <p className="text-[var(--red)] mb-4">{error}</p>
            <button type="button" onClick={onBack} className="btn">Back to library</button>
          </div>
        ) : <p className="text-sm text-[var(--dim)] flex items-center gap-2"><Loader size={14} className="animate-spin" />Loading the import...</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]" data-testid="import-review">
      <header className="sticky top-0 z-30 bg-[var(--bg2)] border-b border-[var(--line)] px-4 sm:px-6 py-3 flex items-center gap-3">
        <button type="button" onClick={onBack} className="btn ghost sm" title="Back to library (the review is kept)"><ArrowLeft size={16} />Library</button>
        <div className="flex-1 min-w-0">
          <p className="lbl">Review import</p>
          <p className="text-sm text-[var(--ink)] truncate mono">{imp.fileName}{imp.fileSize ? ` · ${formatBytes(imp.fileSize)}` : ''}{imp.format ? ` · ${imp.format.toUpperCase()}` : ''}</p>
        </div>
        <span className="text-xs text-[var(--dim)] hidden sm:inline">{included} section{included === 1 ? '' : 's'} go into the book</span>
        <button
          type="button"
          onClick={create}
          onDoubleClick={(e) => e.preventDefault()}
          disabled={creating || busy || imp.status !== 'review' || included === 0}
          className="btn pri sm"
          data-testid="create-book"
        >
          {creating ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
          {creating ? 'Creating...' : 'Create book'}
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && <div className="border border-[var(--red)] text-[var(--red)] text-sm px-3 py-2" role="alert" data-testid="review-error">{error}</div>}

        {imp.status === 'parsing' && (
          <p className="text-sm text-[var(--dim)] flex items-center gap-2" role="status"><Loader size={14} className="animate-spin" />{imp.progress?.message || 'Reading the file...'}</p>
        )}
        {imp.status === 'created' && imp.bookId && (
          <div className="card p-4 flex items-center gap-3">
            <p className="flex-1 text-sm text-[var(--ink)]">This import already made a book.</p>
            <button type="button" onClick={() => onOpenBook(imp.bookId)} className="btn pri sm"><BookOpen size={14} />Open the book</button>
          </div>
        )}

        <section className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="lbl block mb-1">Title</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => saveMeta('title', title)} className="w-full" data-testid="import-title-input" />
          </label>
          <label className="block">
            <span className="lbl block mb-1">Author</span>
            <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} onBlur={() => saveMeta('author', author)} className="w-full" data-testid="import-author-input" />
          </label>
        </section>

        {imp.warnings?.length > 0 && (
          <section className="border-2 border-[var(--warn)] px-4 py-3" role="alert" data-testid="import-warnings">
            <p className="font-semibold text-[var(--ink)] flex items-center gap-2 mb-1"><AlertTriangle size={16} className="text-[var(--warn)]" />Check these before creating the book</p>
            <ul className="list-disc pl-6 text-sm text-[var(--ink)] space-y-0.5">
              {imp.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </section>
        )}

        {imp.status === 'review' && (
          <SuggestionsPanel
            status={imp.suggestionsStatus}
            suggestions={imp.suggestions || []}
            chapters={chapters}
            busy={busy || creating}
            onApply={(s) => runOp(suggestionOp(s))}
            onApplyAll={applyAll}
            onDismiss={dismissSuggestion}
          />
        )}

        <section className="card p-4 flex flex-wrap gap-x-6 gap-y-2 text-sm" data-testid="import-options">
          <label className="flex items-center gap-2"><input type="checkbox" checked={includeFront} onChange={(e) => setIncludeFront(e.target.checked)} data-testid="opt-front" />Include front matter ({byKind.front.length})</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={includeBack} onChange={(e) => setIncludeBack(e.target.checked)} data-testid="opt-back" />Include back matter ({byKind.back.length})</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={analyze} onChange={(e) => setAnalyze(e.target.checked)} data-testid="opt-analyze" />Analyze characters, places and plot after import</label>
        </section>

        {KINDS.map(kind => {
          const list = byKind[kind];
          if (!list.length) return null;
          const left = (kind === 'front' && !includeFront) || (kind === 'back' && !includeBack);
          return (
            <section key={kind} data-testid={`group-${kind}`}>
              <div className="flex items-baseline gap-3 mb-2 rule2">
                <h2 className="text-base font-bold text-[var(--ink)]">{KIND_LABEL[kind]}</h2>
                <span className="text-xs text-[var(--dim)] mono">{list.length} section{list.length === 1 ? '' : 's'}{kind === 'chapter' ? ` · ${fmtWords(storyWords)}` : ''}</span>
                {left && <span className="text-xs text-[var(--dim)]">left out of the book unless included above</span>}
              </div>
              <ol className={`space-y-2 ${left ? 'opacity-70' : ''}`}>
                {list.map((section, i) => (
                  <SectionRow
                    key={`${section.index}-${section.title}`}
                    section={section}
                    number={kind === 'chapter' ? i + 1 : '·'}
                    {...neighbours(section)}
                    busy={busy || creating}
                    onOp={runOp}
                    onRead={() => setReading(section.index)}
                  />
                ))}
              </ol>
            </section>
          );
        })}
        {chapters.length === 0 && imp.status === 'review' && <p className="text-sm text-[var(--dim)]">No sections were found in this file.</p>}
      </main>

      {readingSection && (
        <SectionReader
          importId={importId}
          section={readingSection}
          nextNumber={(byKind.chapter.findIndex(c => c.index === readingSection.index) + 2) || byKind.chapter.length + 1}
          busy={busy}
          onClose={() => setReading(null)}
          onSplit={async (at, newTitle) => {
            if (await runOp({ op: 'split', index: readingSection.index, at, title: newTitle })) setReading(null);
          }}
        />
      )}
    </div>
  );
};

export default ImportReview;
