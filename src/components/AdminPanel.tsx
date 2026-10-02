import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdminError, adminLogin, adminLogout, createCode, isSignedOut, listCodes, revokeCode,
  type WorkshopCode,
} from '../admin/adminApi';

/**
 * The teacher's panel: sign in, hand each class a code, revoke it afterwards.
 *
 * The entry button is small and tucked into a corner so it does not compete
 * with the workshop, but that is tidiness, not security -- every route behind
 * it is authenticated on the server.
 */
const EXPIRY_CHOICES = [
  { hours: 4, label: '4 hours' },
  { hours: 8, label: '8 hours (a workshop day)' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
];

const STATE_LABELS: Record<WorkshopCode['state'], string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
  exhausted: 'Limit reached',
};

/** Shown exactly once, then dropped from memory with the rest of the form. */
interface FreshCode { code: string; label: string }

export function AdminPanel() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [codes, setCodes] = useState<WorkshopCode[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [expiresInHours, setExpiresInHours] = useState(8);
  const [usageLimit, setUsageLimit] = useState(30);
  const [fresh, setFresh] = useState<FreshCode | null>(null);
  const [copied, setCopied] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const signOutLocally = useCallback(() => {
    setSignedInAs(null);
    setCodes([]);
    setFresh(null);
    setFormOpen(false);
    setPassword('');
  }, []);

  /** Any 401 from a later call means the session is gone; drop back to sign-in. */
  const handle = useCallback((cause: unknown) => {
    if (isSignedOut(cause)) {
      signOutLocally();
      setError('Your sign-in has expired. Please sign in again.');
      return;
    }
    setError(cause instanceof AdminError ? cause.message : 'That did not work. Please try again.');
  }, [signOutLocally]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const result = await listCodes();
      setSignedInAs(result.email);
      setCodes(result.codes);
      setError(null);
    } catch (cause) {
      handle(cause);
    } finally {
      setBusy(false);
    }
  }, [handle]);

  // Opening the panel asks the server whether this browser already has a
  // session, so a teacher who signed in earlier is not asked twice.
  useEffect(() => {
    if (!open) return;
    listCodes().then(
      (result) => { setSignedInAs(result.email); setCodes(result.codes); },
      () => signOutLocally(),
    );
  }, [open, signOutLocally]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    firstFieldRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, signedInAs]);

  const close = () => {
    setOpen(false);
    setError(null);
    setNotice(null);
    setFresh(null);
    setFormOpen(false);
    setPassword('');
  };

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminLogin(email, password);
      setPassword('');
      await refresh();
    } catch (cause) {
      setPassword('');
      setError(cause instanceof AdminError ? cause.message : 'Sign-in failed. Check the email and password.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try { await adminLogout(); } catch { /* the local session goes either way */ }
    signOutLocally();
    setNotice('Signed out.');
    setBusy(false);
  };

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createCode({ label: label.trim(), expiresInHours, usageLimit });
      setFresh({ code: result.code, label: result.entry.label });
      setCopied(false);
      setLabel('');
      setFormOpen(false);
      await refresh();
    } catch (cause) {
      handle(cause);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await revokeCode(id);
      setNotice('Code revoked.');
      await refresh();
    } catch (cause) {
      handle(cause);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.code);
      setCopied(true);
    } catch {
      setError('Copying failed. Select the code and copy it by hand.');
    }
  };

  return (
    <>
      <button
        type="button"
        className="adminLaunch"
        aria-label="Workshop admin"
        title="Workshop admin"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">⚙</span>
      </button>

      {open && (
        <div className="adminBackdrop" onClick={close}>
          <div
            className="adminPanel"
            role="dialog"
            aria-modal="true"
            aria-label="Workshop admin"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="adminHead">
              <h2>Workshop admin</h2>
              <button type="button" className="btn btnGhost" onClick={close}>Close</button>
            </header>

            {error && <p className="adminError" role="alert">{error}</p>}
            {notice && !error && <p className="adminNotice" role="status">{notice}</p>}

            {!signedInAs ? (
              <form
                className="adminForm"
                onSubmit={(event) => { event.preventDefault(); void signIn(); }}
              >
                <label htmlFor="admin-email">Email</label>
                <input
                  id="admin-email"
                  ref={firstFieldRef}
                  type="email"
                  className="createInput"
                  autoComplete="username"
                  maxLength={160}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <label htmlFor="admin-password">Password</label>
                <input
                  id="admin-password"
                  type="password"
                  className="createInput"
                  autoComplete="current-password"
                  maxLength={512}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button type="submit" className="btn btnPrimary" disabled={busy || !email || !password}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            ) : (
              <>
                <p className="adminWho">Signed in as {signedInAs}</p>

                {fresh && (
                  <div className="adminFresh" role="status">
                    <strong>New code for {fresh.label}</strong>
                    <code className="adminFreshCode">{fresh.code}</code>
                    <div className="adminFreshActions">
                      <button type="button" className="btn btnPrimary" onClick={() => void copy()}>
                        {copied ? 'Copied!' : 'Copy code'}
                      </button>
                      <button type="button" className="btn btnGhost" onClick={() => setFresh(null)}>Done</button>
                    </div>
                    <p className="adminWarning">Copy this now. The full code will not be shown again.</p>
                  </div>
                )}

                <h3 className="adminSectionTitle">Workshop codes</h3>
                {codes.length === 0 ? (
                  <p className="adminWho">No codes yet. Generate one for your first class.</p>
                ) : (
                  <table className="adminTable">
                    <thead>
                      <tr><th>Class</th><th>Code</th><th>Used</th><th>Status</th><th></th></tr>
                    </thead>
                    <tbody>
                      {codes.map((entry) => (
                        <tr key={entry.id} className={entry.state === 'active' ? '' : 'isInactive'}>
                          <td>{entry.label}</td>
                          <td><code>{entry.masked}</code></td>
                          <td>{entry.usageCount} / {entry.usageLimit}</td>
                          <td>{STATE_LABELS[entry.state]}</td>
                          <td>
                            {entry.revokedAt === null && (
                              <button
                                type="button"
                                className="btn btnGhost adminRevoke"
                                disabled={busy}
                                onClick={() => void revoke(entry.id)}
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {formOpen ? (
                  <form
                    className="adminForm"
                    onSubmit={(event) => { event.preventDefault(); void generate(); }}
                  >
                    <label htmlFor="admin-label">Label</label>
                    <input
                      id="admin-label"
                      type="text"
                      className="createInput"
                      maxLength={60}
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                      placeholder="Workshop Group A"
                    />
                    <label htmlFor="admin-expiry">Expires in</label>
                    <select
                      id="admin-expiry"
                      className="createInput"
                      value={expiresInHours}
                      onChange={(event) => setExpiresInHours(Number(event.target.value))}
                    >
                      {EXPIRY_CHOICES.map((choice) => (
                        <option key={choice.hours} value={choice.hours}>{choice.label}</option>
                      ))}
                    </select>
                    <label htmlFor="admin-limit">Usage limit</label>
                    <input
                      id="admin-limit"
                      type="number"
                      className="createInput"
                      min={1}
                      max={5000}
                      value={usageLimit}
                      onChange={(event) => setUsageLimit(Number(event.target.value))}
                    />
                    <div className="adminFreshActions">
                      <button type="submit" className="btn btnPrimary" disabled={busy || !label.trim()}>
                        {busy ? 'Generating…' : 'Generate'}
                      </button>
                      <button type="button" className="btn btnGhost" onClick={() => setFormOpen(false)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className="adminFreshActions">
                    <button type="button" className="btn btnPrimary" onClick={() => { setFormOpen(true); setNotice(null); }}>
                      Generate new code
                    </button>
                    <button type="button" className="btn btnGhost" onClick={() => void refresh()} disabled={busy}>
                      Refresh
                    </button>
                    <button type="button" className="btn btnGhost" onClick={() => void signOut()} disabled={busy}>
                      Logout
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
