import { useEffect, useState, type FormEvent } from 'react';
import { cardLabel } from '../engine/cards';
import { DIFFICULTIES } from '../engine/rules';
import { signed } from '../explain/render';
import type { HistoryEntry } from '../online/history';
import { summarize } from '../online/history';
import { href, navigate } from '../router';
import { useAuth, type AuthUser } from '../store/authStore';
import { loadLogs } from '../store/gameStore';

export function Account({ query }: { query: URLSearchParams }) {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const signingUp = useAuth((s) => s.signingUp);
  const next = query.get('next');
  useEffect(() => {
    document.title = 'Account · Hidden Value';
  }, []);
  // Coming from an invite link or the online page: go back there once signed in.
  useEffect(() => {
    if (user && !signingUp && next?.startsWith('/')) navigate(next);
  }, [user, signingUp, next]);

  if (status === 'loading') {
    return (
      <main id="main" className="page page--narrow">
        <p className="muted">Checking your account…</p>
      </main>
    );
  }
  return user && !signingUp ? <Profile user={user} /> : <SignIn />;
}

// ---- Signed out -----------------------------------------------------------------------------------------------

type Mode = 'signIn' | 'signUp' | 'reset';

function SignIn() {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const auth = useAuth();

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signIn') await auth.signIn(email, password);
      else if (mode === 'signUp') await auth.signUp(email, password, name);
      else {
        await auth.resetPassword(email);
        setNotice(`If there is an account for ${email.trim()}, a link to reset its password is on its way.`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Create your account' : 'Reset your password';
  return (
    <main id="main" className="page page--narrow account">
      <p className="stamp">Account</p>
      <h1>{title}</h1>
      <p className="lede">
        An account keeps your game history on every device and lets you{' '}
        <a href={href('/online')}>play your friends online</a>. Everything else works without one.
      </p>
      <div className="seg" role="tablist" aria-label="Sign in or create an account">
        {(['signIn', 'signUp'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`seg__btn ${mode === m ? 'seg__btn--on' : ''}`}
            onClick={() => switchTo(m)}
          >
            {m === 'signIn' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      <form className="ticket account__form" onSubmit={submit} data-testid="account-form">
        {mode === 'signUp' && (
          <label className="field">
            <span>Your name at the table</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={16}
              autoComplete="nickname"
              placeholder="How friends will see you"
            />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        {mode !== 'reset' && (
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
              minLength={mode === 'signUp' ? 6 : undefined}
              required
            />
            {mode === 'signUp' && <span className="muted field__hint">At least 6 characters.</span>}
          </label>
        )}
        {error && (
          <p className="callout account__error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="callout" role="status">
            {notice}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Create account' : 'Send reset link'}
          </button>
          {mode === 'signIn' && (
            <button type="button" className="btn btn--ghost" onClick={() => switchTo('reset')}>
              Forgot your password?
            </button>
          )}
          {mode === 'reset' && (
            <button type="button" className="btn btn--ghost" onClick={() => switchTo('signIn')}>
              Back to sign in
            </button>
          )}
        </div>
        {mode === 'signUp' && (
          <p className="muted account__fine">
            We’ll email you a link to confirm your address. Your email is only used to sign you in; other
            players see only your name.
          </p>
        )}
      </form>
    </main>
  );
}

// ---- Signed in ------------------------------------------------------------------------------------------------

function Profile({ user }: { user: AuthUser }) {
  const auth = useAuth();
  const [name, setName] = useState(user.displayName);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifySent, setVerifySent] = useState(false);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await auth.setDisplayName(name);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main id="main" className="page account">
      <p className="stamp">Account</p>
      <h1>{user.displayName}</h1>
      <div className="account__grid">
        <section className="ticket" aria-labelledby="profile-title">
          <h2 className="stamp" id="profile-title">
            Profile
          </h2>
          <form className="account__name" onSubmit={saveName}>
            <label className="field">
              <span>Name at the table</span>
              <input type="text" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit" className="btn" disabled={name.trim() === user.displayName}>
              {saved ? 'Saved' : 'Save'}
            </button>
          </form>
          <p>
            <span className="muted">Email</span> {user.email}{' '}
            {user.emailVerified ? (
              <span className="tag">Confirmed</span>
            ) : (
              <span className="tag tag--brass">Not confirmed</span>
            )}
          </p>
          {!user.emailVerified && (
            <p className="muted">
              Click the link we emailed you (check spam too), then{' '}
              <button type="button" className="linkish" onClick={() => void auth.refresh()}>
                refresh
              </button>
              .{' '}
              {verifySent ? (
                'Sent again.'
              ) : (
                <button
                  type="button"
                  className="linkish"
                  onClick={() =>
                    void auth.resendVerification().then(
                      () => setVerifySent(true),
                      (e: Error) => setError(e.message),
                    )
                  }
                >
                  Send the link again
                </button>
              )}
            </p>
          )}
          {error && (
            <p className="callout account__error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <a className="btn btn--primary" href={href('/online')}>
              Play online
            </a>
            <button type="button" className="btn btn--ghost" onClick={() => void auth.signOut()}>
              Sign out
            </button>
          </div>
        </section>
        <History user={user} />
      </div>
    </main>
  );
}

function History({ user }: { user: AuthUser }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    import('../online/cloud')
      .then((c) => c.listHistory(user.uid))
      .then((e) => live && setEntries(e))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [user.uid, reload]);

  const inCloud = new Set(entries?.map((e) => e.id) ?? []);
  const local = loadLogs().filter((l) => !inCloud.has(l.id));
  const upload = async () => {
    setUploading(true);
    try {
      const c = await import('../online/cloud');
      for (const log of local) await c.saveSoloGame(user.uid, log);
      setReload((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const sum = entries ? summarize(entries) : null;
  return (
    <section className="ticket account__history" aria-labelledby="history-title">
      <h2 className="stamp" id="history-title">
        Your games
      </h2>
      {error && (
        <p className="callout account__error" role="alert">
          {error}
        </p>
      )}
      {!entries && !error && <p className="muted">Loading your history…</p>}
      {sum && (
        <dl className="account__stats">
          <div>
            <dt>Games</dt>
            <dd className="mono">{sum.games}</dd>
          </div>
          <div>
            <dt>Total P&amp;L</dt>
            <dd className={`mono ${sum.totalPnl > 0 ? 'pos' : sum.totalPnl < 0 ? 'neg' : ''}`}>
              {signed(sum.totalPnl)}
            </dd>
          </div>
          <div>
            <dt>Online wins</dt>
            <dd className="mono">
              {sum.online.wins}/{sum.online.games}
            </dd>
          </div>
          <div>
            <dt>Best game</dt>
            <dd className="mono">{sum.bestPnl === null ? '—' : signed(sum.bestPnl)}</dd>
          </div>
        </dl>
      )}
      {local.length > 0 && entries && (
        <p className="account__upload">
          This browser has {local.length} game{local.length === 1 ? '' : 's'} from before you signed in.{' '}
          <button type="button" className="btn btn--small" disabled={uploading} onClick={upload}>
            {uploading ? 'Saving…' : 'Add to my history'}
          </button>
        </p>
      )}
      {entries && entries.length === 0 && (
        <p className="empty">
          No games yet. <a href={href('/play')}>Play a game</a> or{' '}
          <a href={href('/online')}>play your friends</a>, and it will appear here.
        </p>
      )}
      {entries && entries.length > 0 && (
        <div className="table-wrap">
          <table className="data" data-testid="history">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Game</th>
                <th scope="col" className="num">
                  V
                </th>
                <th scope="col" className="num">
                  P&amp;L
                </th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <HistoryRow key={e.id} e={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HistoryRow({ e }: { e: HistoryEntry }) {
  const when = new Date(e.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const table = DIFFICULTIES[e.difficulty].label;
  if (e.kind === 'online') {
    const others = e.players.filter((_, i) => i !== e.seat);
    return (
      <tr>
        <td>{when}</td>
        <td>
          {table} · online vs {others.join(', ')}
        </td>
        <td className="num">{e.value}</td>
        <td className={`num ${e.pnl > 0 ? 'pos' : e.pnl < 0 ? 'neg' : ''}`}>{signed(e.pnl)}</td>
        <td>
          {e.rank === 1 ? (
            <span className="tag tag--brass">Won</span>
          ) : (
            `${ordinal(e.rank)} of ${e.players.length}`
          )}{' '}
          <span className="muted">
            · held {cardLabel(e.card)} · skill {signed(e.expected)}
          </span>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>{when}</td>
      <td>
        {table} · {e.mode}
      </td>
      <td className="num">{e.result.value}</td>
      <td className={`num ${e.result.pnl > 0 ? 'pos' : e.result.pnl < 0 ? 'neg' : ''}`}>
        {signed(e.result.pnl)}
      </td>
      <td>
        <a href={href(`/review/${e.id}`)}>Review</a>
        {e.skill !== null && <span className="muted"> · skill {signed(e.skill)}</span>}
      </td>
    </tr>
  );
}

function ordinal(n: number): string {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}
