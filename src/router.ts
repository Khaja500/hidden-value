/** Hash routing (#/play, #/review/abc) so page refreshes work on GitHub Pages. */
import { useEffect, useState } from 'react';

export interface Route {
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

const PATTERNS: { pattern: string; name: string }[] = [
  { pattern: '/', name: 'home' },
  { pattern: '/play', name: 'play' },
  { pattern: '/multiplayer', name: 'party' },
  { pattern: '/tutorial', name: 'tutorial' },
  { pattern: '/review/:gameId', name: 'review' },
  { pattern: '/review', name: 'reviewList' },
  { pattern: '/daily', name: 'daily' },
  { pattern: '/research', name: 'research' },
  { pattern: '/sandbox', name: 'sandbox' },
  { pattern: '/about', name: 'about' },
];

export function parseHash(hash: string): Route & { name: string } {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const segs = path.split('/').filter(Boolean);
  for (const { pattern, name } of PATTERNS) {
    const pSegs = pattern.split('/').filter(Boolean);
    if (pSegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    pSegs.forEach((p, i) => {
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
      else if (p !== segs[i]) ok = false;
    });
    if (ok) return { name, path, params, query: new URLSearchParams(queryPart) };
  }
  return { name: 'notFound', path, params: {}, query: new URLSearchParams(queryPart) };
}

export function useRoute() {
  const [hash, setHash] = useState(() => (typeof window === 'undefined' ? '' : window.location.hash));
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parseHash(hash);
}

export function navigate(to: string): void {
  window.location.hash = to.startsWith('#') ? to : `#${to}`;
}

export function href(to: string): string {
  return `#${to}`;
}
