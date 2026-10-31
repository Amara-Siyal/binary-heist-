const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { generate } = require('./puzzles');

const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const HW_KEY = process.env.HW_KEY || ''; // shared secret for the ESP32 WiFi endpoints
const TOTAL_STAGES = 5;
const HINT_COST_SEC = 30;
const WRONG_PENALTY = 50;
const HW_ONLINE_MS = 8000; // hardware counts as connected if it reported within this window

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // local dev only; on Vercel public/ is served by the CDN

// Express 4 does not catch rejected promises, so wrap every async handler
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// make sure tables exist before the first API call on a fresh instance/database
app.use('/api', (_req, _res, next) => db.init().then(() => next(), next));

// ---------- helpers ----------
const RANKS = [[5000, 'Chief Detective'], [2000, 'Inspector'], [0, 'Rookie']];
const rankFor = (xp) => RANKS.find(([min]) => xp >= min)[1];
const elapsed = (s) => Math.floor((Date.now() - s.started_ms) / 1000);
const timeLeft = (s) => Math.max(0, s.time_limit_sec - elapsed(s) - s.hint_penalty_sec);

function checkAnswer(row, given) {
  // exact match: "11" is NOT accepted for "0011" (answers are fixed-width bit strings or a gate name)
  return given === row.correct_answer;
}

const collectedBits = (d, sessionId) =>
  d.all(`SELECT stage_no, reveal_bit AS bit FROM session_puzzles
         WHERE session_id=? AND solved=1 AND stage_no<5 ORDER BY stage_no`, [sessionId]);

async function publicPuzzle(s) {
  const row = await db.get('SELECT * FROM session_puzzles WHERE session_id=? AND stage_no=?', [s.session_id, s.current_stage]);
  if (!row) return null;
  const raw = (await collectedBits(db, s.session_id)).map((b) => b.bit).join('');
  return {
    stage_no: row.stage_no,
    puzzle_type: row.puzzle_type,
    concept: row.concept,
    input_mode: row.input_mode, // bits4 | bits1 | bits2 | gate
    is_boss: row.puzzle_type === 'boss_adder',
    question: row.question.replace('{RAW}', raw),
    data: JSON.parse(row.payload_json),
    hint_used: !!row.hint_used,
    hint_cost_sec: HINT_COST_SEC,
  };
}

async function snapshot(s) {
  return {
    session_id: s.session_id,
    status: s.result,
    mode: s.mode,
    stage: Math.min(s.current_stage, TOTAL_STAGES),
    total_stages: TOTAL_STAGES,
    fsm_state: s.result === 'win' ? 'S6' : s.result === 'lose' ? 'S7' : `S${Math.min(s.current_stage, 5)}`,
    lives_left: s.lives_left,
    max_lives: s.max_lives,
    score: s.score,
    time_left: s.result === 'active' ? timeLeft(s) : 0,
    bits_collected: await collectedBits(db, s.session_id),
    puzzle: s.result === 'active' ? await publicPuzzle(s) : null,
  };
}

async function summaryFor(s) {
  const answers = await db.all(`
    SELECT sp.stage_no, sp.concept, sp.puzzle_type, sp.correct_answer, sp.explanation,
      (SELECT player_answer FROM attempts a WHERE a.sp_id=sp.sp_id ORDER BY attempt_id DESC LIMIT 1) AS your_answer
    FROM session_puzzles sp WHERE sp.session_id=? ORDER BY sp.stage_no`, [s.session_id]);
  const concepts = await db.all(`
    SELECT sp.concept, COUNT(*) attempts, SUM(a.is_correct) correct,
           ROUND(100.0*SUM(a.is_correct)/COUNT(*),1) accuracy
    FROM attempts a JOIN session_puzzles sp ON sp.sp_id=a.sp_id
    WHERE a.session_id=? GROUP BY sp.concept ORDER BY accuracy ASC`, [s.session_id]);
  const p = await db.get('SELECT agent_name, rank_title, total_xp FROM players WHERE player_id=?', [s.player_id]);
  return {
    result: s.result, reason: s.end_reason, score: s.score, xp_earned: s.xp_earned,
    time_taken_sec: s.time_taken_sec, lives_left: s.lives_left,
    agent: p, achievements: JSON.parse(s.achievements_json), answers, concepts,
  };
}

// `d` is a db helper object (the pool or an open transaction)
async function awardAchievements(d, s, taken) {
  const codes = [];
  const wins = (await d.get(`SELECT COUNT(*) c FROM game_sessions WHERE player_id=? AND result='win'`, [s.player_id])).c;
  if (wins === 1) codes.push('FIRST_CASE');
  if (s.lives_left === s.max_lives) codes.push('NO_LIVES_LOST');
  if (taken < 120) codes.push('SPEED_CRACKER');
  if (s.hint_penalty_sec === 0) codes.push('NO_HINTS');
  const xor = await d.get(`SELECT COUNT(*) total, COALESCE(SUM(a.is_correct=0),0) wrong
                 FROM attempts a JOIN session_puzzles sp ON sp.sp_id=a.sp_id
                 WHERE a.session_id=? AND sp.concept='XOR'`, [s.session_id]);
  if (xor.total > 0 && xor.wrong === 0) codes.push('XOR_MASTER');
  const boss = (await d.get(`SELECT COUNT(*) n FROM attempts a JOIN session_puzzles sp ON sp.sp_id=a.sp_id
                  WHERE a.session_id=? AND sp.stage_no=4`, [s.session_id])).n;
  if (boss === 1) codes.push('BOSS_SLAYER');

  const earned = [];
  for (const code of codes) {
    const a = await d.get('SELECT * FROM achievements WHERE code=?', [code]);
    const r = await d.run('INSERT OR IGNORE INTO player_achievements (player_id, achievement_id) VALUES (?,?)', [s.player_id, a.achievement_id]);
    if (r.changes === 1) earned.push({ code: a.code, name: a.name, description: a.description, xp_reward: a.xp_reward });
  }
  return earned;
}

// Ends a session. Must run inside a transaction: pass the tx helper as `d`.
async function finishIn(d, sess, result, reason) {
  const s = await d.get('SELECT * FROM game_sessions WHERE session_id=?', [sess.session_id]);
  if (s.result !== 'active') return;
  const taken = Math.min(s.time_limit_sec, elapsed(s));
  let score = s.score;
  if (result === 'win') score += s.lives_left * 200 + timeLeft(s) * 2;
  let xp = result === 'win' ? Math.floor(score / 2) + 100 : result === 'lose' ? Math.floor(score / 10) : 0;

  await d.run(`UPDATE game_sessions SET result=?, end_reason=?, ended_at=datetime('now'),
     time_taken_sec=?, score=? WHERE session_id=?`, [result, reason || null, taken, score, s.session_id]);

  let earned = [];
  if (result === 'win') {
    const fresh = await d.get('SELECT * FROM game_sessions WHERE session_id=?', [s.session_id]);
    earned = await awardAchievements(d, fresh, taken);
    xp += earned.reduce((n, a) => n + a.xp_reward, 0);
  }
  const p = await d.get('SELECT total_xp FROM players WHERE player_id=?', [s.player_id]);
  const newXp = p.total_xp + xp;
  await d.run('UPDATE players SET total_xp=?, rank_title=? WHERE player_id=?', [newXp, rankFor(newXp), s.player_id]);
  await d.run('UPDATE game_sessions SET xp_earned=?, achievements_json=? WHERE session_id=?',
    [xp, JSON.stringify(earned), s.session_id]);
}
const finish = (sess, result, reason) => db.transaction((d) => finishIn(d, sess, result, reason));

// loads a session and auto-expires it if the countdown has hit zero
async function loadSession(id) {
  let s = await db.get('SELECT * FROM game_sessions WHERE session_id=?', [id]);
  if (s && s.result === 'active' && timeLeft(s) <= 0) {
    await finish(s, 'lose', 'time_expired');
    s = await db.get('SELECT * FROM game_sessions WHERE session_id=?', [id]);
  }
  return s;
}

// ---------- hardware (ESP32 over WiFi; state lives in the DB because serverless has no shared memory) ----------
function hwAuth(req, res) {
  // In production the WiFi endpoints are only enabled when HW_KEY is set (otherwise anyone could fake a win).
  if (IS_PROD && !HW_KEY) { res.status(403).json({ error: 'hardware endpoint disabled: set HW_KEY' }); return false; }
  if (HW_KEY && req.get('x-hardware-key') !== HW_KEY) { res.status(401).json({ error: 'bad key' }); return false; }
  return true;
}

async function handleHardware(evt) {
  if (evt.ack) return; // acknowledgements from the box, not telemetry
  const state = {
    fsm_state: evt.fsm_state ?? evt.state ?? null,
    lives: evt.lives ?? null,
    timer_sec: evt.timer_sec ?? evt.timer ?? null,
    code_bits: evt.code_bits ?? evt.bits ?? null,
    comparator: evt.comparator ?? evt.cmp ?? null,
  };
  const active = await db.get(`SELECT * FROM game_sessions WHERE result='active' ORDER BY session_id DESC LIMIT 1`);
  await db.run(`INSERT INTO hardware_events (session_id, fsm_state, lives, timer_sec, code_bits, comparator, raw_json)
     VALUES (?,?,?,?,?,?,?)`, [active ? active.session_id : null, state.fsm_state, state.lives, state.timer_sec,
       state.code_bits === null ? null : String(state.code_bits), state.comparator, JSON.stringify(evt)]);
  // keep only the newest ~2000 telemetry rows (the box sends a heartbeat every second); cheap, runs ~1 in 100
  if (Math.random() < 0.01) {
    await db.run('DELETE FROM hardware_events WHERE event_id <= (SELECT MAX(event_id) - 2000 FROM hardware_events)');
  }

  // In hardware mode the physical FSM decides the outcome
  if (active && active.mode === 'hardware') {
    if (state.fsm_state === 'S6' && Number(state.comparator) === 1) await finish(active, 'win', 'vault_opened');
    else if (state.fsm_state === 'S7') await finish(active, 'lose', 'hardware_lockdown');
  }
}

app.post('/api/hardware/event', ah(async (req, res) => {
  if (!hwAuth(req, res)) return;
  await handleHardware(req.body || {});
  res.json({ ok: true });
}));

app.get('/api/hardware/state', ah(async (_req, res) => {
  const r = await db.get(`SELECT session_id, fsm_state, lives, timer_sec, code_bits, comparator,
                                 CAST(strftime('%s', received_at) AS INTEGER) * 1000 AS ts
                          FROM hardware_events ORDER BY event_id DESC LIMIT 1`);
  if (!r) return res.json({ connected: false, serial: false });
  res.json({ ...r, connected: Date.now() - r.ts < HW_ONLINE_MS, serial: false });
}));

// Replaces the old USB-serial "CODE:/START:" push. The ESP32 polls this to load the target code.
app.get('/api/hardware/command', ah(async (req, res) => {
  if (!hwAuth(req, res)) return;
  const s = await db.get(`SELECT g.session_id, g.time_limit_sec, g.max_lives FROM game_sessions g
                          WHERE g.result='active' AND g.mode='hardware' ORDER BY g.session_id DESC LIMIT 1`);
  if (!s) return res.json({ active: false });
  const f = await db.get('SELECT correct_answer FROM session_puzzles WHERE session_id=? AND stage_no=?', [s.session_id, TOTAL_STAGES]);
  res.json({ active: true, session_id: s.session_id, code: f.correct_answer, start_secs: s.time_limit_sec, lives: s.max_lives });
}));

// ---------- auth / players ----------
async function playerProfile(id) {
  const p = await db.get('SELECT player_id, agent_name, display_name, rank_title, total_xp, created_at FROM players WHERE player_id=?', [id]);
  if (!p) return null;
  const next = [...RANKS].reverse().find(([min]) => min > p.total_xp);
  const solved = (await db.get(`SELECT COUNT(*) c FROM game_sessions WHERE player_id=? AND result='win'`, [id])).c;
  return { ...p, next_rank_xp: next ? next[0] : null, cases_solved: solved };
}

// ---------- auth tokens (stateless HMAC-signed, so they work on serverless) ----------
const AUTH_SECRET = process.env.AUTH_SECRET || (IS_PROD ? '' : crypto.randomBytes(32).toString('hex'));
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;
const hmac = (body) => crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
const signToken = (pid) => { const body = Buffer.from(JSON.stringify({ pid, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url'); return body + '.' + hmac(body); };
function auth(req, res, next) {
  if (!AUTH_SECRET) return res.status(500).json({ error: 'server misconfigured: set AUTH_SECRET' });
  const [body, sig] = (req.get('authorization') || '').replace(/^Bearer /i, '').split('.');
  if (!body || !sig) return res.status(401).json({ error: 'Login required' });
  const good = Buffer.from(hmac(body)), got = Buffer.from(sig);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return res.status(401).json({ error: 'Invalid session. Please log in again.' });
  let t; try { t = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return res.status(401).json({ error: 'Invalid session' }); }
  if (!t.pid || t.exp < Date.now()) return res.status(401).json({ error: 'Session expired. Please log in again.' });
  req.pid = t.pid;
  next();
}
const self = (req, res, next) => (Number(req.params.id) === req.pid ? next() : res.status(403).json({ error: 'forbidden' }));

const scrypt = require('util').promisify(crypto.scrypt); // async, so hashing does not block other requests
const hashPw = async (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + (await scrypt(pw, salt, 32)).toString('hex'); };
const checkPw = async (pw, h) => { const [salt, hex] = h.split(':'); const a = Buffer.from(hex, 'hex'), b = await scrypt(pw, salt, 32); return a.length === b.length && crypto.timingSafeEqual(a, b); };

// Brute-force guard: max 8 failed logins per Agent ID per 10 minutes.
// In-memory, so on serverless it is per instance (slows guessing; use a DB table or Vercel KV for a hard limit).
const FAILS = new Map();
const FAIL_MAX = 8, FAIL_WINDOW_MS = 10 * 60 * 1000;
const lockedOut = (k) => { const f = FAILS.get(k); return !!f && Date.now() - f.t < FAIL_WINDOW_MS && f.n >= FAIL_MAX; };
const noteFail = (k) => { const f = FAILS.get(k); FAILS.set(k, f && Date.now() - f.t < FAIL_WINDOW_MS ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() }); };

app.post('/api/login', ah(async (req, res) => {
  const { agent_name, password, display_name, register } = req.body || {};
  const name = String(agent_name || '').trim().replace(/_+$/, '');
  if (!/^[A-Za-z0-9_]{3,40}$/.test(name)) return res.status(400).json({ error: 'Agent ID must be 3-40 letters, digits or underscores' });
  const pw = password ? String(password) : '';
  if (!pw) return res.status(400).json({ error: 'Password required' });
  if (pw.length > 200) return res.status(400).json({ error: 'Password too long' });
  const key = name.toLowerCase();
  if (lockedOut(key)) return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });

  let p = await db.get('SELECT * FROM players WHERE agent_name=?', [name]);
  if (register) {
    if (p) return res.status(409).json({ error: 'That Agent ID is already taken' });
    if (pw.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const dn = String(display_name || '').trim().slice(0, 40) || null;
    const r = await db.run('INSERT INTO players (agent_name, display_name, password_hash) VALUES (?,?,?)', [name, dn, await hashPw(pw)]);
    p = await db.get('SELECT * FROM players WHERE player_id=?', [r.lastInsertRowid]);
  } else {
    // same message for "no such agent" and "wrong password" so Agent IDs cannot be probed;
    // accounts without a password (old versions) can no longer be claimed by whoever logs in first
    if (!p || !p.password_hash || !(await checkPw(pw, p.password_hash))) {
      noteFail(key);
      return res.status(401).json({ error: 'Access denied. Invalid Agent ID or password.' });
    }
    FAILS.delete(key);
  }
  res.json({ ...(await playerProfile(p.player_id)), token: signToken(p.player_id) });
}));

app.get('/api/players/:id', auth, self, ah(async (req, res) => {
  const p = await playerProfile(+req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'not found' });
}));

// ---------- cases ----------
app.get('/api/cases', ah(async (_req, res) => res.json(await db.all('SELECT * FROM cases ORDER BY case_id'))));
app.get('/api/cases/daily', ah(async (_req, res) => {
  const all = await db.all('SELECT * FROM cases ORDER BY case_id');
  const day = Math.floor(Date.now() / 86400000);
  res.json(all[day % all.length]);
}));

// ---------- sessions ----------
// every /api/sessions/:id/* route requires the session to belong to the logged-in player
app.use('/api/sessions/:id', auth, ah(async (req, res, next) => {
  const s = await db.get('SELECT player_id FROM game_sessions WHERE session_id=?', [Number(req.params.id)]);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (s.player_id !== req.pid) return res.status(403).json({ error: 'forbidden' });
  next();
}));
app.post('/api/sessions', auth, ah(async (req, res) => {
  const { case_id, mode = 'solo' } = req.body || {};
  const player_id = req.pid;
  const player = await db.get('SELECT * FROM players WHERE player_id=?', [player_id]);
  const c = await db.get('SELECT * FROM cases WHERE case_id=?', [case_id]);
  if (!player || !c) return res.status(404).json({ error: 'player or case not found' });
  if (!['solo', 'hardware'].includes(mode) || (mode === 'hardware' && !HW_KEY)) return res.status(400).json({ error: 'bad mode' });

  const puzzles = generate(c.difficulty);
  const id = await db.transaction(async (d) => {
    await d.run(`UPDATE game_sessions SET result='abandoned', end_reason='new_session', ended_at=datetime('now')
       WHERE player_id=? AND result='active'`, [player_id]);
    const r = await d.run(`INSERT INTO game_sessions (player_id, case_id, mode, started_ms, time_limit_sec, max_lives, lives_left)
                 VALUES (?,?,?,?,?,?,?)`, [player_id, case_id, mode, Date.now(), c.time_limit_sec, c.lives, c.lives]);
    for (const p of puzzles) {
      await d.run(`INSERT INTO session_puzzles
        (session_id, stage_no, puzzle_type, concept, input_mode, question, correct_answer, hint, explanation, payload_json, reveal_bit)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [r.lastInsertRowid, p.stage_no, p.puzzle_type, p.concept, p.input_mode, p.question, p.answer,
         p.hint, p.explanation, JSON.stringify(p.payload || {}), p.reveal_bit]);
    }
    return r.lastInsertRowid;
  });

  const s = await loadSession(id);
  res.status(201).json({ ...(await snapshot(s)), case: c });
}));

app.get('/api/sessions/:id', ah(async (req, res) => {
  const s = await loadSession(+req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json({ ...(await snapshot(s)), summary: s.result !== 'active' ? await summaryFor(s) : undefined });
}));

app.post('/api/sessions/:id/answer', ah(async (req, res) => {
  const s = await loadSession(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Session not found' });
  if (s.result !== 'active') {
    return res.status(409).json({ error: 'Session finished', ...(await snapshot(s)), summary: await summaryFor(s) });
  }

  const given = String((req.body || {}).answer ?? '').trim().toUpperCase();
  if (!given) return res.status(400).json({ error: 'Answer required' });

  const row = await db.get('SELECT * FROM session_puzzles WHERE session_id=? AND stage_no=?', [s.session_id, s.current_stage]);
  if (!row) return res.status(500).json({ error: `Puzzle not found for stage ${s.current_stage}` });

  const ok = checkAnswer(row, given);

  let stale = false;
  await db.transaction(async (d) => {
    // Re-read inside the write transaction: a second request that raced this one will now see the new stage and is rejected,
    // so a stage can never be solved (or a life lost) twice by one click.
    const cur = await d.get('SELECT * FROM game_sessions WHERE session_id=?', [s.session_id]);
    if (cur.result !== 'active' || cur.current_stage !== row.stage_no) { stale = true; return; }
    if (!ok) {
      // A late duplicate of the answer that was JUST accepted for the previous stage (double-click / retry)
      // must not be charged as a wrong answer for the new stage.
      const last = await d.get(`SELECT a.player_answer, a.is_correct, sp.stage_no,
          (CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', a.attempted_at) AS INTEGER)) AS age
        FROM attempts a JOIN session_puzzles sp ON sp.sp_id=a.sp_id
        WHERE a.session_id=? ORDER BY a.attempt_id DESC LIMIT 1`, [s.session_id]);
      if (last && last.is_correct === 1 && last.stage_no === row.stage_no - 1 && last.player_answer === given && last.age <= 3) { stale = true; return; }
    }

    await d.run(`INSERT INTO attempts (session_id, sp_id, player_answer, is_correct, hint_used)
      VALUES (?, ?, ?, ?, ?)`, [s.session_id, row.sp_id, given, ok ? 1 : 0, row.hint_used]);

    if (ok) {
      await d.run('UPDATE session_puzzles SET solved=1 WHERE sp_id=?', [row.sp_id]);
      const bonus = Math.floor(100 * timeLeft(cur) / cur.time_limit_sec);
      const gain = (row.puzzle_type === 'boss_adder' ? 500 : 250) + bonus;
      await d.run(`UPDATE game_sessions SET score=score+?, current_stage=current_stage+1 WHERE session_id=?`,
        [gain, s.session_id]);
      if (cur.current_stage >= TOTAL_STAGES) {
        const updated = await d.get('SELECT * FROM game_sessions WHERE session_id=?', [s.session_id]);
        await finishIn(d, updated, 'win', 'vault_opened');
      }
    } else {
      await d.run(`UPDATE game_sessions SET lives_left=lives_left-1, score=MAX(0, score-?) WHERE session_id=?`,
        [WRONG_PENALTY, s.session_id]);
      const updated = await d.get('SELECT * FROM game_sessions WHERE session_id=?', [s.session_id]);
      if (updated.lives_left <= 0) await finishIn(d, updated, 'lose', 'out_of_lives');
    }
  });

  if (stale) {
    const now = await loadSession(s.session_id);
    return res.status(409).json({ error: 'That stage was already answered.', ...(await snapshot(now)),
      summary: now.result !== 'active' ? await summaryFor(now) : undefined });
  }

  const fresh = await loadSession(s.session_id);
  res.json({
    correct: ok,
    explanation: ok ? row.explanation : undefined,
    revealed_bit: ok && row.stage_no < TOTAL_STAGES ? row.reveal_bit : undefined,
    gain_popup: ok ? fresh.score - s.score : undefined,
    ...(await snapshot(fresh)),
    summary: fresh.result !== 'active' ? await summaryFor(fresh) : undefined,
  });
}));

app.post('/api/sessions/:id/hint', ah(async (req, res) => {
  const s = await loadSession(+req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (s.result !== 'active') return res.status(409).json({ error: 'session finished' });
  const row = await db.get('SELECT * FROM session_puzzles WHERE session_id=? AND stage_no=?', [s.session_id, s.current_stage]);
  if (!row) return res.status(404).json({ error: 'puzzle not found' });
  let charged = false;
  if (!row.hint_used) {
    await db.transaction(async (d) => {
      const r = await d.run('UPDATE session_puzzles SET hint_used=1 WHERE sp_id=? AND hint_used=0', [row.sp_id]);
      if (r.changes === 1) { // only the first request flips the flag, so only it pays the penalty
        charged = true;
        await d.run('UPDATE game_sessions SET hint_penalty_sec=hint_penalty_sec+? WHERE session_id=?', [HINT_COST_SEC, s.session_id]);
      }
    });
  }
  const fresh = await loadSession(s.session_id);
  res.json({ hint: row.hint, cost_sec: charged ? HINT_COST_SEC : 0, ...(await snapshot(fresh)),
             summary: fresh.result !== 'active' ? await summaryFor(fresh) : undefined });
}));

app.post('/api/sessions/:id/abandon', ah(async (req, res) => {
  const s = await loadSession(+req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (s.result === 'active') await finish(s, 'abandoned', 'player_quit');
  res.json(await summaryFor(await db.get('SELECT * FROM game_sessions WHERE session_id=?', [s.session_id])));
}));

// Session replay log from the attempts table
app.get('/api/sessions/:id/log', ah(async (req, res) => {
  res.json(await db.all(`SELECT sp.stage_no, sp.concept, a.player_answer, a.is_correct, a.hint_used, a.attempted_at
              FROM attempts a JOIN session_puzzles sp ON sp.sp_id=a.sp_id
              WHERE a.session_id=? ORDER BY a.attempt_id`, [+req.params.id]));
}));

app.get('/api/sessions/:id/report', ah(async (req, res) => {
  const id = Number(req.params.id);
  const s = await loadSession(id);
  if (!s) return res.status(404).json({ error: 'Session not found' });

  const puzzles = (await db.all(`
    SELECT stage_no, concept, puzzle_type, input_mode, question, correct_answer, explanation, solved, payload_json
    FROM session_puzzles WHERE session_id=? ORDER BY stage_no`, [id]))
    .map((p) => ({ ...p, payload: JSON.parse(p.payload_json || '{}') }));

  const attempts = await db.all(`
    SELECT sp.stage_no, sp.concept, sp.puzzle_type, a.player_answer, a.is_correct, a.hint_used, a.attempted_at
    FROM attempts a JOIN session_puzzles sp ON sp.sp_id=a.sp_id
    WHERE a.session_id=? ORDER BY a.attempt_id`, [id]);

  const concepts = await db.all(`
    SELECT sp.concept, COUNT(*) AS attempts, SUM(a.is_correct) AS correct,
           SUM(CASE WHEN a.is_correct=0 THEN 1 ELSE 0 END) AS wrong,
           ROUND(100.0 * SUM(a.is_correct) / COUNT(*), 1) AS accuracy
    FROM attempts a JOIN session_puzzles sp ON sp.sp_id=a.sp_id
    WHERE a.session_id=? GROUP BY sp.concept`, [id]);

  res.json({
    session: await snapshot(s),
    summary: s.result !== 'active' ? await summaryFor(s) : null,
    puzzles, attempts, concepts,
  });
}));

// ---------- leaderboard / analytics ----------
app.get('/api/leaderboard', ah(async (req, res) => {
  const { period = 'all', case_id } = req.query;
  const where = [`s.result='win'`];
  const args = [];
  if (period === 'today') where.push(`date(s.ended_at)=date('now')`);
  if (period === 'week') where.push(`date(s.ended_at)>=date('now','-7 days')`);
  if (case_id) { where.push('s.case_id=?'); args.push(+case_id); }
  const rows = await db.all(`
    SELECT p.player_id, p.agent_name, p.display_name, p.rank_title,
           MAX(s.score) AS best_score, MIN(s.time_taken_sec) AS best_time, COUNT(*) AS wins
    FROM game_sessions s JOIN players p ON p.player_id=s.player_id
    WHERE ${where.join(' AND ')}
    GROUP BY p.player_id ORDER BY best_score DESC, best_time ASC LIMIT 10`, args);
  res.json(rows.map((r, i) => ({ position: i + 1, ...r })));
}));

app.get('/api/players/:id/analytics', auth, self, ah(async (req, res) => {
  const id = +req.params.id;
  const concepts = await db.all(`
    SELECT sp.concept, COUNT(*) attempts, SUM(a.is_correct) correct,
           ROUND(100.0*SUM(a.is_correct)/COUNT(*),1) accuracy
    FROM attempts a JOIN session_puzzles sp ON sp.sp_id=a.sp_id
    JOIN game_sessions s ON s.session_id=a.session_id
    WHERE s.player_id=? GROUP BY sp.concept ORDER BY accuracy ASC`, [id]);
  const history = (await db.all(`SELECT session_id, case_id, score, result, time_taken_sec, ended_at
                     FROM game_sessions WHERE player_id=? AND result!='active'
                     ORDER BY session_id DESC LIMIT 20`, [id])).reverse();
  const hardest = await db.all(`
    SELECT sp.puzzle_type, sp.concept, COUNT(*) attempts,
           ROUND(100.0*SUM(a.is_correct)/COUNT(*),1) accuracy
    FROM attempts a JOIN session_puzzles sp ON sp.sp_id=a.sp_id
    GROUP BY sp.puzzle_type, sp.concept HAVING COUNT(*)>=3 ORDER BY accuracy ASC LIMIT 5`);
  const achievements = await db.all(`
    SELECT a.code, a.name, a.description, a.xp_reward, pa.earned_at,
           CASE WHEN pa.player_id IS NULL THEN 0 ELSE 1 END AS unlocked
    FROM achievements a LEFT JOIN player_achievements pa
      ON pa.achievement_id=a.achievement_id AND pa.player_id=?`, [id]);
  res.json({
    profile: await playerProfile(id), concepts,
    weakest_concept: concepts[0] || null,
    score_history: history, hardest_puzzles: hardest, achievements,
  });
}));

// ---------- versus: async head-to-head race on the same case (real sessions) ----------
async function matchView(code) {
  const m = await db.get('SELECT * FROM matches WHERE code=?', [code]);
  if (!m) return null;
  const side = async (pid, sid) => {
    if (!pid) return null;
    const p = await db.get('SELECT agent_name, display_name FROM players WHERE player_id=?', [pid]);
    if (sid) await loadSession(sid); // auto-finishes the run if its countdown already hit zero
    const s = sid ? await db.get('SELECT result, score, time_taken_sec, lives_left FROM game_sessions WHERE session_id=?', [sid]) : null;
    return { player_id: pid, name: p.display_name || p.agent_name, session: s };
  };
  const a = await side(m.a_player, m.a_session), b = await side(m.b_player, m.b_session);
  const done = (x) => x && x.session && x.session.result !== 'active';
  let winner = null;
  if (done(a) && done(b)) {
    const k = (x) => [x.session.result === 'win' ? 1 : 0, x.session.score, -x.session.time_taken_sec];
    const ka = k(a), kb = k(b);
    winner = 'draw';
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) { winner = ka[i] > kb[i] ? 'a' : 'b'; break; }
  }
  return { code, case_id: m.case_id, a, b, winner };
}
app.post('/api/matches', auth, ah(async (req, res) => {
  const { case_id } = req.body || {};
  const player_id = req.pid;
  const p = await db.get('SELECT player_id FROM players WHERE player_id=?', [player_id]);
  const c = await db.get('SELECT case_id FROM cases WHERE case_id=?', [case_id]);
  if (!p || !c) return res.status(404).json({ error: 'player or case not found' });
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  await db.run('INSERT INTO matches (code, case_id, a_player) VALUES (?,?,?)', [code, case_id, player_id]);
  res.status(201).json(await matchView(code));
}));
app.get('/api/matches/:code', auth, ah(async (req, res) => {
  const v = await matchView(String(req.params.code).toUpperCase());
  v ? res.json(v) : res.status(404).json({ error: 'Match not found' });
}));
app.post('/api/matches/:code/join', auth, ah(async (req, res) => {
  const code = String(req.params.code).toUpperCase(), pid = req.pid;
  const m = await db.get('SELECT * FROM matches WHERE code=?', [code]);
  if (!m) return res.status(404).json({ error: 'Match not found' });
  if (m.a_player !== pid) {
    if (m.b_player && m.b_player !== pid) return res.status(409).json({ error: 'Match is already full' });
    if (!m.b_player) await db.run('UPDATE matches SET b_player=? WHERE code=?', [pid, code]);
  }
  res.json(await matchView(code));
}));
app.post('/api/matches/:code/session', auth, ah(async (req, res) => {
  const code = String(req.params.code).toUpperCase(), { session_id } = req.body || {}, player_id = req.pid;
  const m = await db.get('SELECT * FROM matches WHERE code=?', [code]);
  const s = await db.get('SELECT * FROM game_sessions WHERE session_id=?', [session_id]);
  if (!m || !s || s.player_id !== player_id || s.case_id !== m.case_id) return res.status(400).json({ error: 'invalid match session' });
  const col = m.a_player === player_id ? 'a_session' : m.b_player === player_id ? 'b_session' : null;
  if (!col) return res.status(403).json({ error: 'not in this match' });
  if (m[col]) return res.status(409).json({ error: 'You already played this match' });
  await db.run(`UPDATE matches SET ${col}=? WHERE code=?`, [session_id, code]);
  res.json(await matchView(code));
}));

app.get('/api/achievements', ah(async (_req, res) => res.json(await db.all('SELECT * FROM achievements'))));
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'server error' }); });

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Binary Heist backend on http://localhost:${PORT}`));
}
module.exports = app;
module.exports.app = app;