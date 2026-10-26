# Accounts and online play

The game still runs entirely in the browser. Two optional features use Google Cloud, in the project
**`hidden-value-online-xri7`** ("Hidden Value Online", owned by khaja.aflal@gmail.com):

- **Accounts and history.** Players sign up with an email and password (Firebase Authentication). Every finished
  game is saved to `users/{uid}/games` in Firestore, so the Account page shows it on any device, and Review can open
  a solo game from there even after this browser has forgotten it.
- **Online tables.** 2–4 friends play one multiplayer game, each on their own device. Players join by a 6-letter
  code or an invite link.

## How online play stays fair

In one-screen multiplayer the browser deals the cards. Online, a browser that dealt could read everyone's card,
so the deal lives only on the **game server** (`server/`, on Cloud Run):

| Document                    | Who can read it           | What is in it                                                     |
| --------------------------- | ------------------------- | ----------------------------------------------------------------- |
| `rooms/{code}`              | the players at that table | the public view (packed), public accounts, actions, results       |
| `rooms/{code}/seats/{uid}`  | that player only          | their card                                                        |
| `rooms/{code}/private/deal` | nobody (server only)      | the game config, including the seed                               |
| `users/{uid}/games/{id}`    | that player only          | history; solo games written by the browser, online ones by server |

Browsers never write game state. They call the server (`create`, `join`, `leave`, `start`, `act`, `timeout`) with
their Firebase ID token. The server rebuilds the game from the config and the action list on every call (under
100 ms), applies one move in a Firestore transaction, and publishes the result. The room listener updates every
player's screen. A move carries the event count the player saw, so a double tap or a stale click is rejected.
If a player stops responding, anyone at the table can pass for them after 60 s.

The rules are in [`firestore.rules`](../firestore.rules). The room transitions are pure functions in
[`src/online/rooms.ts`](../src/online/rooms.ts), tested in `tests/online.test.ts`. Those tests check that the room
document is exactly the engine's public view (no seed, deal or hidden card) and that an online game matches the
one-screen engine move for move.

## Staying inside the free tier

| Service                   | Free allowance                                         | This app's use                                       |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Firebase Auth (email)     | free                                                   | sign-up, sign-in, verification and reset emails      |
| Firestore                 | 50k reads, 20k writes per day; 1 GiB; 10 GiB/month out | one room write per move; each player reads it once   |
| Cloud Run (`game-server`) | 2M requests, 180k vCPU-s per month                     | one request per move; scales to zero; max 1 instance |
| Artifact Registry         | 0.5 GB                                                 | cleanup policy keeps only the latest image (~150 MB) |
| Pub/Sub, Cloud Functions  | free tiers                                             | a few budget messages a day                          |

A 4-player game is 128 moves: about 130 writes and 520 reads, so the daily read quota covers roughly 90
four-player games a day. Rooms, deals and seats carry an `expireAt` field, and a Firestore TTL policy deletes them
7 days after a table goes quiet.

**The shut-off.** A budget on the billing account, filtered to this project, publishes the month's cost (after
free-tier usage and credits) to the Pub/Sub topic `billing-alerts` several times a day. The function
`billing-guard` ([`infra/billing-guard`](../infra/billing-guard/index.js)) **disconnects the project from billing
as soon as that cost is above ₹0**. After that, Cloud Run stops (online play is off) until billing is reconnected
in the console. Sign-in and Firestore's free quota keep working. Google reports costs with a delay of hours, so
in a sudden flood a few rupees could be charged before the shut-off; the 1-instance cap keeps that small.

## Deploying changes

```bash
P=hidden-value-online-xri7

# Game server (after changing server/ or src/online/rooms.ts, history.ts, codec.ts, or the engine)
npm run build:server
gcloud run deploy game-server --source server --region us-central1 --project $P \
  --service-account game-server@$P.iam.gserviceaccount.com \
  --max-instances 1 --min-instances 0 --cpu 1 --memory 512Mi --concurrency 20 --timeout 30 \
  --set-env-vars "^@^PROJECT_ID=$P@ALLOWED_ORIGINS=https://khaja500.github.io,http://localhost:5173,http://localhost:4173"

# Security rules (after changing firestore.rules): with the Firebase CLI
npx firebase-tools deploy --only firestore:rules --project $P
```

The Firebase web config and the server URL are in [`src/online/config.ts`](../src/online/config.ts). The web
config is public by design. Its API key only works from the site, `localhost` and the project's own auth pages
(an HTTP-referrer restriction on the key), and data access is governed by the rules above.

Signing in works from `khaja500.github.io` and `localhost` (Authentication → Settings → Authorized domains). To
serve the site from another domain, add it there, to the API key's allowed referrers, and to the server's
`ALLOWED_ORIGINS`.
