import React, { useEffect, useRef, useState } from 'react';
import { Cloud, AlertCircle, Link2, Loader, Lock } from 'lucide-react';
import { PORTAL_ERRORS, portalLoginHref, safeReturnTo } from '../utils/portalAuth';

// The three pages the SAI Cloud round trip can land on (served by the SPA fallback):
//   /auth/portal/done   the sign-in worked: collect the session and open the app
//   /auth/portal/link   the one case that needs the old Stories password
//   /auth/portal/error  a plain-language reason
const Shell = ({ icon: Icon, tone = 'blue', title, children }) => (
  <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
    <div className="max-w-md w-full">
      <div className="card p-7">
        <div className="mb-4" style={{ color: tone === 'red' ? 'var(--red)' : 'var(--blue)' }}>
          <Icon className={`w-8 h-8${Icon === Loader ? ' animate-spin' : ''}`} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-[var(--ink)] mb-2">{title}</h1>
        {children}
      </div>
    </div>
  </div>
);

export const PortalDonePage = ({ onSignedIn }) => {
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const returnTo = safeReturnTo(new URLSearchParams(window.location.search).get('returnTo'));
    (async () => {
      try {
        const res = await fetch('/api/auth/portal/session', { method: 'POST', credentials: 'include' });
        if (!res.ok) throw new Error('session');
        const { user, token } = await res.json();
        onSignedIn(user, token, returnTo);
      } catch {
        setFailed(true);
      }
    })();
  }, [onSignedIn]);

  if (!failed) {
    return (
      <Shell icon={Loader} title="Signing you in">
        <p className="text-sm text-[var(--dim)]" role="status">Finishing your SAI Cloud sign-in...</p>
      </Shell>
    );
  }
  return (
    <Shell icon={AlertCircle} tone="red" title="Sign-in could not be completed">
      <p className="text-sm text-[var(--dim)] mb-5">Your sign-in did not finish in this browser. Nothing was changed. Please try again.</p>
      <a href="/auth/portal/login" className="btn pri w-full py-2.5 justify-center">Sign in with SAI Cloud</a>
    </Shell>
  );
};

export const PortalLinkPage = ({ onSignedIn }) => {
  const [state, setState] = useState({ loading: true, pending: false, email: '' });
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch('/api/auth/portal/link/status', { credentials: 'include' })
      .then((r) => r.json())
      .then((s) => { if (live) setState({ loading: false, pending: !!s.pending, email: s.email || '' }); })
      .catch(() => { if (live) setState({ loading: false, pending: false, email: '' }); });
    return () => { live = false; };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/portal/link', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'expired') setState((s) => ({ ...s, pending: false }));
        else if (data.code === 'linked_elsewhere') window.location.assign('/auth/portal/error?code=linked_elsewhere');
        else if (data.code === 'suspended') window.location.assign('/auth/portal/error?code=suspended');
        else if (data.code === 'contact_support') window.location.assign('/auth/portal/error?code=contact_support');
        else setError(data.error || 'That did not work. Check your Stories password and try again.');
        return;
      }
      onSignedIn(data.user, data.token, safeReturnTo(data.returnTo));
    } catch {
      setError('Could not reach Stories. Please try again.');
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  if (state.loading) {
    return (
      <Shell icon={Loader} title="Linking your account">
        <p className="text-sm text-[var(--dim)]" role="status">One moment...</p>
      </Shell>
    );
  }
  if (!state.pending) {
    return (
      <Shell icon={AlertCircle} tone="red" title="This step has expired">
        <p className="text-sm text-[var(--dim)] mb-5">The linking step is only kept for ten minutes, and only in the browser it was started in. Sign in with SAI Cloud again to restart it.</p>
        <a href="/auth/portal/login" className="btn pri w-full py-2.5 justify-center">Sign in with SAI Cloud</a>
      </Shell>
    );
  }
  return (
    <Shell icon={Link2} title="Linking your account">
      <p className="text-sm text-[var(--dim)] mb-1">
        There is already a Stories account for <strong className="text-[var(--ink)] break-all">{state.email}</strong>, and its email address
        was never verified here. To be sure it is yours, enter its Stories password once.
      </p>
      <p className="text-sm text-[var(--dim)] mb-5">After that you sign in with SAI Cloud. Your books and settings stay exactly where they are.</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="portal-link-password" className="lbl block mb-1.5"><Lock className="inline-block w-4 h-4 mr-1" aria-hidden="true" />Stories password</label>
          <input id="portal-link-password" type="password" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2.5 text-sm" />
        </div>
        {error && <div role="alert" className="border border-[var(--red)] text-[var(--red)] px-4 py-2.5 rounded-[3px] text-sm">{error}</div>}
        <button type="submit" disabled={busy || !password} className="btn pri w-full py-2.5 justify-center">{busy ? 'Linking...' : 'Link and sign in'}</button>
        <div className="flex flex-col gap-2 text-center text-sm">
          <a href={portalLoginHref({ different: true })} className="text-[var(--blue)] hover:underline">Not you? Use a different SAI Cloud account</a>
          <a href="/" className="text-[var(--dim)] hover:text-[var(--ink)]">Back to sign in</a>
        </div>
      </form>
    </Shell>
  );
};

export const PortalErrorPage = () => {
  const code = new URLSearchParams(window.location.search).get('code') || 'failed';
  const e = PORTAL_ERRORS[code] || PORTAL_ERRORS.failed;
  return (
    <Shell icon={code === 'email_unverified' ? Cloud : AlertCircle} tone={code === 'email_unverified' ? 'blue' : 'red'} title={e.title}>
      <p className="text-sm text-[var(--dim)] mb-5" role="alert">{e.body}</p>
      <div className="flex flex-col gap-3">
        {e.portalLink && <a href="https://solutionsai.co.uk/" className="btn pri w-full py-2.5 justify-center">Open SAI Cloud</a>}
        <a href={portalLoginHref({ different: !!e.different })} className={`btn ${e.portalLink ? '' : 'pri'} w-full py-2.5 justify-center`}>
          {e.different ? 'Use a different SAI Cloud account' : 'Try signing in again'}
        </a>
        <a href="/" className="text-center text-sm text-[var(--dim)] hover:text-[var(--ink)]">Back to sign in</a>
      </div>
    </Shell>
  );
};
