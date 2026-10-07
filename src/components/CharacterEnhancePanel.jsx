import React, { useState } from 'react';
import { BookOpen, Check, X } from 'lucide-react';
import { FIELD_LABELS, LONG_FIELDS, openItems } from '../utils/characterEnhance';

// The suggestions an "Enhance from book" job found for one character. Nothing
// changes until the author uses one; each value can be edited before use.

const chaptersText = (chapters) => (chapters?.length ? `${chapters.length === 1 ? 'Chapter' : 'Chapters'} ${chapters.join(', ')}` : '');

const readText = (read) => {
  if (!read) return '';
  const base = `Read ${read.mentions} mention${read.mentions === 1 ? '' : 's'} across ${read.chapters} chapter${read.chapters === 1 ? '' : 's'}`;
  return read.sampled ? `${base} (a sample spread through the book)` : base;
};

const FieldSuggestion = ({ suggestion, current, onUse, onSkip }) => {
  const [value, setValue] = useState(suggestion.value);
  const long = LONG_FIELDS.has(suggestion.field);
  return (
    <li className="border-t border-gray-200 pt-3" data-testid="enhance-suggestion" data-field={suggestion.field}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="font-semibold text-gray-900">{FIELD_LABELS[suggestion.field]}</span>
        <span className="text-xs text-gray-500">{chaptersText(suggestion.chapters)}</span>
      </div>
      {current ? (
        <p className="text-sm text-gray-500 mb-2"><span className="font-medium">Now:</span> {current}</p>
      ) : (
        <p className="text-sm text-gray-500 mb-2">Now empty</p>
      )}
      {long ? (
        <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(8, Math.max(3, Math.ceil(value.length / 90)))}
          className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none" data-testid="enhance-value" />
      ) : (
        <input value={value} onChange={(e) => setValue(e.target.value)}
          className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none" data-testid="enhance-value" />
      )}
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={() => onUse(value)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center gap-1" data-testid="enhance-use">
          <Check size={14} />{current ? 'Replace' : 'Use'}
        </button>
        <button type="button" onClick={onSkip} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm flex items-center gap-1" data-testid="enhance-skip">
          <X size={14} />Skip
        </button>
      </div>
    </li>
  );
};

const CharacterEnhancePanel = ({ character, onResolve, onClose }) => {
  const enh = character.enhancement;
  if (!enh || enh.closed) return null;
  const count = openItems(enh);
  return (
    <section className="mb-6 sm:mb-8 p-4 border border-blue-200 bg-blue-50/40 rounded-lg" data-testid="enhance-panel">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2"><BookOpen size={18} className="text-blue-600" />From the book</h3>
        {count > 0 && (
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => onResolve('all', true)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center gap-1" data-testid="enhance-use-all">
              <Check size={14} />Use all
            </button>
            <button type="button" onClick={() => onResolve('all', false)} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm" data-testid="enhance-skip-all">
              Skip all
            </button>
          </div>
        )}
      </div>
      <p className="text-sm text-gray-600 mb-3">
        {readText(enh.read)}. {count > 0 ? `${count} suggestion${count === 1 ? '' : 's'}; nothing changes until you use one.` : 'Nothing new to add: the profile already has what the book says.'}
      </p>
      {count === 0 && (
        <button type="button" onClick={onClose} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm" data-testid="enhance-close">Close</button>
      )}
      <ul className="space-y-3">
        {(enh.suggestions || []).map(s => (
          <FieldSuggestion key={`${enh.jobId}:${s.field}`} suggestion={s} current={character[s.field]}
            onUse={(value) => onResolve([{ kind: 'field', field: s.field, value }], true)}
            onSkip={() => onResolve([{ kind: 'field', field: s.field }], false)} />
        ))}
        {(enh.relationships || []).map(rel => (
          <li key={`rel:${rel.characterId}`} className="border-t border-gray-200 pt-3" data-testid="enhance-relationship">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-semibold text-gray-900">Relationship: {rel.name}</span>
              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">{rel.type}</span>
            </div>
            {rel.description && <p className="text-sm text-gray-700 mb-2">{rel.description}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => onResolve([{ kind: 'relationship', characterId: rel.characterId }], true)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center gap-1" data-testid="enhance-use">
                <Check size={14} />Add
              </button>
              <button type="button" onClick={() => onResolve([{ kind: 'relationship', characterId: rel.characterId }], false)} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm flex items-center gap-1" data-testid="enhance-skip">
                <X size={14} />Skip
              </button>
            </div>
          </li>
        ))}
        {(enh.aliases || []).length > 0 && (
          <li className="border-t border-gray-200 pt-3" data-testid="enhance-aliases">
            <span className="font-semibold text-gray-900 block mb-2">Also known as</span>
            <div className="flex flex-wrap gap-2">
              {enh.aliases.map(a => (
                <span key={a} className="inline-flex items-center gap-1 pl-3 pr-1 py-1 bg-white border border-gray-300 rounded-full text-sm">
                  {a}
                  <button type="button" onClick={() => onResolve([{ kind: 'alias', value: a }], true)} className="p-1 text-blue-600 hover:bg-blue-50 rounded-full" title={`Add "${a}"`} data-testid="enhance-alias-use"><Check size={13} /></button>
                  <button type="button" onClick={() => onResolve([{ kind: 'alias', value: a }], false)} className="p-1 text-gray-500 hover:bg-gray-100 rounded-full" title="Skip"><X size={13} /></button>
                </span>
              ))}
            </div>
          </li>
        )}
      </ul>
    </section>
  );
};

export default CharacterEnhancePanel;
