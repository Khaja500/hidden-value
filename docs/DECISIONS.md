# Decisions

Non-obvious choices made while building Hidden Value, with the reason for each.

## Tooling

- **TypeScript 6.0.3**, not 7.x: `typescript-eslint` 8.72 supports TypeScript `<6.1.0` only.
- **Node 24 in CI** (current LTS); local development used Node 26.
- **Hash routing without a router library**: eight routes do not need react-router; a 30-line hook keeps the bundle small and refreshes work on GitHub Pages.
- **Fonts are bundled with `@fontsource`** rather than loaded from a CDN, so the site works offline and makes no third-party requests.
