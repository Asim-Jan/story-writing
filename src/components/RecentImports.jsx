import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader, Trash2, BookOpen, ArrowRight, AlertCircle } from 'lucide-react';
import { importsApi, STATUS_LABEL, formatBytes } from '../utils/importsApi';

// The user's recent imports (kept 14 days): resume a review, open the book an
// import made, or discard the rest.
const RecentImports = ({ onClose, onReview, onWatch, onOpenBook }) => {
  const [imports, setImports] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await importsApi.list();
      setImports(Array.isArray(d?.imports) ? d.imports : []);
    } catch (err) {
      setError(err.message);
      setImports([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const discard = async (imp) => {
    if (!confirm(`Discard the import of "${imp.title || imp.fileName}"? Your review edits are lost.`)) return;
    setBusy(imp.id);
    try {
      await importsApi.discard(imp.id);
      setImports(prev => prev.filter(i => i.id !== imp.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" role="dialog" aria-modal="true" aria-labelledby="recent-imports-title" data-testid="recent-imports">
      <div className="card bg-[var(--bg2)] w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-[var(--line)]">
          <div>
            <h3 id="recent-imports-title" className="text-lg font-bold text-[var(--ink)]">Recent imports</h3>
            <p className="text-sm text-[var(--dim)]">Imports wait here for 14 days, so you can finish a review later.</p>
          </div>
          <button type="button" onClick={onClose} className="iconb" title="Close" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto p-5">
          {error && <div className="border border-[var(--red)] text-[var(--red)] text-sm px-3 py-2 mb-3" role="alert">{error}</div>}
          {imports === null ? (
            <p className="text-sm text-[var(--dim)] flex items-center gap-2"><Loader size={14} className="animate-spin" />Loading...</p>
          ) : imports.length === 0 ? (
            <p className="text-sm text-[var(--dim)]">No imports yet.</p>
          ) : (
            <ul className="space-y-2">
              {imports.map(imp => (
                <li key={imp.id} className="card px-3 py-2 flex items-center gap-3" data-testid="recent-import" data-status={imp.status}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--ink)] truncate">{imp.title || imp.fileName}</p>
                    <p className="text-xs text-[var(--dim)] mono truncate">
                      {imp.fileName}{imp.fileSize ? ` · ${formatBytes(imp.fileSize)}` : ''}{imp.updatedAt ? ` · ${new Date(imp.updatedAt).toLocaleString()}` : ''}
                    </p>
                    {imp.status === 'failed' && imp.error && (
                      <p className="text-xs text-[var(--red)] flex items-center gap-1 mt-0.5"><AlertCircle size={12} />{imp.error}</p>
                    )}
                  </div>
                  <span className="pill flex-shrink-0">{STATUS_LABEL[imp.status] || imp.status}</span>
                  {imp.status === 'review' && (
                    <button type="button" onClick={() => onReview(imp.id)} className="btn pri sm" data-testid="resume-import">Resume review<ArrowRight size={14} /></button>
                  )}
                  {(imp.status === 'parsing' || imp.status === 'creating') && (
                    <button type="button" onClick={() => onWatch(imp)} className="btn sm">Show progress</button>
                  )}
                  {imp.status === 'created' && imp.bookId && (
                    <button type="button" onClick={() => onOpenBook(imp.bookId)} className="btn sm" data-testid="open-imported-book"><BookOpen size={14} />Open book</button>
                  )}
                  {imp.status !== 'created' && (
                    <button type="button" onClick={() => discard(imp)} disabled={busy === imp.id} className="btn ghost sm" title="Discard import" aria-label="Discard import" data-testid="discard-import">
                      <Trash2 size={14} className="text-[var(--red)]" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default RecentImports;
