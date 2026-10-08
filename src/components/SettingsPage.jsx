import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, User, ShieldCheck, Gauge, SlidersHorizontal, Cloud, Check, AlertCircle, Loader, Mail, LogOut, Lock, ExternalLink, Play, Square, Trash2, Sun, Moon, MonitorSmartphone, Cpu } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { fetchPortalConfig } from '../utils/portalAuth';
import { normalizeVoiceSpec, voiceKey, specFromKey, vibeVoiceLabel, languageOf } from '../utils/voices';
import { PLAN_NAMES, PLAN_PRICES, FEATURE_LABELS, toolLabel, meterOf, initialsOf } from '../utils/settings';

// Settings: one page, four sections. Every value shown here comes from the server as it is now (quotas from the tier
// table, the plan list from /api/plans, SAI Cloud from /api/auth/portal/config): nothing is advertised that is not enforced.
const SAI_CLOUD_URL = 'https://solutionsai.co.uk/';

export const SECTIONS = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'security', label: 'Sign-in & security', icon: ShieldCheck },
  { id: 'plan', label: 'Plan & usage', icon: Gauge },
  { id: 'models', label: 'AI models', icon: Cpu },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
];

const authHeaders = (json = false) => {
  const token = localStorage.getItem('token');
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) };
};
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, credentials: 'include', headers: authHeaders(body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || `Request failed (${res.status})`), { status: res.status, code: data.code });
  return data;
}

const formatDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

/* ── small pieces ─────────────────────────────────────────────────────────────────────────────── */
const Panel = ({ title, aside, children, testid }) => (
  <section className="card" data-testid={testid}>
    {title && (
      <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--line)]">
        <h3 className="text-[0.95rem] font-semibold text-[var(--ink)]">{title}</h3>
        {aside}
      </header>
    )}
    <div className="px-5 py-4">{children}</div>
  </section>
);

const Row = ({ label, children, hint }) => (
  <div className="grid grid-cols-1 sm:grid-cols-[11rem_1fr] gap-1 sm:gap-4 py-3 border-b border-[var(--line)] last:border-b-0">
    <div className="lbl pt-1">{label}</div>
    <div className="min-w-0">
      {children}
      {hint && <p className="text-xs text-[var(--dim)] mt-1.5">{hint}</p>}
    </div>
  </div>
);

const Notice = ({ tone = 'ok', children, onClose }) => {
  const color = tone === 'error' ? 'var(--red)' : tone === 'warn' ? 'var(--warn)' : tone === 'info' ? 'var(--blue)' : 'var(--ok)';
  const Icon = tone === 'error' || tone === 'warn' ? AlertCircle : Check;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="flex items-start gap-2.5 px-4 py-3 rounded-[3px] text-sm border" style={{ borderColor: color }}>
      <Icon size={16} style={{ color }} className="flex-shrink-0 mt-0.5" />
      <div className="flex-1 text-[var(--ink)]">{children}</div>
      {onClose && <button type="button" onClick={onClose} className="text-xs text-[var(--dim)] hover:text-[var(--ink)]">Dismiss</button>}
    </div>
  );
};

const StatusPill = ({ tone, children }) => (
  <span className="pill" style={{ color: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'red' ? 'var(--red)' : 'var(--dim)' }}>{children}</span>
);

const Meter = ({ label, used, limit, unit, hint, testid }) => {
  const m = meterOf(used, limit);
  const color = m.pct >= 100 ? 'var(--red)' : m.pct >= 80 ? 'var(--warn)' : 'var(--blue)';
  return (
    <div className="py-3 border-b border-[var(--line)] last:border-b-0" data-testid={testid}>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-sm text-[var(--ink)]">{label}</span>
        <span className="mono num text-xs text-[var(--dim)]">
          {Number(used || 0).toLocaleString()}{m.unlimited ? '' : ` / ${Number(limit).toLocaleString()}`}{unit ? ` ${unit}` : ''}{m.unlimited ? ' · unlimited' : ''}
        </span>
      </div>
      {!m.unlimited && (
        <div className="h-1.5 bg-[var(--glass2)] border border-[var(--line)] rounded-[2px] overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.pct} aria-label={label}>
          <div className="h-full" style={{ width: `${m.pct}%`, background: color, transition: 'width var(--t)' }} />
        </div>
      )}
      {hint && <p className="text-xs text-[var(--dim)] mt-1">{hint}</p>}
    </div>
  );
};

/** A button that asks once more in place (no browser dialog). */
const ConfirmButton = ({ children, confirmLabel, onConfirm, className = 'btn sm', danger, testid, disabled, style }) => {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className={className} style={style} onClick={() => setAsking(true)} disabled={disabled} data-testid={testid}>{children}</button>;
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <button type="button" className="btn sm" style={danger ? { borderColor: 'var(--red)', color: 'var(--red)' } : undefined}
        onClick={() => { setAsking(false); onConfirm(); }} data-testid={testid ? `${testid}-confirm` : undefined}>{confirmLabel}</button>
      <button type="button" className="btn ghost sm" onClick={() => setAsking(false)}>Keep</button>
    </span>
  );
};

/* ── the page ─────────────────────────────────────────────────────────────────────────────────── */
const SettingsPage = ({ onBack, backLabel = 'Back to books', section: initialSection = 'account', arrival = null }) => {
  const { user: authUser, token, login, logout } = useAuth();
  const [section, setSection] = useState(SECTIONS.some((s) => s.id === initialSection) ? initialSection : 'account');
  const [me, setMe] = useState(authUser || null);
  const [portal, setPortal] = useState({ enabled: false, only: false });
  const [quotas, setQuotas] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState(null);
  const [notice, setNotice] = useState(() => {
    if (arrival?.connected) return { tone: 'ok', text: 'SAI Cloud is connected. From now on you can sign in to Stories with your SAI Cloud account.' };
    if (arrival?.checkout === 'success') return { tone: 'ok', text: 'Thank you. Your payment went through; your new plan shows here as soon as the payment provider confirms it.' };
    if (arrival?.checkout === 'canceled') return { tone: 'info', text: 'Checkout was cancelled. Nothing was charged.' };
    return null;
  });

  const refreshMe = useCallback(async () => {
    try {
      const { user } = await api('/api/auth/me');
      setMe(user);
      return user;
    } catch { return null; }
  }, []);
  const refreshPlan = useCallback(async () => {
    const [q, s, p] = await Promise.all([
      api('/api/users/quotas').catch(() => null),
      api('/api/subscriptions/my').catch(() => null),
      api('/api/plans').catch(() => null),
    ]);
    setQuotas(q); setSubscription(s); setPlans(p);
  }, []);

  useEffect(() => {
    refreshMe().then((u) => {
      // after a SAI Cloud connect the session is a new one: keep the app's copy of the user in step
      if (u && authUser && (u.portalLinked !== authUser.portalLinked || u.name !== authUser.name)) login({ ...authUser, ...u }, localStorage.getItem('token') || token);
    });
    fetchPortalConfig().then(setPortal);
    refreshPlan();
  }, []);

  // after a checkout the webhook may land a moment later: look again a few times
  useEffect(() => {
    if (arrival?.checkout !== 'success') return undefined;
    let n = 0;
    const id = setInterval(() => { n += 1; refreshPlan(); refreshMe(); if (n >= 5) clearInterval(id); }, 4000);
    return () => clearInterval(id);
  }, [arrival, refreshPlan, refreshMe]);

  const say = (tone, text) => setNotice({ tone, text });
  const tier = (quotas?.tier || me?.tier || 'free').toLowerCase();

  return (
    <div className="min-h-screen bg-[var(--bg)]" data-testid="settings-page">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <header className="mb-6">
          <button type="button" onClick={onBack} className="btn ghost sm -ml-3 mb-3" data-testid="settings-back">
            <ArrowLeft size={16} /> {backLabel}
          </button>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[var(--ink)] leading-tight">Settings</h1>
              <p className="text-sm text-[var(--dim)] mt-1 break-all">{me?.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="pill" data-testid="settings-plan-pill">{PLAN_NAMES[tier] || tier} plan</span>
              {me?.portalLinked && <span className="pill" style={{ color: 'var(--blue)' }}><Cloud size={12} /> SAI Cloud</span>}
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[13rem_1fr] gap-6">
          <nav aria-label="Settings sections" className="tabs overflow-x-auto lg:flex-col lg:border-b-0 lg:border-r lg:pr-0 -mx-4 px-4 lg:mx-0 lg:px-0 lg:self-start lg:sticky lg:top-6">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => { setSection(id); setNotice(null); }}
                className={`${section === id ? 'on' : ''} whitespace-nowrap flex items-center gap-2 lg:w-full lg:text-left lg:!shadow-none lg:border-r-2 ${section === id ? 'lg:border-[var(--blue)]' : 'lg:border-transparent'}`}
                aria-current={section === id ? 'page' : undefined} data-testid={`settings-nav-${id}`}>
                <Icon size={16} aria-hidden="true" /> {label}
              </button>
            ))}
          </nav>

          <main className="min-w-0 space-y-5">
            {notice && <Notice tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Notice>}
            {section === 'account' && <AccountSection me={me} tier={tier} onSaved={(u) => { setMe((m) => ({ ...m, ...u })); if (authUser) login({ ...authUser, ...u }, localStorage.getItem('token') || token); }} say={say} />}
            {section === 'security' && <SecuritySection me={me} portal={portal} say={say} logout={logout}
              onNewToken={(t) => { if (authUser) login(authUser, t); else localStorage.setItem('token', t); }} />}
            {section === 'plan' && <PlanSection tier={tier} quotas={quotas} subscription={subscription} plans={plans} refresh={refreshPlan} say={say} />}
            {section === 'models' && <ModelsSection say={say} onSeePlans={() => setSection('plan')} />}
            {section === 'preferences' && <PreferencesSection say={say} />}
          </main>
        </div>
      </div>
    </div>
  );
};

/* ── Account ──────────────────────────────────────────────────────────────────────────────────── */
function AccountSection({ me, tier, onSaved, say }) {
  const [name, setName] = useState(me?.name || '');
  const [saving, setSaving] = useState(false);
  const [resent, setResent] = useState(false);
  useEffect(() => { setName(me?.name || ''); }, [me?.name]);
  const changed = name.trim() !== (me?.name || '').trim();

  const saveName = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { user } = await api('/api/users/profile', { method: 'PUT', body: { name } });
      onSaved(user);
      say('ok', 'Your name is saved.');
    } catch (err) { say('error', err.message); } finally { setSaving(false); }
  };
  const resend = async () => {
    try { await api('/api/auth/resend-verification', { method: 'POST' }); setResent(true); } catch (err) { say('error', err.message); }
  };

  return (
    <>
      <Panel testid="settings-account">
        <div className="flex items-center gap-4 pb-4 mb-1 border-b border-[var(--line)]">
          <div className="w-14 h-14 flex-shrink-0 flex items-center justify-center border border-[var(--line2)] rounded-[3px] bg-[var(--glass2)] mono text-lg text-[var(--ink)]" aria-hidden="true">
            {initialsOf(me?.name, me?.email)}
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold text-[var(--ink)] truncate">{me?.name || 'Your account'}</p>
            <p className="text-sm text-[var(--dim)] truncate">{PLAN_NAMES[tier] || tier} plan{me?.role === 'admin' ? ' · administrator' : ''}</p>
          </div>
        </div>
        <Row label="Name" hint="Shown on your books and exports.">
          <form onSubmit={saveName} className="flex flex-wrap gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="flex-1 min-w-[12rem]" aria-label="Name" data-testid="settings-name" />
            <button type="submit" className="btn sm pri" disabled={!changed || !name.trim() || saving} data-testid="settings-name-save">{saving ? 'Saving...' : 'Save'}</button>
          </form>
        </Row>
        <Row label="Email" hint={me?.portalLinked ? 'Your Stories sign-in address. Your SAI Cloud address can differ.' : 'Your sign-in address.'}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--ink)] break-all">{me?.email}</span>
            {me?.emailVerified
              ? <StatusPill tone="ok"><Check size={12} /> Verified</StatusPill>
              : <StatusPill tone="warn">Not verified</StatusPill>}
            {!me?.emailVerified && (resent
              ? <span className="text-xs text-[var(--dim)]">Sent. Check your inbox.</span>
              : <button type="button" className="btn sm" onClick={resend} data-testid="settings-resend"><Mail size={14} /> Send the link again</button>)}
          </div>
        </Row>
        <Row label="Member since">
          <span className="text-sm text-[var(--ink)]">{formatDate(me?.createdAt) || 'Unknown'}</span>
        </Row>
      </Panel>
    </>
  );
}

/* ── Sign-in & security ───────────────────────────────────────────────────────────────────────── */
function SecuritySection({ me, portal, say, logout, onNewToken }) {
  const linked = !!me?.portalLinked;
  const [alsoPortal, setAlsoPortal] = useState(false);
  return (
    <>
      <SaiCloudPanel me={me} portal={portal} say={say} />
      {/* with password sign-in turned off (PORTAL_ONLY) a password is only the admins' break-glass */}
      {!linked && (!portal.only || me?.role === 'admin') && <PasswordPanel say={say} onNewToken={onNewToken} />}
      <Panel title="Sessions" testid="settings-sessions">
        <Row label="Other devices" hint="Signs out every other browser and device. You stay signed in here.">
          <ConfirmButton testid="settings-signout-others" confirmLabel="Sign out other devices" onConfirm={async () => {
            try { const { token } = await api('/api/auth/sign-out-others', { method: 'POST' }); onNewToken(token); say('ok', 'Every other device has been signed out.'); }
            catch (err) { say('error', err.message); }
          }}>Sign out other devices</ConfirmButton>
        </Row>
        <Row label="This device">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn sm" onClick={() => logout({ everywhere: linked && alsoPortal })} data-testid="settings-signout">
              <LogOut size={14} /> Sign out
            </button>
            {linked && (
              <label className="flex items-center gap-2 text-sm text-[var(--dim)] cursor-pointer">
                <input type="checkbox" checked={alsoPortal} onChange={(e) => setAlsoPortal(e.target.checked)} className="!p-0" />
                Also sign out of SAI Cloud
              </label>
            )}
          </div>
        </Row>
      </Panel>
    </>
  );
}

function SaiCloudPanel({ me, portal, say }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const linked = !!me?.portalLinked;

  const connect = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { url } = await api('/api/auth/portal/attach', { method: 'POST', body: { password, returnTo: '/?settings=security' } });
      window.location.assign(url);
    } catch (err) {
      setError(err.code === 'already_connected' ? 'This account is already connected to SAI Cloud.' : err.message);
      setBusy(false);
    } finally { setPassword(''); }
  };

  let status;
  if (linked) status = <StatusPill tone="ok"><Check size={12} /> Connected</StatusPill>;
  else if (portal.enabled) status = <StatusPill>Not connected</StatusPill>;
  else status = <StatusPill>Coming soon</StatusPill>;

  return (
    <Panel title={<span className="flex items-center gap-2"><Cloud size={16} className="text-[var(--blue)]" /> SAI Cloud</span>} aside={status} testid="settings-sai-cloud">
      {linked ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--ink)]">
            You sign in to Stories with your SAI Cloud account, the same account you use for the rest of Solutions AI.
            {formatDate(me?.portalLinkedAt) ? <> Connected on {formatDate(me.portalLinkedAt)}.</> : null}
          </p>
          <p className="text-sm text-[var(--dim)]">Your SAI Cloud password and account details are managed in SAI Cloud. Your books, plan and settings stay here in Stories.</p>
          <a href={SAI_CLOUD_URL} target="_blank" rel="noopener noreferrer" className="btn sm" data-testid="settings-open-sai-cloud">
            Open SAI Cloud <ExternalLink size={14} />
          </a>
        </div>
      ) : portal.enabled ? (
        <div className="space-y-3">
          {portal.only ? (
            <Notice tone="warn">Stories now signs in with SAI Cloud only. Connect your account now, or you will not be able to sign in again once this session ends.</Notice>
          ) : (
            <p className="text-sm text-[var(--ink)]">Sign in to Stories with your SAI Cloud account, the one account for every Solutions AI app.</p>
          )}
          <ul className="text-sm text-[var(--dim)] space-y-1 list-none">
            <li className="flex gap-2"><Check size={14} className="mt-1 text-[var(--ok)] flex-shrink-0" /> Your books, plan and settings stay exactly as they are.</li>
            <li className="flex gap-2"><Check size={14} className="mt-1 text-[var(--ok)] flex-shrink-0" /> Your SAI Cloud email does not have to match this one.</li>
            {!portal.only && <li className="flex gap-2"><Check size={14} className="mt-1 text-[var(--ok)] flex-shrink-0" /> Your Stories password keeps working.</li>}
          </ul>
          {!open ? (
            <button type="button" className="btn sm pri" onClick={() => setOpen(true)} data-testid="settings-connect">
              <Cloud size={14} /> Connect SAI Cloud
            </button>
          ) : (
            <form onSubmit={connect} className="border border-[var(--line)] rounded-[3px] p-4 space-y-3" data-testid="settings-connect-form">
              <label htmlFor="connect-password" className="lbl block"><Lock size={12} className="inline mr-1 align-[-1px]" />Confirm your Stories password</label>
              <input id="connect-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full" data-testid="settings-connect-password" />
              <p className="text-xs text-[var(--dim)]">Next, SAI Cloud asks you to sign in. Choose the account to connect. When you come back, other devices signed in to Stories are signed out.</p>
              {error && <p role="alert" className="text-sm text-[var(--red)]">{error}</p>}
              <div className="flex gap-2">
                <button type="submit" className="btn sm pri" disabled={!password || busy} data-testid="settings-connect-go">{busy ? <><Loader size={14} className="animate-spin" /> Opening SAI Cloud...</> : 'Continue to SAI Cloud'}</button>
                <button type="button" className="btn ghost sm" onClick={() => { setOpen(false); setError(''); setPassword(''); }}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <p className="text-sm text-[var(--dim)]">
          Soon you will be able to sign in to Stories with your SAI Cloud account, the one account for every Solutions AI app. Your books and plan will stay as they are.
        </p>
      )}
    </Panel>
  );
}

function PasswordPanel({ say, onNewToken }) {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (f.next.length < 8) return setError('The new password needs at least 8 characters.');
    if (f.next !== f.confirm) return setError('The two new passwords do not match.');
    setBusy(true);
    try {
      const data = await api('/api/auth/change-password', { method: 'POST', body: { currentPassword: f.current, newPassword: f.next } });
      if (data.token) onNewToken(data.token);
      setF({ current: '', next: '', confirm: '' });
      say('ok', 'Your password is changed. Other devices have been signed out.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Panel title="Password" testid="settings-password">
      <form onSubmit={submit} className="grid gap-3 max-w-md">
        <label className="grid gap-1.5"><span className="lbl">Current password</span>
          <input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required data-testid="settings-pw-current" /></label>
        <label className="grid gap-1.5"><span className="lbl">New password</span>
          <input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required minLength={8} data-testid="settings-pw-new" /></label>
        <label className="grid gap-1.5"><span className="lbl">New password, again</span>
          <input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required data-testid="settings-pw-confirm" /></label>
        {error && <p role="alert" className="text-sm text-[var(--red)]">{error}</p>}
        <div><button type="submit" className="btn sm pri" disabled={busy} data-testid="settings-pw-save">{busy ? 'Changing...' : 'Change password'}</button></div>
      </form>
    </Panel>
  );
}

/* ── Plan & usage ─────────────────────────────────────────────────────────────────────────────── */
function PlanSection({ tier, quotas, subscription, plans, refresh, say }) {
  const [activity, setActivity] = useState(null);
  const [busyTier, setBusyTier] = useState(null);
  useEffect(() => {
    Promise.all([api('/api/users/ai-costs?days=30').catch(() => null), api('/api/users/ai-costs/by-tool?days=30').catch(() => null)])
      .then(([c, t]) => setActivity({ month: c?.monthToDate || null, tools: (t?.toolBreakdown || []).filter((x) => x.usageCount > 0).sort((a, b) => b.usageCount - a.usageCount).slice(0, 8) }));
  }, []);

  const sub = subscription?.has_subscription ? subscription.subscription : null;
  const order = ['free', 'basic', 'premium'];
  const checkout = async (t) => {
    setBusyTier(t);
    try { const { url } = await api('/api/subscriptions/checkout', { method: 'POST', body: { tier: t } }); window.location.assign(url); }
    catch (err) { say('error', err.message === 'Failed to create checkout session' ? 'Payments are not available right now. Please try again later.' : err.message); setBusyTier(null); }
  };
  const cancel = async () => {
    try { await api('/api/subscriptions/cancel', { method: 'POST' }); say('ok', 'Your subscription is cancelled. You keep your plan until the end of this billing period.'); refresh(); }
    catch (err) { say('error', err.message); }
  };

  const u = quotas?.usage;
  const l = quotas?.limits;
  return (
    <>
      <Panel title="Your plan" aside={sub ? <StatusPill tone={sub.status === 'active' ? 'ok' : 'warn'}>{sub.status}</StatusPill> : null} testid="settings-plan">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
          <span className="text-2xl font-bold text-[var(--ink)]" data-testid="settings-plan-name">{PLAN_NAMES[tier] || tier}</span>
          {PLAN_PRICES[tier] && <span className="text-sm text-[var(--dim)]">{PLAN_PRICES[tier]} a month</span>}
        </div>
        {sub ? (
          <div className="space-y-2 text-sm">
            {sub.current_period_end && (
              <p className="text-[var(--dim)]">
                {sub.cancel_at_period_end ? 'Ends on ' : 'Renews on '}<span className="text-[var(--ink)]">{formatDate(sub.current_period_end)}</span>
                {sub.cancel_at_period_end ? '. You keep everything until then.' : '.'}
              </p>
            )}
            {sub.status === 'active' && !sub.cancel_at_period_end && (
              <ConfirmButton className="btn ghost sm !px-0" style={{ color: 'var(--red)' }} danger confirmLabel="Cancel at the end of this period" onConfirm={cancel} testid="settings-cancel-sub">Cancel subscription</ConfirmButton>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--dim)]">AI writing, pictures, voices and films run on Solutions AI's own models. They are included in your plan; there are no API keys to set up.</p>
        )}
      </Panel>

      <Panel title="Usage" aside={<span className="lbl">AI requests reset daily</span>} testid="settings-usage">
        {!quotas ? <div className="hatch h-24 rounded-[3px]" aria-label="Loading usage" /> : (
          <>
            <Meter label="Books" used={u.current_books} limit={l.max_books} testid="meter-books" />
            <Meter label="Words" used={u.current_words} limit={l.max_words} testid="meter-words" />
            <Meter label="Chapters" used={u.current_chapters} limit={l.max_chapters} testid="meter-chapters" />
            <Meter label="AI requests today" used={u.ai_requests_today} limit={l.max_ai_requests_per_day} testid="meter-ai" />
            <Row label="At once">
              <span className="text-sm text-[var(--ink)]">{quotas.limitsDisplay?.concurrentJobs ?? l.max_concurrent_jobs} media {Number(l.max_concurrent_jobs) === 1 ? 'job' : 'jobs'} at a time</span>
            </Row>
          </>
        )}
      </Panel>

      {plans?.plans && (
        <Panel title="Plans" testid="settings-plans">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {plans.plans.map((p) => {
              const current = p.tier === tier;
              const higher = order.indexOf(p.tier) > order.indexOf(tier);
              const features = Object.entries(p.features || {}).filter(([, on]) => on).map(([k]) => FEATURE_LABELS[k]).filter(Boolean);
              return (
                <div key={p.tier} className="border rounded-[3px] p-4 flex flex-col" style={{ borderColor: current ? 'var(--blue)' : 'var(--line)' }} data-testid={`plan-${p.tier}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-[var(--ink)]">{PLAN_NAMES[p.tier]}</span>
                    {current && <span className="pill" style={{ color: 'var(--blue)' }}>Current</span>}
                  </div>
                  <p className="text-sm text-[var(--dim)] mb-3">{PLAN_PRICES[p.tier] ? `${PLAN_PRICES[p.tier]} a month` : 'No charge'}</p>
                  <ul className="text-sm space-y-1 mb-3 mono num text-[var(--ink)]">
                    <li>{p.limits.books} books</li>
                    <li>{p.limits.words} words</li>
                    <li>{p.limits.aiRequests.replace('/day', ' AI requests a day')}</li>
                    <li>{p.limits.storage} storage</li>
                  </ul>
                  <ul className="text-xs text-[var(--dim)] space-y-1 mb-4 flex-1">
                    {features.map((f) => <li key={f} className="flex gap-1.5"><Check size={12} className="mt-0.5 text-[var(--ok)] flex-shrink-0" />{f}</li>)}
                  </ul>
                  {higher && !sub && plans.checkout && (
                    <button type="button" className="btn sm pri" disabled={!!busyTier} onClick={() => checkout(p.tier)} data-testid={`upgrade-${p.tier}`}>
                      {busyTier === p.tier ? 'Opening checkout...' : `Upgrade to ${PLAN_NAMES[p.tier]}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!plans.checkout && <p className="text-xs text-[var(--dim)] mt-3">Online upgrades are not open yet. Contact us to change your plan.</p>}
        </Panel>
      )}

      <Panel title="AI activity" aside={<span className="lbl">Last 30 days</span>} testid="settings-activity">
        {!activity ? <div className="hatch h-16 rounded-[3px]" aria-label="Loading activity" /> : (
          <>
            {activity.month && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="border border-[var(--line)] rounded-[3px] p-3">
                  <div className="lbl mb-1">Requests this month</div>
                  <div className="text-xl font-semibold mono num text-[var(--ink)]">{Number(activity.month.monthRequests || 0).toLocaleString()}</div>
                </div>
                <div className="border border-[var(--line)] rounded-[3px] p-3">
                  <div className="lbl mb-1">Tokens this month</div>
                  <div className="text-xl font-semibold mono num text-[var(--ink)]">{Number(activity.month.monthTokens || 0).toLocaleString()}</div>
                </div>
              </div>
            )}
            {activity.tools.length === 0 ? <p className="text-sm text-[var(--dim)]">No AI activity in the last 30 days.</p> : (
              <ul className="divide-y divide-[var(--line)]">
                {activity.tools.map((t) => (
                  <li key={t.toolType} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-[var(--ink)]">{toolLabel(t.toolType)}</span>
                    <span className="mono num text-xs text-[var(--dim)]">{t.usageCount.toLocaleString()} {t.usageCount === 1 ? 'use' : 'uses'}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

/* ── AI models ────────────────────────────────────────────────────────────────────────────────── */
function ModelsSection({ say, onSeePlans }) {
  const [info, setInfo] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const load = useCallback(() => api('/api/ai-models').then(setInfo).catch((err) => { setInfo({ error: true }); say('error', err.message); }), [say]);
  useEffect(() => { load(); }, [load]);

  const choose = async (writer) => {
    setSaving(true); setSaved(false);
    try { await api('/api/users/ai-model', { method: 'PUT', body: { writer } }); await load(); setSaved(true); setTimeout(() => setSaved(false), 2500); }
    catch (err) { say('error', err.message); } finally { setSaving(false); }
  };

  if (!info) return <div className="hatch h-40 rounded-[3px]" aria-label="Loading models" />;
  if (info.error) return null;
  const w = info.writer;
  const ModelName = ({ m }) => <span className="pill" style={{ color: 'var(--ink)' }}>{m.label}</span>;

  return (
    <>
      <Panel title="Writer" testid="settings-writer"
        aside={saved ? <span className="text-xs text-[var(--ok)] flex items-center gap-1" role="status"><Check size={12} /> Saved</span> : <ModelName m={w.model} />}>
        <p className="text-sm text-[var(--dim)] mb-3">Chapters, whole books, the AI writing tools, film transcripts, narration scripts and the director's review of a film.</p>
        {w.canChoose ? (
          <fieldset disabled={saving} className="space-y-2" data-testid="writer-choices">
            <legend className="lbl mb-2">The model that writes for you</legend>
            {[{ id: null, label: `Plan default (${w.planDefault.label})`, note: 'Follows the model Stories recommends; it may change as better ones arrive.' }, ...w.choices].map((m) => {
              const on = (w.chosen || null) === m.id;
              return (
                <label key={m.id || 'default'} className="flex items-start gap-3 border rounded-[3px] px-3 py-2.5 cursor-pointer"
                  style={{ borderColor: on ? 'var(--blue)' : 'var(--line)' }} data-testid={`writer-choice-${m.id || 'default'}`}>
                  <input type="radio" name="writer-model" className="!p-0 mt-1" checked={on} onChange={() => choose(m.id)} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[var(--ink)]">{m.label}</span>
                    {m.note && <span className="block text-xs text-[var(--dim)]">{m.note}</span>}
                  </span>
                </label>
              );
            })}
            <p className="text-xs text-[var(--dim)] pt-1">Your choice applies to new requests straight away. It counts against your daily AI requests the same way.</p>
          </fieldset>
        ) : (
          <div className="border border-dashed border-[var(--line2)] rounded-[3px] px-4 py-3 flex flex-wrap items-center justify-between gap-3" data-testid="writer-locked">
            <p className="text-sm text-[var(--dim)] flex items-center gap-2"><Lock size={14} /> On Premium you can choose the model that writes for you.</p>
            <button type="button" className="btn sm" onClick={onSeePlans}>See plans</button>
          </div>
        )}
      </Panel>

      <Panel title="Assistant" aside={<ModelName m={info.assistant.model} />} testid="settings-assistant">
        <p className="text-sm text-[var(--dim)]">{info.assistant.description}. It also looks at your pictures for the shot doctor and the keyframe checks. Set by Stories for everyone.</p>
      </Panel>

      <Panel title="Pictures, film and sound" testid="settings-media-models">
        <ul className="divide-y divide-[var(--line)]">
          {info.media.map((m) => (
            <li key={m.job} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-1 sm:gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm text-[var(--ink)]">{m.job}</p>
                <p className="text-xs text-[var(--dim)]">{m.detail}</p>
                {m.premium && <p className="text-xs text-[var(--blue)] mt-0.5 flex items-center gap-1"><Lock size={11} /> Premium: {m.premium}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5 sm:justify-end items-start">{m.models.map((x) => <span key={x} className="pill">{x}</span>)}</div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[var(--dim)] mt-3">Every model runs on Solutions AI's own platform, included in your plan.</p>
      </Panel>
    </>
  );
}

/* ── Preferences ──────────────────────────────────────────────────────────────────────────────── */
function PreferencesSection({ say }) {
  const { choice, setTheme } = useTheme();
  const [prefs, setPrefs] = useState(null);
  const [lists, setLists] = useState({ vibevoice: [], qwen: [], custom: [] });
  const [voices, setVoices] = useState(null);
  const [saved, setSaved] = useState(false);
  const [playing, setPlaying] = useState(null);
  const audio = useRef(null);

  useEffect(() => {
    api('/api/users/settings').then((d) => setPrefs(d.preferences || {})).catch(() => setPrefs({}));
    api('/api/audiobook/voices').then((v) => setLists({ vibevoice: v.vibevoice || [], qwen: v.qwen || [], custom: v.custom || [] })).catch(() => {});
    api('/api/voices').then((d) => setVoices(d.voices || [])).catch(() => setVoices([]));
    return () => { audio.current?.pause(); };
  }, []);

  // the server replaces the whole preferences object, so every save sends all of it
  const savePrefs = async (next) => {
    setPrefs(next); setSaved(false);
    try { await api('/api/users/settings', { method: 'PUT', body: { preferences: next } }); setSaved(true); setTimeout(() => setSaved(false), 2500); }
    catch (err) { say('error', err.message); }
  };
  const play = (v) => {
    audio.current?.pause();
    if (playing === v.id) { setPlaying(null); return; }
    const a = new Audio(v.sampleUrl);
    audio.current = a;
    a.onended = () => setPlaying(null);
    a.play().then(() => setPlaying(v.id)).catch(() => setPlaying(null));
  };
  const remove = async (v) => {
    try {
      await api(`/api/voices/${v.id}`, { method: 'DELETE' });
      setVoices((list) => list.filter((x) => x.id !== v.id));
      setLists((l) => ({ ...l, custom: l.custom.filter((x) => x.id !== v.id) }));
      if (prefs && normalizeVoiceSpec(prefs.defaultVoice).customVoiceId === v.id) savePrefs({ ...prefs, defaultVoice: null });
    } catch (err) { say('error', err.message); }
  };

  const current = prefs ? voiceKey(prefs.defaultVoice) : '';
  const known = [...lists.vibevoice.map((v) => `vibevoice:${v.id}`), ...lists.qwen.map((v) => `qwen:${v.id}`), ...lists.custom.map((v) => `custom:${v.id}`)];
  const ThemeChoice = ({ value, icon: Icon, label }) => (
    <button type="button" onClick={() => setTheme(value)} aria-pressed={choice === value}
      className={`btn sm ${choice === value ? 'pri' : ''}`} data-testid={`theme-${value}`}><Icon size={14} /> {label}</button>
  );

  return (
    <>
      <Panel title="Appearance" testid="settings-appearance">
        <Row label="Theme" hint="Saved in this browser.">
          <div className="flex flex-wrap gap-2">
            <ThemeChoice value="light" icon={Sun} label="Light" />
            <ThemeChoice value="dark" icon={Moon} label="Dark" />
            <ThemeChoice value="system" icon={MonitorSmartphone} label="Match my device" />
          </div>
        </Row>
      </Panel>

      <Panel title="Audiobooks" aside={saved ? <span className="text-xs text-[var(--ok)] flex items-center gap-1" role="status"><Check size={12} /> Saved</span> : null} testid="settings-audiobooks">
        <Row label="Default voice" hint="New audiobooks start with this voice. Each book can still choose its own.">
          {!prefs ? <div className="hatch h-10 rounded-[3px]" /> : (
            <select value={current} onChange={(e) => savePrefs({ ...prefs, defaultVoice: specFromKey(e.target.value) })} className="w-full max-w-md" data-testid="default-voice-select">
              {!known.includes(current) && (
                <option value={current}>{normalizeVoiceSpec(prefs.defaultVoice).customVoiceId ? 'My voice' : vibeVoiceLabel(normalizeVoiceSpec(prefs.defaultVoice).voice)}</option>
              )}
              {[...new Set(lists.vibevoice.map((v) => languageOf(v.id, v.language)))].map((lang) => (
                <optgroup key={lang} label={`VibeVoice: ${lang}`}>
                  {lists.vibevoice.filter((v) => languageOf(v.id, v.language) === lang).map((v) => <option key={v.id} value={`vibevoice:${v.id}`}>{vibeVoiceLabel(v.id, v.language)}</option>)}
                </optgroup>
              ))}
              {lists.qwen.length > 0 && (
                <optgroup label="Qwen voices">
                  {lists.qwen.map((v) => <option key={v.id} value={`qwen:${v.id}`}>{v.name || v.id}{v.language ? ` (${v.language})` : ''}</option>)}
                </optgroup>
              )}
              {lists.custom.length > 0 && (
                <optgroup label="My voices">
                  {lists.custom.map((v) => <option key={v.id} value={`custom:${v.id}`}>{v.name}</option>)}
                </optgroup>
              )}
            </select>
          )}
        </Row>
        <Row label="My voices" hint="Add a voice from a book's Audiobook tab. Deleting one keeps audio already made with it.">
          {voices === null ? <div className="hatch h-10 rounded-[3px]" /> : voices.length === 0 ? (
            <p className="text-sm text-[var(--dim)]">No custom voices yet.</p>
          ) : (
            <ul className="space-y-2" data-testid="settings-voices">
              {voices.map((v) => (
                <li key={v.id} className="flex items-center gap-2 border border-[var(--line)] rounded-[3px] px-2 py-1.5">
                  <button type="button" className="btn ghost sm !px-2" onClick={() => play(v)} disabled={!v.sampleUrl} aria-label={`${playing === v.id ? 'Stop' : 'Play'} the sample of ${v.name}`}>
                    {playing === v.id ? <Square size={14} /> : <Play size={14} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--ink)] truncate">{v.name}</p>
                    <p className="text-xs text-[var(--dim)] mono">{v.durationSec ? `${Number(v.durationSec).toFixed(1)} s sample` : 'sample'}{v.createdAt ? ` · ${new Date(v.createdAt).toLocaleDateString('en-GB')}` : ''}</p>
                  </div>
                  <ConfirmButton className="btn ghost sm !px-2" danger confirmLabel="Delete" onConfirm={() => remove(v)} testid="settings-voice-delete">
                    <Trash2 size={14} className="text-[var(--red)]" aria-label={`Delete ${v.name}`} />
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          )}
        </Row>
      </Panel>
    </>
  );
}

export default SettingsPage;
