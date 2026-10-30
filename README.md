# Binary Heist: Case 0101 - Backend

Node.js + Express + libSQL/Turso, deployable on Vercel, ESP32 over WiFi.

## Run
```bash
npm install
npm start                  # http://localhost:3000
npm test                   # full-game smoke test (server on :3999, see test/smoke.js)
```
Put the exported Stitch HTML files in `public/` and include `/js/heist-api.js`.

Env vars: `PORT`, `DB_PATH` (local file DB, default `./heist.db`), `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `HW_KEY`.
Default cases and achievements are inserted automatically from `seed.sql` on every start, so a new/empty database works out of the box.
Versus mode is peer-to-peer (PeerJS, see `public/js/versus.js`); the server has no versus routes.

## Game flow (5 stages)
1 Binary decode -> 2 Logic lock -> 3 Truth table -> 4 Boss adder -> 5 Final code (XOR/XNOR mask on the 4 revealed bits).
Puzzles are randomised per session and difficulty (easy decimal, medium hex, hard Gray code / full adder).
Answers stay server-side. The timer is server-authoritative; hints cost 30 s; wrong answers cost a life and 50 points.

## API
| Method | Route | Purpose |
|---|---|---|
| POST | /api/login `{agent_name, rfid_uid?}` | Login or register (RFID tap supported) |
| GET | /api/players/:id | Profile, rank, XP |
| GET | /api/cases, /api/cases/daily | Case list, daily case |
| POST | /api/sessions `{player_id, case_id, mode}` | Start a game (mode: solo or hardware) |
| GET | /api/sessions/:id | Current state (timer, lives, puzzle, bits) |
| POST | /api/sessions/:id/answer `{answer}` | Submit bits (e.g. "1011") or gate name (e.g. "XOR") |
| POST | /api/sessions/:id/hint | Reveal hint, -30 s |
| POST | /api/sessions/:id/abandon | Quit |
| GET | /api/sessions/:id/log | Replay log |
| GET | /api/leaderboard?period=today/week/all&case_id= | Most Wanted board |
| GET | /api/players/:id/analytics | Radar data, weakest concept, history, achievements |
| POST | /api/hardware/event | ESP32 over WiFi (header `x-hardware-key` if HW_KEY set) |
| GET | /api/hardware/state | Latest hardware state |
| GET | /api/hardware/command | ESP32 polls for the target code / start params (needs `x-hardware-key`) |

## Hardware mode
Start a session with `mode: "hardware"`. The ESP32 sends JSON lines like
`{"state":"S6","lives":2,"bits":"1011","cmp":1}`. When the physical FSM reaches S6 with the comparator high, the backend records a win; S7 records a loss.
The box loads the target code by polling `GET /api/hardware/command`.

## Deploy on Vercel (Turso database)
The app runs as one serverless function (`api/index.js` -> `server.js`) and `public/` is served by Vercel's CDN.
SQLite is replaced by Turso (hosted libSQL, same SQL). Locally it still uses a `heist.db` file, no setup needed.

1. Create a database in the Turso dashboard (or CLI: `turso db create binary-heist`), then get its URL and an auth token
   (`turso db show binary-heist --url`, `turso db tokens create binary-heist`).
2. Push this folder to GitHub and import it in Vercel (Framework preset: Other, no build command).
3. Add environment variables in Vercel: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `HW_KEY`.
4. Deploy. Tables and seed data are created automatically on the first API call.

Changes from the old version: no WebSocket (the evidence board polls `/api/hardware/state`), no USB serial bridge.
The ESP32 now talks over WiFi only: POST telemetry to `/api/hardware/event` and poll `GET /api/hardware/command`
(returns `{active, code, start_secs, lives}` for a hardware-mode session). Both need the `x-hardware-key` header.
