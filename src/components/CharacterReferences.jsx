import React, { useState } from 'react';
import { useMediaJobsContext, MediaJobList } from '../contexts/MediaJobsContext';
import { removePicture } from '../utils/pictures';
import { Image as ImageIcon, Loader, Trash2, UserCheck, Copy, Check, Wand2, FileText } from 'lucide-react';

// Character reference sheets: portrait, turnarounds, expressions, Qwen sheet.
// A reference is a book media job (type "reference", see useMediaJobs): the
// server makes it, the book-level hook folds the result into the character
// (character.referenceImages, newest first) and the normal book save keeps it.
// The prompt preview still uses POST /api/characters/reference-prompt.

export const REFERENCE_KINDS = [
  { id: 'portrait', label: 'Portrait', needsPortrait: false },
  { id: 'turnaround', label: 'Turnaround', needsPortrait: true },
  { id: 'turnaround-quad', label: 'Turnaround (4-view)', needsPortrait: true },
  { id: 'expressions', label: 'Expressions', needsPortrait: true },
  { id: 'qwen-sheet', label: 'Reference sheet', needsPortrait: false },
];

export const kindLabel = (kind) => REFERENCE_KINDS.find(k => k.id === kind)?.label || kind;

// POST JSON with the session token; throws the server's own message on failure.
export const postJson = async (url, body) => {
  const token = localStorage.getItem('token');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result?.error || `Request failed (${response.status})`;
    throw new Error(result?.detail ? `${message}: ${result.detail}` : message);
  }
  return result;
};

// The character as the server needs it: the reference history is client-side
// bookkeeping and only bloats the request.
// eslint-disable-next-line no-unused-vars
export const characterFields = ({ referenceImages, ...fields }) => fields;

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Plain-http LAN hosts have no async clipboard; fall back to execCommand.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  }
};

const CharacterReferences = ({ character, setData, onOpenImage, bookStyle = null }) => {
  const { jobsFor, startJob } = useMediaJobsContext();
  const [kind, setKind] = useState('turnaround');
  // empty: the book's art style (the server applies it); typed: this sheet only
  const [style, setStyle] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const [promptInfo, setPromptInfo] = useState(null);
  const [promptBusy, setPromptBusy] = useState(null); // kind being fetched
  const [copyState, setCopyState] = useState(null); // 'copied' | 'failed'

  // Reference jobs for this character come from the book-level jobs, so a
  // sheet started here is still shown after switching character and back.
  const referenceJobs = jobsFor('character', character.id).filter(j => j.type === 'reference');
  const running = referenceJobs.some(j => j.status === 'running') || starting;

  const references = character.referenceImages || [];
  const selectedKind = REFERENCE_KINDS.find(k => k.id === kind);
  const portraitFirst = selectedKind?.needsPortrait && !character.imageUrl;

  const updateCharacter = (change) => {
    setData(prev => ({
      ...prev,
      characters: prev.characters.map(c => (c.id === character.id ? change(c) : c)),
    }));
  };

  const generate = async () => {
    setError(null);
    setStarting(true);
    try {
      await startJob('reference', { type: 'character', id: character.id },
        { kind, character: characterFields(character), style },
        `${kindLabel(kind)}: ${character.name || 'character'}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const copyPrompt = async (promptKind) => {
    setPromptBusy(promptKind);
    setCopyState(null);
    try {
      const info = await postJson('/api/characters/reference-prompt', { kind: promptKind, character: characterFields(character), style: style || bookStyle?.prompt });
      setPromptInfo(info);
      setCopyState((await copyText(info.prompt)) ? 'copied' : 'failed');
    } catch (err) {
      setPromptInfo(null);
      setError(err.message);
    } finally {
      setPromptBusy(null);
    }
  };

  const setAsPortrait = (ref) => updateCharacter(c => ({ ...c, imageUrl: ref.imageUrl }));

  const deleteReference = (ref) => {
    if (!confirm(`Delete this ${kindLabel(ref.kind).toLowerCase()} reference?`)) return;
    // removePicture also moves the main picture off it when it was the main one
    setData(prev => removePicture(prev, 'character', character.id, ref.imageUrl));
  };

  return (
    <div className="pb-6 sm:pb-8 border-b border-gray-200" data-testid="character-references">
      <h3 className="font-bold text-gray-900 text-xl sm:text-2xl mb-4">References</h3>

      {/* Create reference */}
      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="lbl block mb-1">Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={running} className="w-full">
              {REFERENCE_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="lbl block mb-1">Style (optional, this image only)</span>
            <input
              type="text"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder={bookStyle ? `Book style: ${bookStyle.label}` : 'cinematic illustration'}
              disabled={running}
              className="w-full"
            />
          </label>
        </div>

        {portraitFirst && (
          <p className="text-sm text-[var(--warn)] mb-3">A base portrait will be generated first.</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={generate} disabled={running} className="btn pri sm" data-testid="reference-generate">
            {running ? <Loader size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {running ? 'Generating...' : 'Generate'}
          </button>
          <button onClick={() => copyPrompt(kind)} disabled={!!promptBusy} className="btn sm">
            <Copy size={14} />
            {promptBusy === kind ? 'Fetching prompt...' : 'Copy prompt'}
          </button>
          <button onClick={() => copyPrompt('qwen-sheet')} disabled={!!promptBusy} className="btn sm">
            <FileText size={14} />
            {promptBusy === 'qwen-sheet' ? 'Fetching prompt...' : 'Copy Qwen Image prompt'}
          </button>
        </div>

        <MediaJobList
          jobs={referenceJobs}
          className="mt-3"
          hint="Sheets take 30 s to 3 min; a first portrait plus a sheet can take longer. You can leave this page; it carries on."
        />

        {error && (
          <div className="mt-3 border border-[var(--red)] text-[var(--red)] text-sm px-3 py-2" role="alert">
            {error}
          </div>
        )}

        {promptInfo && (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="lbl">Prompt for {kindLabel(promptInfo.kind)}</span>
              {promptInfo.model && <span className="pill">{promptInfo.model}</span>}
              {promptInfo.size && <span className="pill">{promptInfo.size}</span>}
              {promptInfo.needsSourceImage && <span className="pill">needs the portrait as input</span>}
              {copyState === 'copied' && (
                <span className="text-xs text-[var(--ok)] flex items-center gap-1"><Check size={12} /> Copied</span>
              )}
              {copyState === 'failed' && (
                <span className="text-xs text-[var(--red)]">Copy failed, select the text below</span>
              )}
            </div>
            <textarea readOnly value={promptInfo.prompt || ''} rows={5} className="w-full text-sm mono" onFocus={(e) => e.target.select()} />
            {promptInfo.negative && (
              <>
                <span className="lbl block mt-2 mb-1">Negative prompt</span>
                <textarea readOnly value={promptInfo.negative} rows={2} className="w-full text-sm mono" onFocus={(e) => e.target.select()} />
              </>
            )}
          </div>
        )}
      </div>

      {/* Gallery, newest first */}
      {references.length === 0 ? (
        <p className="text-sm text-[var(--dim)]">No reference images yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {references.map(ref => {
            const isMain = ref.imageUrl === character.imageUrl;
            return (
              <div key={ref.id} className="card overflow-hidden flex flex-col">
                <button
                  onClick={() => onOpenImage?.({ imageUrl: ref.imageUrl, description: `${character.name}: ${kindLabel(ref.kind)}` })}
                  className="block bg-[var(--bg)]"
                  title="Open full size"
                >
                  <img src={ref.imageUrl} alt={`${character.name} ${kindLabel(ref.kind)}`} className="w-full h-36 object-contain" />
                </button>
                <div className="p-2 flex-1 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--ink)]">{kindLabel(ref.kind)}</span>
                    {isMain && <span className="pill">Main</span>}
                  </div>
                  {ref.createdAt && (
                    <span className="text-xs text-[var(--dim)] mono">{new Date(ref.createdAt).toLocaleDateString()}</span>
                  )}
                  <div className="flex gap-1 mt-auto">
                    <button onClick={() => setAsPortrait(ref)} disabled={isMain} className="btn sm flex-1" title="Use as main portrait">
                      <UserCheck size={14} />
                      <span>Use as main portrait</span>
                    </button>
                    <button onClick={() => deleteReference(ref)} className="btn ghost sm" title="Delete reference" aria-label="Delete reference">
                      <Trash2 size={14} className="text-[var(--red)]" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!references.length && !character.imageUrl && (
        <p className="text-xs text-[var(--dim2)] mt-2 flex items-center gap-1"><ImageIcon size={12} /> Start with a portrait or a turnaround.</p>
      )}
    </div>
  );
};

export default CharacterReferences;
