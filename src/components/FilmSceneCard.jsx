import React, { useRef, useState } from 'react';
import { Edit3, Loader, CheckCircle2, AlertCircle, Image as ImageIcon, Video, X, RefreshCw, ArrowUp, ArrowDown, Stethoscope, Wand2, Upload, Scissors } from 'lucide-react';
import { FILM_TRANSITIONS, sceneTransition } from '../utils/filmCast';
import { chosenStill, chosenTake } from '../utils/filmTakes';

// One scene on the Animation Studio's workbench: its storyboard still (the
// opening frame, drawn in seconds) and its takes (rendered clips, minutes
// each). The chosen still is what a new take is animated from; the chosen
// take is what the film is cut from.

const STAGE = {
  keyframe: 'Drawing the still...',
  rendering: 'Rendering the clip...',
  pending: 'Waiting its turn...',
};

const Thumb = ({ url, chosen, onChoose, onRemove, label, testid }) => (
  <div className={`relative group flex-shrink-0 rounded border-2 ${chosen ? 'border-purple-500' : 'border-transparent hover:border-purple-300'}`}>
    <button type="button" onClick={onChoose} title={chosen ? `${label} (in use)` : `Use ${label}`} data-testid={testid} data-chosen={chosen ? 'true' : 'false'}
      className="block">
      <img src={url} alt={label} className="w-14 h-8 object-cover rounded-sm bg-gray-100" loading="lazy" />
    </button>
    {onRemove && (
      <button type="button" onClick={onRemove} title={`Delete ${label}`} aria-label={`Delete ${label}`}
        className="absolute -top-2 -right-2 hidden group-hover:flex w-4 h-4 items-center justify-center rounded-full bg-white border border-gray-300 text-gray-600 hover:text-red-600">
        <X className="w-3 h-3" />
      </button>
    )}
  </div>
);

const FilmSceneCard = ({
  scene, index, scenes, editing, onToggleEdit, onUpdate,
  progress, stillBusy, takeBusy,
  onDrawStill, onRenderTake, onChooseStill, onRemoveStill, onChooseTake, onRemoveTake,
  onMove, canMoveUp, canMoveDown,
  onAdvise, adviceBusy, onUseAdvice, onDismissAdvice,
  onEditStill, onUploadStill, uploadBusy,
  onTrim,
}) => {
  const videoRef = useRef(null);
  const [editText, setEditText] = useState(null); // null: closed
  const at = () => Math.round((videoRef.current?.currentTime || 0) * 100) / 100;
  const still = chosenStill(scene);
  const take = chosenTake(scene);
  const stills = scene.stills || [];
  const takes = scene.takes || [];
  const transition = sceneTransition(scenes, index);
  const continues = transition === 'continue';
  const stage = progress?.status && STAGE[progress.status];

  return (
    <div className="border-2 border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors" data-testid="film-scene-card" data-scene={scene.sceneNumber}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded">Scene {scene.sceneNumber}</span>
        <h4 className="font-semibold text-gray-900">{scene.title}</h4>
        <span className="text-xs text-gray-500">{scene.duration}s{scene.cameraDirection ? <> &middot; {scene.cameraDirection}</> : null}</span>
        {index > 0 && (
          <select
            value={transition}
            onChange={(e) => onUpdate({ transition: e.target.value })}
            title={FILM_TRANSITIONS.find(t => t.id === transition)?.hint}
            aria-label={`How scene ${scene.sceneNumber} begins`}
            data-testid="scene-transition"
            className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white"
          >
            {FILM_TRANSITIONS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
        {take && (
          <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded">
            <CheckCircle2 className="w-3 h-3" />{takes.length} take{takes.length === 1 ? '' : 's'}
          </span>
        )}
        {progress?.status === 'failed' && (
          <span className="flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded" title={progress.error}>
            <AlertCircle className="w-3 h-3" />Failed
          </span>
        )}
        {stage && (
          <span className="flex items-center gap-1 text-xs text-[var(--blue)]" data-testid="scene-stage">
            <Loader className="w-3 h-3 animate-spin" />{stage}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => onMove(-1)} disabled={!canMoveUp} title="Move this scene earlier" aria-label={`Move scene ${scene.sceneNumber} up`}
            data-testid="scene-up" className="p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-30 rounded"><ArrowUp className="w-4 h-4" /></button>
          <button type="button" onClick={() => onMove(1)} disabled={!canMoveDown} title="Move this scene later" aria-label={`Move scene ${scene.sceneNumber} down`}
            data-testid="scene-down" className="p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-30 rounded"><ArrowDown className="w-4 h-4" /></button>
          <button type="button" onClick={onToggleEdit} title="Edit what the scene shows" aria-label={`Edit scene ${scene.sceneNumber}`}
            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors">
            <Edit3 className="w-4 h-4" />
          </button>
        </span>
      </div>

      {editing ? (
        <textarea
          value={scene.visualPrompt}
          onChange={(e) => onUpdate({ visualPrompt: e.target.value })}
          className="w-full mt-2 px-3 py-2 border border-gray-300 rounded text-sm"
          rows="4"
          data-testid="scene-prompt"
        />
      ) : (
        <p className="text-gray-700 text-sm mt-2">{scene.visualPrompt}</p>
      )}
      {scene.dialogue && <p className="text-purple-700 text-sm italic mt-1">Dialogue: "{scene.dialogue}"</p>}
      <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-600">
        {scene.characters?.length > 0 && <span>Cast: {scene.characters.join(', ')}</span>}
        {scene.location && <span>Place: {scene.location}</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
        {/* the storyboard still */}
        <div data-testid="scene-stills">
          <p className="text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1"><ImageIcon className="w-3 h-3" />Still (opening frame)</p>
          {still ? (
            <a href={still} target="_blank" rel="noreferrer" title="Open the still full size">
              <img src={still} alt={`Scene ${scene.sceneNumber} still`} data-testid="scene-still" className="w-full max-w-xs aspect-video object-cover rounded border border-gray-200 bg-gray-100" />
            </a>
          ) : (
            <div className="w-full max-w-xs aspect-video rounded border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-xs text-gray-500 text-center px-3">
              No still yet. Draw one to check the picture before rendering.
            </div>
          )}
          {stills.length > 1 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {stills.map((s, i) => (
                <Thumb key={s.url} url={s.url} chosen={s.url === still} label={`still ${i + 1}`} testid="still-choice"
                  onChoose={() => onChooseStill(s.url)} onRemove={() => onRemoveStill(s.url)} />
              ))}
            </div>
          )}
          {continues && (
            <p className="text-xs text-gray-500 mt-1">This scene continues the previous shot: its clip starts from that clip's last frame, so the still is a preview.</p>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" onClick={onDrawStill} disabled={stillBusy} data-testid="draw-still"
              className="px-2 py-1 bg-white border border-purple-300 text-purple-700 hover:bg-purple-50 disabled:opacity-50 text-xs rounded flex items-center gap-1">
              {stillBusy ? <Loader className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {still ? 'Draw another still' : 'Draw still'}
            </button>
            {still && (
              <button type="button" onClick={onAdvise} disabled={adviceBusy} data-testid="advise-still"
                title="SAI looks at the still and says what is wrong with it, with a better description"
                className="px-2 py-1 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 text-xs rounded flex items-center gap-1">
                {adviceBusy ? <Loader className="w-3 h-3 animate-spin" /> : <Stethoscope className="w-3 h-3" />}Notes
              </button>
            )}
            {still && (
              <button type="button" onClick={() => setEditText(editText === null ? '' : null)} disabled={stillBusy} data-testid="edit-still-open"
                title="Change something in the still: 'make it night', 'she holds a lantern'"
                className="px-2 py-1 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 text-xs rounded flex items-center gap-1">
                <Wand2 className="w-3 h-3" />Edit
              </button>
            )}
            <label className={`px-2 py-1 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs rounded flex items-center gap-1 cursor-pointer ${uploadBusy ? 'opacity-50' : ''}`}
              title="Use your own picture as this scene's opening frame">
              {uploadBusy ? <Loader className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}Upload
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploadBusy} data-testid="upload-still"
                onChange={(e) => { onUploadStill(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
          {editText !== null && (
            <div className="flex gap-2 mt-2">
              <input type="text" value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={300} autoFocus
                placeholder="What to change, e.g. make it night with rain" data-testid="edit-still-text"
                onKeyDown={(e) => { if (e.key === 'Enter' && editText.trim()) { onEditStill(editText.trim()); setEditText(null); } }}
                className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs" />
              <button type="button" disabled={!editText.trim()} onClick={() => { onEditStill(editText.trim()); setEditText(null); }} data-testid="edit-still-apply"
                className="px-2 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs rounded">Apply</button>
            </div>
          )}
        </div>

        {/* the takes */}
        <div data-testid="scene-takes">
          <p className="text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1"><Video className="w-3 h-3" />Clip</p>
          {take ? (
            <video key={take.id} ref={videoRef} src={take.videoUrl} poster={take.keyframeUrl || undefined} controls preload="metadata" data-testid="scene-take-video"
              className="w-full max-w-xs aspect-video rounded border border-gray-200 bg-black" />
          ) : (
            <div className="w-full max-w-xs aspect-video rounded border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-xs text-gray-500 text-center px-3">
              No clip yet{still ? '. Render one from the still.' : '.'}
            </div>
          )}
          {takes.length > 1 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {takes.map((t, i) => (
                <div key={t.id} className="relative group">
                  <button type="button" onClick={() => onChooseTake(t.id)} data-testid="take-choice" data-chosen={t.id === take?.id ? 'true' : 'false'}
                    className={`px-2 py-1 text-xs rounded border ${t.id === take?.id ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400'}`}>
                    Take {i + 1}{t.duration ? ` (${Math.round(t.duration)}s)` : ''}
                  </button>
                  <button type="button" onClick={() => onRemoveTake(t.id)} title={`Delete take ${i + 1}`} aria-label={`Delete take ${i + 1}`}
                    className="absolute -top-2 -right-2 hidden group-hover:flex w-4 h-4 items-center justify-center rounded-full bg-white border border-gray-300 text-gray-600 hover:text-red-600">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {take && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700 mt-2" data-testid="take-trim">
              <Scissors className="w-3 h-3" />
              <span data-testid="take-trim-span">
                {take.trimIn || take.trimOut
                  ? `Uses ${take.trimIn ? take.trimIn.toFixed(1) : '0.0'} to ${take.trimOut ? `${take.trimOut.toFixed(1)} s` : 'the end'}`
                  : 'Uses the whole take'}
              </span>
              <button type="button" onClick={() => onTrim(take.id, { trimIn: at() })} data-testid="trim-in" title="The film starts this take where the player is now"
                className="px-1.5 py-0.5 border border-gray-300 rounded hover:bg-gray-50">Start here</button>
              <button type="button" onClick={() => onTrim(take.id, { trimOut: at() })} data-testid="trim-out" title="The film leaves this take where the player is now"
                className="px-1.5 py-0.5 border border-gray-300 rounded hover:bg-gray-50">End here</button>
              {(take.trimIn || take.trimOut) && (
                <button type="button" onClick={() => onTrim(take.id, { trimIn: null, trimOut: null })} className="text-gray-500 hover:text-red-600">Clear</button>
              )}
            </div>
          )}
          {take && (
            <label className="flex items-center gap-2 text-xs text-gray-700 mt-2" title="This clip's own sound in the film (0% mutes it)">
              <span>Clip sound</span>
              <input type="range" min="0" max="150" step="5" value={Math.round((Number.isFinite(scene.clipVolume) ? scene.clipVolume : 1) * 100)}
                onChange={(e) => onUpdate({ clipVolume: Number(e.target.value) / 100 })} data-testid="clip-volume" className="flex-1 max-w-[9rem]" />
              <span className="mono w-10 text-right">{Math.round((Number.isFinite(scene.clipVolume) ? scene.clipVolume : 1) * 100)}%</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" onClick={onRenderTake} disabled={takeBusy} data-testid="render-take"
              title={still ? 'Animate the chosen still into a clip (a few minutes)' : 'Draws a still first, then animates it (a few minutes)'}
              className="px-2 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs rounded flex items-center gap-1">
              {takeBusy ? <Loader className="w-3 h-3 animate-spin" /> : <Video className="w-3 h-3" />}
              {take ? 'Render another take' : 'Render clip'}
            </button>
            {take && takes.length === 1 && (
              <button type="button" onClick={() => onRemoveTake(take.id)} className="px-2 py-1 text-xs text-gray-600 hover:text-red-600">Delete take</button>
            )}
          </div>
        </div>
      </div>

      {scene.advice && (
        <div className={`mt-3 p-3 rounded border text-sm ${scene.advice.verdict === 'good' ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`} data-testid="scene-advice">
          <p className="font-semibold text-gray-900 text-xs mb-1">
            {scene.advice.verdict === 'good' ? 'Notes: the still works' : 'Notes: the still needs fixing'}
            {scene.advice.still && scene.advice.still !== still && <span className="font-normal text-gray-500"> (about an earlier still)</span>}
          </p>
          {scene.advice.notes?.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-gray-800 space-y-0.5">{scene.advice.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
          {scene.advice.prompt && scene.advice.prompt !== scene.visualPrompt && (
            <>
              <p className="text-xs font-semibold text-gray-700 mt-2">Suggested description</p>
              <p className="text-xs text-gray-800" data-testid="advice-prompt">{scene.advice.prompt}</p>
            </>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            {scene.advice.prompt && scene.advice.prompt !== scene.visualPrompt && (
              <>
                <button type="button" onClick={() => onUseAdvice(true)} data-testid="advice-use-redraw"
                  className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded">Use it and redraw the still</button>
                <button type="button" onClick={() => onUseAdvice(false)} data-testid="advice-use"
                  className="px-2 py-1 bg-white border border-purple-300 text-purple-700 hover:bg-purple-50 text-xs rounded">Use the description</button>
              </>
            )}
            <button type="button" onClick={onDismissAdvice} className="px-2 py-1 text-xs text-gray-600 hover:underline">Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilmSceneCard;
