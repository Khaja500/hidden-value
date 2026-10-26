import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AdvisorPanel } from '../components/AdvisorPanel';
import { PlayingCard } from '../components/PlayingCard';
import { PositionPanel } from '../components/PositionPanel';
import { QuoteBoard } from '../components/QuoteBoard';
import { TopBar } from '../components/TopBar';
import { TradeFeed } from '../components/TradeFeed';
import { cardName } from '../engine/cards';
import { MAX_SEATS, MIN_SEATS } from '../engine/multiGame';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../engine/rules';
import type { Difficulty, PlayerView } from '../engine/types';
import { normalizeCode, ROOM_CODE_LENGTH, TURN_TIMEOUT_MS, type RoomDoc } from '../online/rooms';
import { href, navigate } from '../router';
import { useAuth, type AuthUser } from '../store/authStore';
import { useOnline } from '../store/onlineStore';
import { load, save } from '../store/storage';
import { ResultsBody, Seats, TableCards } from './Party';

const TABLE_BLURB: Record<Difficulty, string> = {
  easy: 'Naive market maker, fixed spread.',
  medium: 'Reads the bots’ flow, ignores yours.',
  hard: 'Also learns from every player’s trades.',
  expert: 'A market maker trained by simulation.',
};

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  );
}

export function Online({ code }: { code?: string }) {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  useEffect(() => {
    document.title = code ? `Table ${code} · Hidden Value` : 'Play online · Hidden Value';
  }, [code]);
  if (status === 'loading') {
    return (
      <main id="main" className="page page--narrow">
        <p className="muted">Checking your account…</p>
      </main>
    );
  }
  if (!user) return <SignInFirst code={code} />;
  if (!code) return <OnlineHome />;
  return <Room key={code} code={normalizeCode(code)} user={user} />;
}

function SignInFirst({ code }: { code?: string }) {
  const next = code ? `/online/${code}` : '/online';
  return (
    <main id="main" className="page page--narrow online">
      <p className="stamp">Play online</p>
      <h1>{code ? `You’re invited to table ${code}` : 'Play your friends, each on your own device'}</h1>
      <p className="lede">
        Sign in or create a free account with your email to play online. Your games are saved to your account,
        so you can see your history on any device.
      </p>
      <div className="row">
        <a className="btn btn--primary btn--big" href={href(`/account?next=${encodeURIComponent(next)}`)}>
          Sign in or create an account
        </a>
      </div>
    </main>
  );
}

// ---- Create or join -------------------------------------------------------------------------------------------

interface SavedOnline {
  difficulty: Difficulty;
  advisorOn: boolean;
}

function OnlineHome() {
  const [setup, setSetup] = useState<SavedOnline>(() => ({
    difficulty: 'medium',
    advisorOn: true,
    ...load<Partial<SavedOnline>>('online:setup', {}),
  }));
  const [joinCode, setJoinCode] = useState('');
  const create = useOnline((s) => s.create);
  const join = useOnline((s) => s.join);
  const busy = useOnline((s) => s.busy);
  const error = useOnline((s) => s.error);
  const clearError = useOnline((s) => s.clearError);
  useEffect(() => clearError, [clearError]);

  const onCreate = async () => {
    save('online:setup', setup);
    const code = await create(setup.difficulty, setup.advisorOn).catch(() => null);
    if (code) navigate(`/online/${code}`);
  };
  const onJoin = async (e: FormEvent) => {
    e.preventDefault();
    const code = await join(normalizeCode(joinCode)).catch(() => null);
    if (code) navigate(`/online/${code}`);
  };

  return (
    <main id="main" className="page online">
      <header className="pick__head">
        <p className="stamp">Multiplayer · online</p>
        <h1>Play your friends, each on your own device</h1>
        <p className="lede">
          Open a table, send your friends its code or link, and deal when everyone is in ({MIN_SEATS}–
          {MAX_SEATS} players). Each of you holds a different hidden card. Only the game server knows the
          whole deal, so nobody can peek. Results go into everyone’s history.
        </p>
      </header>
      {error && (
        <p className="callout online__error" role="alert">
          {error}
        </p>
      )}
      <div className="online__grid">
        <section className="ticket ticket--perf" aria-labelledby="open-title">
          <h2 className="stamp" id="open-title">
            Open a table
          </h2>
          <div className="online__tables" role="radiogroup" aria-label="Table">
            {DIFFICULTY_ORDER.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={setup.difficulty === d}
                className={`online__table ${setup.difficulty === d ? 'online__table--on' : ''}`}
                onClick={() => setSetup((s) => ({ ...s, difficulty: d }))}
                data-testid={`online-table-${d}`}
              >
                <strong>{DIFFICULTIES[d].label}</strong>
                <span className="muted">{TABLE_BLURB[d]}</span>
              </button>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={setup.advisorOn}
              onChange={(e) => setSetup((s) => ({ ...s, advisorOn: e.target.checked }))}
            />
            <span>Allow the Advisor</span>
          </label>
          <div className="row online__go">
            <button
              type="button"
              className="btn btn--primary btn--big"
              disabled={busy}
              onClick={onCreate}
              data-testid="online-create"
            >
              Open a {DIFFICULTIES[setup.difficulty].label} table
            </button>
          </div>
        </section>
        <section className="ticket" aria-labelledby="join-title">
          <h2 className="stamp" id="join-title">
            Join a friend’s table
          </h2>
          <form onSubmit={onJoin} className="online__join">
            <label htmlFor="join-code">Table code</label>
            <input
              id="join-code"
              type="text"
              className="online__code-input mono"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={ROOM_CODE_LENGTH + 2}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABC234"
            />
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || normalizeCode(joinCode).length !== ROOM_CODE_LENGTH}
            >
              Join
            </button>
          </form>
          <p className="muted">Or just open the invite link your friend sent you.</p>
        </section>
      </div>
    </main>
  );
}

// ---- A room ---------------------------------------------------------------------------------------------------

function Room({ code, user }: { code: string; user: AuthUser }) {
  const roomStatus = useOnline((s) => s.roomStatus);
  const room = useOnline((s) => s.room);
  const watch = useOnline((s) => s.watch);
  useEffect(() => {
    watch(code, user.uid);
  }, [code, user.uid, watch]);
  useEffect(() => () => useOnline.getState().unwatch(), []);

  if (roomStatus === 'missing') return <JoinPrompt code={code} user={user} />;
  if (!room) {
    return (
      <main id="main" className="page page--narrow">
        <p className="muted">Opening table {code}…</p>
      </main>
    );
  }
  if (room.status === 'lobby') return <Lobby room={room} user={user} />;
  return (
    <main id="main" className="page page--play">
      <OnlineTable room={room} user={user} />
    </main>
  );
}

function JoinPrompt({ code, user }: { code: string; user: AuthUser }) {
  const join = useOnline((s) => s.join);
  const watch = useOnline((s) => s.watch);
  const busy = useOnline((s) => s.busy);
  const error = useOnline((s) => s.error);
  const onJoin = async () => {
    const joined = await join(code).catch(() => null);
    if (joined) watch(joined, user.uid);
  };
  return (
    <main id="main" className="page page--narrow online">
      <p className="stamp">Table {code}</p>
      <h1>Join this table?</h1>
      <p className="lede">
        You’ll play as <strong>{user.displayName}</strong>. You can change your name on your{' '}
        <a href={href('/account')}>account page</a>.
      </p>
      {error && (
        <p className="callout online__error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          className="btn btn--primary btn--big"
          disabled={busy}
          onClick={onJoin}
          data-testid="online-join"
        >
          Join table {code}
        </button>
        <a className="btn btn--ghost" href={href('/online')}>
          Back
        </a>
      </div>
    </main>
  );
}

function inviteLink(code: string): string {
  return `${window.location.origin}${window.location.pathname}#/online/${code}`;
}

function Lobby({ room, user }: { room: RoomDoc; user: AuthUser }) {
  const start = useOnline((s) => s.start);
  const leave = useOnline((s) => s.leave);
  const busy = useOnline((s) => s.busy);
  const error = useOnline((s) => s.error);
  const [copied, setCopied] = useState(false);
  const isHost = room.hostUid === user.uid;
  const link = inviteLink(room.code);
  const enough = room.players.length >= MIN_SEATS;

  const copy = async () => {
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({
          title: 'Hidden Value',
          text: `Join my Hidden Value table: ${room.code}`,
          url: link,
        });
      } else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // The share sheet was dismissed, or the clipboard is blocked: the link is on screen to copy by hand.
    }
  };
  const onLeave = async () => {
    await leave().catch(() => {});
    navigate('/online');
  };

  return (
    <main id="main" className="page page--narrow online">
      <p className="stamp">
        {DIFFICULTIES[room.difficulty].label} table · Advisor {room.advisorOn ? 'on' : 'off'}
      </p>
      <h1 className="online__code-title">
        Table{' '}
        <span className="mono online__code" data-testid="room-code">
          {room.code}
        </span>
      </h1>
      <section className="ticket ticket--perf online__invite" aria-labelledby="invite-title">
        <h2 className="stamp" id="invite-title">
          Invite your friends
        </h2>
        <p>Send them this link, or the code above. They’ll need a free account too.</p>
        <div className="online__link">
          <input
            type="text"
            readOnly
            value={link}
            aria-label="Invite link"
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className="btn" onClick={copy}>
            {copied ? 'Copied' : 'Share link'}
          </button>
        </div>
      </section>
      <section className="ticket" aria-labelledby="players-title">
        <h2 className="stamp" id="players-title">
          At the table ({room.players.length}/{MAX_SEATS})
        </h2>
        <ol className="online__players" data-testid="lobby-players">
          {room.players.map((p, i) => (
            <li key={p.uid}>
              <span className="mono online__seat">P{i + 1}</span>
              <span>{p.name}</span>
              {p.uid === room.hostUid && <span className="tag tag--brass">Host</span>}
              {p.uid === user.uid && <span className="tag">You</span>}
            </li>
          ))}
        </ol>
        {room.gameNo > 0 && (
          <p className="muted">
            Someone left, so the table is back in the lobby. Deal again when you’re ready.
          </p>
        )}
      </section>
      {error && (
        <p className="callout online__error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        {isHost ? (
          <button
            type="button"
            className="btn btn--primary btn--big"
            disabled={busy || !enough}
            onClick={() => start().catch(() => {})}
            data-testid="online-deal"
          >
            {enough ? `Deal ${room.players.length} hands` : 'Waiting for a friend to join…'}
          </button>
        ) : (
          <p className="muted" role="status">
            Waiting for {room.players.find((p) => p.uid === room.hostUid)?.name} to deal…
          </p>
        )}
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onLeave}>
          Leave table
        </button>
      </div>
    </main>
  );
}

// ---- The game -------------------------------------------------------------------------------------------------

function OnlineTable({ room, user }: { room: RoomDoc; user: AuthUser }) {
  const pub = useOnline((s) => s.pub)!;
  const view = useOnline((s) => s.view);
  const error = useOnline((s) => s.error);
  const names = room.players.map((p) => p.name);
  const mySeat = room.playerUids.indexOf(user.uid);
  const settled = room.status === 'settled';
  const turnSeat = pub.turn.seat;
  const myTurn = !settled && turnSeat === mySeat && view !== null;

  // Keyboard, as in the other modes: B/S buy or sell, 1/2/3 size, Space pass, A ask the Advisor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const s = useOnline.getState();
      const v = s.view;
      if (!v || s.sentAt === v.events.length) return;
      if (!(s.pub?.phase === 'awaitingPlayer' && s.pub.turn.seat === v.seat)) return;
      const k = e.key.toLowerCase();
      const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
      if (k === 'b' && v.maxBuy >= s.size) void s.act({ side: 'buy', size: s.size });
      else if (k === 's' && v.maxSell >= s.size) void s.act({ side: 'sell', size: s.size });
      else if (k === '1' || k === '2' || k === '3') s.setSize(Number(k));
      else if (k === ' ' && !onButton) {
        e.preventDefault();
        void s.act({ side: 'pass', size: 0 });
      } else if (k === 'a') s.askAdvisor();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // When it becomes this player's turn, bring the order panel into view (it sits low on phones).
  const main = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!myTurn) return;
    const el = main.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) el.scrollIntoView({ block: 'start' });
  }, [myTurn]);

  const owner = (position: number) => (position < names.length ? names[position] : null);
  return (
    <div className="party online-table" data-testid="online-table" data-events={pub.events.length}>
      <div className="party__top">
        <TopBar
          view={view ?? pub}
          modeLabel={`Online · ${room.code}`}
          pacingLabel={`${names.length} players`}
        />
      </div>
      <div className="party__seats">
        <Seats pub={pub} names={names} hints={null} />
      </div>
      <div className="party__cards">
        <TableCards pub={pub} names={names} result={room.result} />
      </div>
      <div className="party__main" ref={main}>
        {error && (
          <p className="callout online__error" role="alert">
            {error}
          </p>
        )}
        {settled && room.result ? (
          <OnlineResults room={room} user={user} />
        ) : !view ? (
          <p className="muted">Dealing your card…</p>
        ) : myTurn ? (
          <MyTurn view={view} advisorOn={room.advisorOn} />
        ) : (
          <Waiting view={view} name={turnSeat === null ? '' : names[turnSeat]} />
        )}
      </div>
      <div className="party__feed">
        <TradeFeed events={pub.events} names={names} cardOwner={owner} limit={60} />
      </div>
    </div>
  );
}

function MyCard({ view }: { view: PlayerView }) {
  const mine = view.privateCards[0];
  const revealed = view.revealed.some((r) => r.position === mine.position);
  return (
    <div className="turn__mine ticket">
      <PlayingCard card={mine.card} role="private" caption={revealed ? 'Yours (now public)' : 'Yours'} />
      <p>
        Your card is the <strong>{cardName(mine.card)}</strong>.{' '}
        {revealed
          ? 'It has been revealed, so everyone knows it now.'
          : 'Only you know it. The market maker and the other players do not.'}
      </p>
    </div>
  );
}

function MyTurn({ view, advisorOn }: { view: PlayerView; advisorOn: boolean }) {
  const st = useOnline();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [view.events.length]);
  return (
    <section className="turn" aria-labelledby="turn-title" data-testid="online-turn">
      <div className="turn__head">
        <h2 id="turn-title" ref={heading} tabIndex={-1}>
          Your turn
        </h2>
      </div>
      <div className="turn__grid">
        <div className="turn__left">
          <MyCard view={view} />
          <QuoteBoard
            view={view}
            size={st.size}
            onSize={st.setSize}
            onAct={(a) => void st.act(a)}
            disabled={st.sentAt === view.events.length}
          />
          <PositionPanel view={view} estimate={st.belief?.mean ?? null} />
        </div>
        <div className="turn__right">
          {advisorOn ? (
            <AdvisorPanel
              view={view}
              belief={st.belief}
              advice={st.advice}
              onAsk={st.askAdvisor}
              hintsUsed={st.hints}
              intro="The Advisor uses your card, the reveals and the bots’ trades. It does not try to read the other players: that part is up to you."
            />
          ) : (
            <section className="advisor ticket">
              <h2 className="stamp">Advisor off</h2>
              <p className="muted">This table plays without the Advisor.</p>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}

/** Not this player's turn: their card and position, whose turn it is, and a way past a player who has gone quiet. */
function Waiting({ view, name }: { view: PlayerView; name: string }) {
  const timeout = useOnline((s) => s.timeout);
  const busy = useOnline((s) => s.busy);
  // Timed from when this device saw the turn begin, so a skewed clock can't make the button appear early.
  const key = view.events.length;
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setSince(Date.now());
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [key]);
  const left = Math.ceil((since + TURN_TIMEOUT_MS + 2000 - now) / 1000);
  return (
    <section className="turn" aria-live="polite" data-testid="online-waiting">
      <div className="turn__head">
        <h2>Waiting for {name}…</h2>
      </div>
      <div className="turn__grid">
        <div className="turn__left">
          <MyCard view={view} />
          <PositionPanel view={view} estimate={null} />
        </div>
        <div className="turn__right">
          <section className="ticket online__wait">
            <p>
              {name} is deciding. Watch the feed: every trade shows who made it, and reading the other players
              is part of the game.
            </p>
            {left > 0 ? (
              <p className="muted">
                If {name} doesn’t act, you can pass for them in {left} s.
              </p>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={() => void timeout()}>
                Pass for {name}
              </button>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

function OnlineResults({ room, user }: { room: RoomDoc; user: AuthUser }) {
  const start = useOnline((s) => s.start);
  const leave = useOnline((s) => s.leave);
  const busy = useOnline((s) => s.busy);
  const isHost = room.hostUid === user.uid;
  const host = room.players.find((p) => p.uid === room.hostUid)?.name;
  const onLeave = async () => {
    await leave().catch(() => {});
    navigate('/online');
  };
  return (
    <ResultsBody result={room.result!} names={room.players.map((p) => p.name)} showHints={false}>
      {isHost ? (
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => start().catch(() => {})}
          data-testid="online-rematch"
        >
          Rematch: new deal
        </button>
      ) : (
        <span className="muted">Waiting for {host} to deal again…</span>
      )}
      <a className="btn" href={href('/account')}>
        Your history
      </a>
      <button type="button" className="btn btn--ghost" disabled={busy} onClick={onLeave}>
        Leave table
      </button>
    </ResultsBody>
  );
}
