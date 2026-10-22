import { lazy, Suspense, useEffect, useState } from 'react';
import { REPO_URL } from './config';
import { Home } from './pages/Home';
import { Play } from './pages/Play';
import { href, useRoute } from './router';
import { applyTheme, useSettings, type Theme } from './store/settings';

const Party = lazy(() => import('./pages/Party').then((m) => ({ default: m.Party })));
const Tutorial = lazy(() => import('./pages/Tutorial').then((m) => ({ default: m.Tutorial })));
const Review = lazy(() => import('./pages/Review').then((m) => ({ default: m.Review })));
const Daily = lazy(() => import('./pages/Daily').then((m) => ({ default: m.Daily })));
const Research = lazy(() => import('./pages/Research').then((m) => ({ default: m.Research })));
const Sandbox = lazy(() => import('./pages/Sandbox').then((m) => ({ default: m.Sandbox })));
const About = lazy(() => import('./pages/About').then((m) => ({ default: m.About })));

const NAV = [
  { to: '/play', label: 'Play', names: ['play'] },
  { to: '/multiplayer', label: 'Multiplayer', names: ['party'] },
  { to: '/tutorial', label: 'Tutorial', names: ['tutorial'] },
  { to: '/daily', label: 'Daily', names: ['daily'] },
  { to: '/review', label: 'Review', names: ['review', 'reviewList'] },
  { to: '/research', label: 'Research', names: ['research'] },
  { to: '/sandbox', label: 'Sandbox', names: ['sandbox'] },
  { to: '/about', label: 'About', names: ['about'] },
];

function Mark() {
  return (
    <svg className="wordmark__mark" viewBox="0 0 26 32" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="18"
        height="25"
        rx="3"
        fill="var(--card-face)"
        stroke="var(--ink)"
        strokeWidth="1.6"
      />
      <rect
        x="7"
        y="6"
        width="18"
        height="25"
        rx="3"
        fill="var(--card-back-a)"
        stroke="var(--ink)"
        strokeWidth="1.6"
      />
      <text
        x="16"
        y="23.5"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontWeight="700"
        fontSize="13"
        fill="#f2ebdd"
      >
        ?
      </text>
    </svg>
  );
}

const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = {
  system: 'Theme: auto',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

export function App() {
  const route = useRoute();
  const theme = useSettings((s) => s.theme);
  const update = useSettings((s) => s.update);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  }, [route.path]);

  let page;
  switch (route.name) {
    case 'home':
      page = <Home />;
      break;
    case 'play':
      page = <Play query={route.query} />;
      break;
    case 'party':
      page = <Party />;
      break;
    case 'tutorial':
      page = <Tutorial />;
      break;
    case 'review':
      page = <Review gameId={route.params.gameId} />;
      break;
    case 'reviewList':
      page = <Review />;
      break;
    case 'daily':
      page = <Daily />;
      break;
    case 'research':
      page = <Research />;
      break;
    case 'sandbox':
      page = <Sandbox />;
      break;
    case 'about':
      page = <About />;
      break;
    default:
      page = (
        <main id="main" className="page page--narrow">
          <h1>Page not found</h1>
          <p>
            There is nothing at <span className="mono">{route.path}</span>.{' '}
            <a href={href('/')}>Go to the home page</a>.
          </p>
        </main>
      );
  }

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}
      >
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <a className="wordmark" href={href('/')}>
            <Mark />
            Hidden Value
          </a>
          <button
            type="button"
            className="btn btn--small btn--ghost nav-toggle"
            aria-expanded={navOpen}
            aria-controls="site-nav"
            onClick={() => setNavOpen((o) => !o)}
          >
            Menu
          </button>
          <nav id="site-nav" className="nav" data-open={navOpen} aria-label="Main">
            {NAV.map((n) => (
              <a
                key={n.to}
                href={href(n.to)}
                aria-current={n.names.includes(route.name) ? 'page' : undefined}
              >
                {n.label}
              </a>
            ))}
            <button
              type="button"
              className="btn btn--small btn--ghost theme-toggle"
              onClick={() => update({ theme: THEME_NEXT[theme] })}
              aria-label={`${THEME_LABEL[theme]}. Switch theme`}
            >
              {theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}
            </button>
          </nav>
        </div>
      </header>
      <Suspense
        fallback={
          <main id="main" className="page">
            <p className="muted">Loading the page…</p>
          </main>
        }
      >
        {page}
      </Suspense>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <span>
            Hidden Value: an explainable market-making card game. Runs entirely in your browser; no accounts,
            no real money.
          </span>
          <a href={REPO_URL}>Source on GitHub</a>
        </div>
      </footer>
    </>
  );
}
