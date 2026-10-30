// Plays a full game against a running server. Reads answers straight from the DB (test only).
// Local: DB_PATH (default ../heist.db).  Remote DB: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN.
const { createClient } = require('@libsql/client');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:3999';
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:' + (process.env.DB_PATH || path.join(__dirname, '..', 'heist.db')),
  authToken: process.env.TURSO_AUTH_TOKEN,
});
let A = {};
const call = async (m, u, b, h = {}) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', ...A, ...h }, body: b ? JSON.stringify(b) : undefined })).json();
const answerFor = async (sid, stage) =>
  (await db.execute({ sql: 'SELECT correct_answer FROM session_puzzles WHERE session_id=? AND stage_no=?', args: [sid, stage] })).rows[0][0];

(async () => {
  // every account needs a password now: register a fresh one per run, then check the login rules
  const id = 'Smoke_' + Date.now().toString(36), pw = 'secret123';
  const p = await call('POST', '/api/login', { agent_name: id, password: pw, display_name: 'Smoke Test', register: true });
  A = { authorization: 'Bearer ' + p.token };
  const bad = await call('POST', '/api/login', { agent_name: id, password: 'wrong-pass' });
  console.log('wrong password rejected:', !!bad.error, '|', bad.error);
  const nopw = await call('POST', '/api/login', { agent_name: id });
  console.log('missing password rejected:', !!nopw.error, '|', nopw.error);
  const ghost = await call('POST', '/api/login', { agent_name: 'Nobody_' + id, password: pw });
  console.log('unknown id gives same message as wrong password:', ghost.error === bad.error);
  const again = await call('POST', '/api/login', { agent_name: id, password: pw });
  console.log('correct password accepted:', !!again.token);
  console.log('login:', p.agent_name, p.rank_title);
  const cases = await call('GET', '/api/cases');
  let s = await call('POST', '/api/sessions', { player_id: p.player_id, case_id: cases[0].case_id });
  console.log('stage 1 question:', s.puzzle.question);

  // double-submit race: send the same correct answer twice at once; only one may count
  const a1 = await answerFor(s.session_id, 1);
  const [r1, r2] = await Promise.all([
    call('POST', `/api/sessions/${s.session_id}/answer`, { answer: a1 }),
    call('POST', `/api/sessions/${s.session_id}/answer`, { answer: a1 }),
  ]);
  s = await call('GET', `/api/sessions/${s.session_id}`);
  console.log('race: stage after 2 simultaneous correct answers =', s.stage, '(expected 2) |', [r1, r2].map((r) => (r.correct ? 'ok' : r.error)).join(' / '));

  s = await call('POST', `/api/sessions/${s.session_id}/answer`, { answer: '0000' });
  console.log('wrong ->', s.correct, 'lives', s.lives_left);
  const h = await call('POST', `/api/sessions/${s.session_id}/hint`);
  console.log('hint:', h.hint, '| time_left', h.time_left);

  while (s.status === 'active') {
    const ans = await answerFor(s.session_id, s.stage);
    s = await call('POST', `/api/sessions/${s.session_id}/answer`, { answer: ans });
    console.log(`correct=${s.correct} bit=${s.revealed_bit} score=${s.score} status=${s.status} next_stage=${s.stage}`);
    if (s.stage === 5 && s.status === 'active') console.log('final question:', s.puzzle.question);
  }
  console.log('achievements:', JSON.stringify(s.summary.achievements.map((a) => a.name)), '| xp', s.summary.xp_earned, '| rank', s.summary.agent.rank_title);
  console.log('leaderboard:', JSON.stringify(await call('GET', '/api/leaderboard')));
  const an = await call('GET', `/api/players/${p.player_id}/analytics`);
  console.log('weakest:', JSON.stringify(an.weakest_concept));
  if (!process.env.HW_KEY) return console.log('hardware tests skipped (set HW_KEY to run them)');
  const key = { 'x-hardware-key': process.env.HW_KEY };
  console.log('hw event:', JSON.stringify(await call('POST', '/api/hardware/event', { state: 'S2', lives: 3, timer: 200, bits: '1011', cmp: 0 }, key)));
  console.log('hw state:', JSON.stringify(await call('GET', '/api/hardware/state')));
  // hardware-mode session + command endpoint
  const hs = await call('POST', '/api/sessions', { player_id: p.player_id, case_id: cases[0].case_id, mode: 'hardware' });
  console.log('hw command:', JSON.stringify(await call('GET', '/api/hardware/command', null, key)));
  await call('POST', '/api/hardware/event', { state: 'S6', lives: 3, timer: 100, bits: '1011', cmp: 1 }, key);
  console.log('hw win ->', (await call('GET', `/api/sessions/${hs.session_id}`)).status);
})();