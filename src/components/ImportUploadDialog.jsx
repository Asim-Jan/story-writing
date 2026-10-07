import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, Loader, AlertCircle, FileText, BookOpen, RotateCcw } from 'lucide-react';
import { importsApi, fileFormat, IMPORT_ACCEPT, IMPORT_MAX_BYTES, formatBytes } from '../utils/importsApi';
import { useElapsed, formatElapsed } from '../contexts/MediaJobsContext';

// Step 1 of an import: pick a file, upload it, and wait while the server reads
// it (polling every 2 s). Hands over to the review screen when the import is
// ready. `resumeId` re-attaches to an import that is still being read.

const POLL_MS = 2000;

const ImportUploadDialog = ({ onClose, onReview, onOpenBook, resumeId = null }) => {
  const [file, setFile] = useState(null);
  const [imp, setImp] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [dupAccepted, setDupAccepted] = useState(false);
  const inputRef = useRef(null);
  const elapsed = useElapsed(imp?.status === 'parsing' ? imp.createdAt : null);

  // Re-attach to an import still being read.
  useEffect(() => {
    if (!resumeId) return;
    importsApi.get(resumeId).then(d => setImp(d.import)).catch(err => setError(err.message));
  }, [resumeId]);

  // Poll while the server reads the file.
  useEffect(() => {
    if (!imp || (imp.status !== 'parsing' && imp.status !== 'creating')) return undefined;
    const timer = setTimeout(async () => {
      try {
        const d = await importsApi.get(imp.id);
        setImp(d.import);
      } catch (err) {
        if (err.status === 404) { setImp(null); setError('This import no longer exists. Upload the file again.'); }
        else setImp(prev => ({ ...prev })); // try again on the next tick
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [imp]);

  // Ready: go to the review, unless the duplicate warning still waits for an answer.
  useEffect(() => {
    if (!imp) return;
    if (imp.duplicateOf && !dupAccepted) return;
    if (imp.status === 'review') onReview(imp.id);
    if (imp.status === 'created' && imp.bookId) onOpenBook(imp.bookId);
  }, [imp, dupAccepted]);

  const choose = (picked) => {
    setError(null);
    if (!picked) return;
    if (!fileFormat(picked.name)) { setError('Choose an ePub, Word (.docx), PDF, text or Markdown file.'); return; }
    if (picked.size > IMPORT_MAX_BYTES) { setError(`That file is ${formatBytes(picked.size)}; the limit is 50 MB.`); return; }
    setFile(picked);
  };

  const upload = async (target = file) => {
    if (!target || uploading) return;
    setUploading(true);
    setError(null);
    setDupAccepted(false);
    try {
      const d = await importsApi.upload(target);
      setImp(d.import);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const retry = async () => {
    const failed = imp;
    setImp(null);
    if (failed?.id) importsApi.discard(failed.id).catch(() => {});
    upload(file);
  };

  const openExisting = async () => {
    const dup = imp.duplicateOf;
    importsApi.discard(imp.id).catch(() => {});
    onOpenBook(dup.bookId);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (imp || uploading) return;
    choose(e.dataTransfer.files?.[0]);
  };

  const parsing = imp && (imp.status === 'parsing' || imp.status === 'creating');
  const showDuplicate = imp?.duplicateOf && !dupAccepted;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true" aria-labelledby="import-title" data-testid="import-dialog">
      <div className="card bg-[var(--bg2)] w-full max-w-lg p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 id="import-title" className="text-lg font-bold text-[var(--ink)]">Import a book</h3>
            <p className="text-sm text-[var(--dim)]">ePub, Word, PDF, text or Markdown, up to 50 MB. You review the chapters before the book is made.</p>
          </div>
          <button type="button" onClick={onClose} className="iconb" title="Close" aria-label="Close"><X size={18} /></button>
        </div>

        {!imp && (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
              data-testid="import-dropzone"
              className={`border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors ${dragOver ? 'border-[var(--blue)] bg-[var(--glass2)]' : 'border-[var(--line2)] hover:border-[var(--dim)]'}`}
            >
              <Upload size={22} className="mx-auto mb-2 text-[var(--dim)]" />
              <p className="text-sm text-[var(--ink)] font-semibold">Drop the file here, or click to choose</p>
              <p className="text-xs text-[var(--dim)] mt-1">.epub .docx .pdf .txt .md</p>
              <input ref={inputRef} type="file" accept={IMPORT_ACCEPT} className="hidden" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} data-testid="import-file" />
            </div>
            {file && (
              <div className="flex items-center gap-2 mt-3 text-sm" data-testid="import-chosen">
                <FileText size={16} className="text-[var(--dim)]" />
                <span className="flex-1 truncate text-[var(--ink)]">{file.name}</span>
                <span className="pill">{formatBytes(file.size)}</span>
              </div>
            )}
          </>
        )}

        {parsing && (
          <div className="border border-[var(--line)] px-4 py-3 text-sm" role="status" data-testid="import-parsing">
            <p className="flex items-center gap-2 text-[var(--ink)] font-semibold">
              <Loader size={14} className="animate-spin" />
              Reading {imp.fileName || 'the file'}
              <span className="mono text-xs text-[var(--dim)] font-normal">{formatElapsed(elapsed)}</span>
            </p>
            <p className="text-[var(--dim)] mt-1" data-testid="import-progress">{imp.progress?.message || 'Starting...'}</p>
            <p className="text-xs text-[var(--dim2)] mt-2">You can close this; the import waits for you under Recent imports.</p>
          </div>
        )}

        {showDuplicate && (
          <div className="border border-[var(--warn)] px-4 py-3 mt-3 text-sm" data-testid="import-duplicate">
            <p className="text-[var(--ink)]">You imported this file before as <strong>{imp.duplicateOf.title || 'a book'}</strong>.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" onClick={openExisting} className="btn sm" data-testid="dup-open"><BookOpen size={14} />Open that book</button>
              <button type="button" onClick={() => setDupAccepted(true)} className="btn sm" data-testid="dup-continue">Import again anyway</button>
            </div>
          </div>
        )}

        {imp?.status === 'failed' && (
          <div className="border border-[var(--red)] px-4 py-3 text-sm" role="alert" data-testid="import-failed">
            <p className="text-[var(--red)] flex items-center gap-2"><AlertCircle size={14} />{imp.error || 'The file could not be read.'}</p>
            <div className="flex gap-2 mt-3">
              {file && <button type="button" onClick={retry} className="btn sm" data-testid="import-retry"><RotateCcw size={14} />Try again</button>}
              <button type="button" onClick={() => { importsApi.discard(imp.id).catch(() => {}); setImp(null); setFile(null); }} className="btn sm">Choose another file</button>
            </div>
          </div>
        )}

        {error && <div className="border border-[var(--red)] text-[var(--red)] text-sm px-3 py-2 mt-3" role="alert">{error}</div>}

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="btn sm">{parsing ? 'Close' : 'Cancel'}</button>
          {!imp && (
            <button type="button" onClick={() => upload()} disabled={!file || uploading} className="btn pri sm" data-testid="import-upload">
              {uploading ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? 'Uploading...' : 'Upload and read'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImportUploadDialog;
