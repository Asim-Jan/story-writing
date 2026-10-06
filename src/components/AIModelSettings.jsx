import React, { useEffect, useState } from 'react';
import { Cpu, RefreshCw, Save, Zap } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

// The chat "backbone": which gateway model each role uses. Saved changes
// apply to every request within ~15 s, with no redeploy.
const AIModelSettings = () => {
  const [roles, setRoles] = useState(null);
  const [available, setAvailable] = useState([]);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [tests, setTests] = useState({});

  const headers = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
  });

  const load = async () => {
    setMessage(null);
    const res = await fetch(`${API_URL}/api/admin/ai-models`, { headers: headers(), credentials: 'include' });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      setMessage({ error: true, text: body?.error || `Could not load model settings (${res.status})` });
      return;
    }
    setRoles(body.roles);
    setAvailable(body.available || []);
    setDraft(Object.fromEntries(Object.entries(body.roles).map(([k, r]) => [k, r.model])));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/ai-models`, {
        method: 'PUT', headers: headers(), credentials: 'include', body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Save failed (${res.status})`);
      setMessage({ text: 'Saved. New requests use these models within 15 seconds.' });
      await load();
    } catch (err) {
      setMessage({ error: true, text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const test = async (model) => {
    setTests(t => ({ ...t, [model]: { running: true } }));
    const res = await fetch(`${API_URL}/api/admin/ai-models/test`, {
      method: 'POST', headers: headers(), credentials: 'include', body: JSON.stringify({ model }),
    });
    const body = await res.json().catch(() => ({}));
    setTests(t => ({ ...t, [model]: body }));
  };

  if (!roles) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <p className="text-sm text-gray-600">{message?.text || 'Loading model settings...'}</p>
      </div>
    );
  }

  const changed = Object.keys(roles).some(k => draft[k] !== roles[k].model);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <Cpu className="w-5 h-5" /> AI models
        </h3>
        <button onClick={load} className="p-2 text-gray-600 rounded-lg" title="Reload">
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        Which SAI gateway model each kind of request uses. Applies to every user, no redeploy.
      </p>

      <div className="space-y-4">
        {Object.entries(roles).map(([key, role]) => {
          const t = tests[draft[key]];
          return (
            <div key={key} className="border border-gray-200 rounded-lg p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-semibold text-gray-800">{role.label}</div>
                  <div className="text-sm text-gray-600">{role.description}</div>
                </div>
                <select
                  value={draft[key] || ''}
                  onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  {[...new Set([draft[key], ...available])].filter(Boolean).map(m => (
                    <option key={m} value={m}>{m}{m === role.default ? ' (default)' : ''}</option>
                  ))}
                </select>
                <button
                  onClick={() => test(draft[key])}
                  disabled={t?.running}
                  className="btn sm flex items-center gap-1"
                  title="Send one short request through this model"
                >
                  <Zap size={14} /> {t?.running ? 'Testing...' : 'Test'}
                </button>
              </div>
              {t && !t.running && (
                <p className={`text-sm mt-2 ${t.ok ? 'text-gray-600' : 'text-[var(--red)]'}`}>
                  {t.ok ? `Answered in ${(t.ms / 1000).toFixed(1)} s: "${t.reply}"` : `Failed after ${((t.ms || 0) / 1000).toFixed(1)} s: ${t.error}`}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button onClick={save} disabled={!changed || saving} className="btn pri sm flex items-center gap-1">
          <Save size={14} /> {saving ? 'Saving...' : 'Save'}
        </button>
        {message && (
          <span className={`text-sm ${message.error ? 'text-[var(--red)]' : 'text-gray-600'}`}>{message.text}</span>
        )}
      </div>
    </div>
  );
};

export default AIModelSettings;
