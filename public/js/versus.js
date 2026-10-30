/* =====================================================================
   BINARY HEIST // VERSUS  -  versus.js
   Online 2-player match (WebRTC via PeerJS, koi server/setup nahi chahiye)
   versus.html mein sirf </body> se pehle ye line add karein:
       <script src="versus.js"></script>
   ===================================================================== */
(() => {
'use strict';

/* ------------------------------ CONFIG ------------------------------ */
const CFG = {
  SECTORS: 5,
  LIVES: 3,
  SECONDS: 120,          // match time limit
  CORRUPT_COST: 500,     // bounty pts
  CORRUPT_SECS: 15,      // victim's target bus inverted for 15s (also attacker cooldown)
  WRONG_PENALTY: 50,
  PEER_PREFIX: 'binaryheist-',
  PEER_CDN: 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
};
const GATE_FN = {
  AND: (a, b) => a & b,
  OR: (a, b) => a | b,
  XOR: (a, b) => a ^ b,
  NAND: (a, b) => (a & b) ^ 1,
  NOR: (a, b) => (a | b) ^ 1
};
const SIDE = {
  left:  { accent: '#00e3fd', solid: 'h-2 bg-secondary-container', gates: ['AND', 'OR', 'XOR', 'NAND'],
           btnOn: 'py-2 border-2 border-secondary-container text-secondary-container bg-secondary-container/15 font-bold' },
  right: { accent: '#ffb4ab', solid: 'h-2 bg-error', gates: ['AND', 'NOR', 'XOR', 'NAND'],
           btnOn: 'py-2 border-2 border-error text-error bg-error/15 font-bold' }
};
const BTN_OFF = 'py-2 border border-outline-variant text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors';
const BAR_OFF = 'h-2 bg-surface-container-high border border-outline-variant';
const SECTOR_NAMES = ['ENTRY BYPASS', 'BUS ROUTING', 'LATCH CRACK', 'VAULT LOCK', 'CORE BREACH'];
const COL = { ok: '#39ff14', warn: '#ffba43', err: '#ffb4ab', dim: '#85967c' };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* ------------------------------ STATE ------------------------------- */
const S = { phase: 'idle', role: null, code: null, peer: null, conn: null,
            name: '', oppName: '', oppSnap: null, endAt: 0, rtt: null };
const me = {};
let tele = [];
let lastCorrupt = false;
let tickTimer = null, pingTimer = null;

function resetMe() {
  Object.assign(me, { score: 0, attempts: 0, correct: 0, lives: CFG.LIVES, done: 0,
    a: 0, b: 0, target: 0, gate: null, q: null, verdict: null,
    corruptUntil: 0, cooldownUntil: 0, lockUntil: 0, sectorStart: 0, log: [] });
  tele = [];
}
resetMe();

const mySide  = () => (S.role === 'host' ? 'left' : 'right');
const oppSide = () => (S.role === 'host' ? 'right' : 'left');
const agentNo = (role) => (role === 'host' ? '01' : '02');
const isCorrupt = () => Date.now() < me.corruptUntil;
const effTarget = () => me.target ^ (isCorrupt() ? 1 : 0);
const accuracy = () => (me.attempts ? (me.correct / me.attempts) * 100 : 0);
const fmt = (n) => Number(n).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanName = (s) => String(s || '').replace(/[^\w \-]/g, '').trim().slice(0, 14).toUpperCase();

/* --------------------------- DOM BINDINGS --------------------------- */
const $ = (s, r = document) => r.querySelector(s);
const byText = (sel, txt) => [...document.querySelectorAll(sel)]
  .find((e) => e.textContent.trim().toUpperCase().startsWith(txt));

function bindPanel(section, side) {
  const wrap = $(':scope > div.space-y-4', section);
  const [head, stats, sector, breach, bench] = wrap.children;
  const idBlock = head.children[0].children[1];
  const [pinsCol, wiresCol, gateBox, outWireBox, qBox] = bench.children[1].children;
  const term = $('.h-28', section);
  return {
    side,
    name: idBlock.children[0].children[0],
    badge: idBlock.children[0].children[1],
    callsign: idBlock.children[1],
    shields: [...head.children[1].children[1].children],
    score: stats.children[0].children[1],
    acc: stats.children[1].children[1],
    secLabel: sector.children[0].children[0],
    secStage: sector.children[0].children[1],
    bars: [...sector.children[1].children],
    pct: breach.children[0].children[1],
    fill: breach.children[1].children[0],
    target: bench.children[0].children[1],
    pinA: pinsCol.children[0].children[1],
    pinB: pinsCol.children[1].children[1],
    wireA: wiresCol.children[0],
    wireB: wiresCol.children[1],
    gateName: gateBox.children[1],
    outWire: outWireBox.children[0],
    qBox, qLabel: qBox.children[0], qVal: qBox.children[1],
    btns: [...bench.children[2].children],
    termExec: term.children[0].children[1],
    termLines: [...term.children[1].children]
  };
}

const sections = document.querySelectorAll('main section');
const P = { left: bindPanel(sections[0], 'left'), right: bindPanel(sections[2], 'right') };

const center = sections[1];
const timerBig = center.children[1].children[1];
const timerSub = center.children[1].children[2];
const corruptBtn = center.children[2].children[1];
const busStatus = center.children[2].children[3].children[1];
const busDot = busStatus.children[0];
const busText = busStatus.children[1];
const teleLines = [...center.children[3].children[1].children];

const header = $('header');
const [hdSynapse, hdRtt, hdBus] = $('div.hidden', header).querySelectorAll('span.text-body-sm');
const hdStage = header.children[2].children[0];
const hdStatus = header.children[2].children[1];
const sessionSpan = byText('span', 'SESSION TOKEN');
const surrenderBtn = byText('button', 'SURRENDER PROTOCOL');
const abortBtn = byText('button', 'ABORT LINK');

/* ----------------------------- RENDERING ---------------------------- */
function setNum(el, txt) {
  if (el.firstChild && el.firstChild.nodeType === 3) el.firstChild.nodeValue = txt + ' ';
  else el.insertBefore(document.createTextNode(txt + ' '), el.firstChild);
}
function setPin(el, wire, v, accent) {
  const on = v === 1;
  el.className = 'px-2.5 py-1 text-body-sm font-bold border';
  el.textContent = v === null ? '--' : (on ? '1 (HIGH)' : '0 (LOW)');
  el.style.color = on ? accent : COL.dim;
  el.style.borderColor = on ? accent : '#3c4b35';
  el.style.background = on ? accent + '33' : '#262a31';
  wire.style.background = on ? accent : '#3c4b35';
}
function render(side, snap, interactive) {
  const p = P[side], A = SIDE[side].accent, has = !!snap;
  p.name.textContent = has ? snap.name : 'NULL';
  p.badge.textContent = has ? (snap.role === 'host' ? 'HOST' : 'GUEST') : 'NULL';
  p.callsign.textContent = has ? 'MATCH ID: ' + S.code : 'CALLSIGN: NULL';
  p.shields.forEach((el, i) => {
    const on = has && i < snap.lives;
    el.textContent = on ? 'verified_user' : 'shield';
    el.style.color = on ? A : '#3c4b35';
    el.style.fontVariationSettings = on ? "'FILL' 1" : "'FILL' 0";
  });
  setNum(p.score, has ? fmt(snap.score) : '--');
  setNum(p.acc, has ? snap.acc.toFixed(1) + '%' : '--');
  p.secLabel.textContent = has ? `SECTOR 0${snap.cur} / 05: ${SECTOR_NAMES[snap.cur - 1]}` : 'SECTOR -- / --: NULL';
  p.secStage.textContent = has ? 'MATCH #' + S.code : 'STAGE #--';
  p.bars.forEach((b, i) => {
    b.className = !has ? BAR_OFF
      : i < snap.done ? SIDE[side].solid
      : (i === snap.done && snap.done < CFG.SECTORS) ? SIDE[side].solid + ' animate-pulse' : BAR_OFF;
  });
  p.pct.textContent = has ? `${snap.done * 20}% PENETRATION` : '--% PENETRATION';
  p.fill.style.width = has ? snap.done * 20 + '%' : '0%';

  // workbench
  p.target.textContent = has ? `TARGET: Q=${snap.target}${snap.corrupt ? ' [INV]' : ''}` : 'TARGET: Q=--';
  p.target.style.color = has && snap.corrupt ? COL.err : '';
  setPin(p.pinA, p.wireA, has ? snap.a : null, A);
  setPin(p.pinB, p.wireB, has ? snap.b : null, A);
  p.gateName.textContent = has && snap.gate ? snap.gate : '--';
  const st = !has || snap.q === null ? 'none' : snap.verdict;
  const cc = { none: COL.dim, ok: COL.ok, bad: COL.err }[st];
  p.qBox.className = 'p-2.5 border text-center';
  p.qBox.style.cssText = `border-color:${cc};background:${cc}1a`;
  p.qLabel.style.color = cc;
  p.qVal.style.color = cc;
  p.qVal.textContent = st === 'none' ? '--' : snap.q + (st === 'ok' ? ' [OK]' : ' [FAIL]');
  p.outWire.style.background = cc;
  [...p.outWire.children].forEach((d) => (d.style.background = cc));
  p.btns.forEach((b, i) => {
    const g = SIDE[side].gates[i];
    const on = has && snap.gate === g;
    b.dataset.gate = g;
    b.textContent = on ? g + ' [ACT]' : g;
    b.className = on ? SIDE[side].btnOn : BTN_OFF;
    b.style.borderColor = on && snap.verdict ? (snap.verdict === 'ok' ? COL.ok : COL.err) : '';
    b.style.color = on && snap.verdict ? (snap.verdict === 'ok' ? COL.ok : COL.err) : '';
    b.style.pointerEvents = interactive ? '' : 'none';
    b.style.opacity = has ? (interactive || on ? '1' : '0.6') : '0.4';
  });

  // terminal
  p.termExec.textContent = has && S.phase === 'active' ? 'EXEC: LIVE' : 'EXEC: IDLE';
  const lines = has ? snap.log : [{ t: '> NULL', c: 'dim' }];
  p.termLines.forEach((el, i) => {
    const l = lines[i];
    el.textContent = l ? l.t : '';
    el.style.color = l ? (l.c === 'info' ? A : COL[l.c] || COL.dim) : '';
  });
}

function renderTele() {
  const lines = tele.slice(-2);
  teleLines.forEach((el, i) => {
    const l = lines[i];
    if (!l) { el.textContent = i === 0 && !tele.length ? '> NULL' : ''; el.style.color = COL.dim; return; }
    el.textContent = `> AGENT ${l.agent}: ${l.text}`;
    el.style.color = l.agent === '01' ? SIDE.left.accent : SIDE.right.accent;
  });
}

function renderBus() {
  const now = Date.now();
  let txt, col;
  if (S.phase !== 'active') { txt = 'OFFLINE'; col = COL.dim; }
  else if (me.cooldownUntil > now) { txt = 'COOLDOWN ' + Math.ceil((me.cooldownUntil - now) / 1000) + 's'; col = COL.warn; }
  else if (me.score < CFG.CORRUPT_COST) { txt = 'LOW BOUNTY'; col = COL.warn; }
  else { txt = 'READY'; col = COL.ok; }
  const ready = txt === 'READY';
  busText.textContent = txt;
  busStatus.style.color = col;
  busDot.style.background = col;
  busDot.classList.toggle('animate-ping', ready);
  corruptBtn.disabled = !ready;
  corruptBtn.style.opacity = ready ? '1' : '0.45';
  corruptBtn.style.pointerEvents = ready ? '' : 'none';
}

function renderTimer() {
  if (S.phase !== 'active') {
    if (S.phase !== 'ended') {
      timerBig.innerHTML = '--:--<span class="text-headline-md font-headline-md text-error">.--</span>';
      timerSub.textContent = 'AUTOCLOSE --:--';
    }
    return;
  }
  const ms = Math.max(0, S.endAt - Date.now());
  const sec = Math.floor(ms / 1000);
  const cs = String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
  timerBig.innerHTML = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}` +
    `<span class="text-headline-md font-headline-md text-error">.${cs}</span>`;
  timerSub.textContent = 'AUTOCLOSE 02:00';
}

function setBadge(txt) { hdStatus.textContent = txt; }
function renderHeader() {
  if (S.phase === 'active' || S.phase === 'ended') {
    const lead = Math.max(me.done, S.oppSnap ? S.oppSnap.done : 0);
    hdStage.textContent = `STAGE 0${Math.min(lead + 1, CFG.SECTORS)}/05`;
    hdSynapse.textContent = 'SYNAPSE: ' + (S.phase === 'active' ? 'LINKED' : 'CLOSED');
    hdRtt.textContent = 'RTT: ' + (S.rtt === null ? '--' : S.rtt + 'ms');
    hdBus.textContent = 'BUS: CH-01 \u27F7 CH-02';
  } else {
    hdStage.textContent = 'STAGE --/--';
    hdSynapse.textContent = 'SYNAPSE: NULL';
    hdRtt.textContent = 'RTT: --';
    hdBus.textContent = 'BUS: NULL';
  }
}

function snapshot() {
  return { name: S.name, role: S.role, score: me.score, acc: accuracy(), lives: me.lives, done: me.done,
    cur: Math.max(1, Math.min(me.done + (me.verdict === 'ok' ? 0 : 1), CFG.SECTORS)),
    a: me.a, b: me.b, target: effTarget(), corrupt: isCorrupt(),
    gate: me.gate, q: me.q, verdict: me.verdict, log: me.log.slice(-3) };
}
function send(msg) { if (S.conn && S.conn.open) S.conn.send(msg); }
function pushState() {
  const snap = snapshot();
  const canClick = S.phase === 'active' && !me.gate && me.lives > 0 && me.done < CFG.SECTORS;
  render(mySide(), snap, canClick);
  send({ type: 'state', snap });
  renderHeader(); renderBus();
}
function addLog(t, c) { me.log.push({ t, c }); if (me.log.length > 3) me.log.shift(); }
function addTele(agent, text) { tele.push({ agent, text }); if (tele.length > 2) tele.shift(); renderTele(); }

/* ------------------------------ GAMEPLAY ---------------------------- */
function nextPuzzle() {
  const gates = SIDE[mySide()].gates;
  let a, b, t, tries = 0, sols;
  do {
    a = Math.random() < 0.5 ? 0 : 1; b = Math.random() < 0.5 ? 0 : 1; t = Math.random() < 0.5 ? 0 : 1;
    sols = gates.filter((g) => GATE_FN[g](a, b) === t).length;
  } while ((sols < 1 || sols > 2) && ++tries < 30);
  Object.assign(me, { a, b, target: t, gate: null, q: null, verdict: null, sectorStart: Date.now() });
}

function pickGate(g) {
  if (S.phase !== 'active' || me.gate || Date.now() < me.lockUntil || me.done >= CFG.SECTORS || me.lives <= 0) return;
  me.attempts++;
  me.gate = g;
  me.q = GATE_FN[g](me.a, me.b);
  const ok = me.q === effTarget();
  me.verdict = ok ? 'ok' : 'bad';
  const sec = me.done + 1;
  if (ok) {
    me.correct++;
    const gain = 100 + Math.max(0, 50 - Math.floor((Date.now() - me.sectorStart) / 1000) * 5);
    me.score += gain; me.done++;
    me.lockUntil = Date.now() + 700;
    addLog(`> [OK] SECTOR 0${sec} CRACKED +${gain}`, 'ok');
    if (me.done >= CFG.SECTORS) {
      addLog('> VAULT BREACHED: ALL CLEARED', 'ok');
      pushState(); claim('finished'); return;
    }
    pushState();
    setTimeout(() => { if (S.phase !== 'active') return; nextPuzzle(); pushState(); }, 700);
  } else {
    me.lives--; me.score = Math.max(0, me.score - CFG.WRONG_PENALTY);
    me.lockUntil = Date.now() + 600;
    addLog(`> [ERR] ${g} REJECTED: CRC -1`, 'err');
    if (me.lives <= 0) {
      addLog('> INTEGRITY ZERO: LINK SEVERED', 'err');
      pushState(); claim('dead'); return;
    }
    pushState();
    setTimeout(() => { if (S.phase !== 'active') return; me.gate = null; me.q = null; me.verdict = null; pushState(); }, 600);
  }
}

function triggerCorruption() {
  if (S.phase !== 'active' || me.score < CFG.CORRUPT_COST || Date.now() < me.cooldownUntil) return;
  me.score -= CFG.CORRUPT_COST;
  me.cooldownUntil = Date.now() + CFG.CORRUPT_SECS * 1000;
  addLog(`> CORRUPTION INJECTED -${CFG.CORRUPT_COST} PTS`, 'warn');
  addTele(agentNo(S.role), 'BUS INVERSION INJECTED');
  send({ type: 'corrupt' });
  pushState();
}

/* -------------------------- MATCH LIFECYCLE ------------------------- */
function startMatch() {
  if (S.phase === 'active') return;
  resetMe();
  S.phase = 'active';
  S.oppSnap = null;
  S.endAt = Date.now() + CFG.SECONDS * 1000;
  hideLobby();
  nextPuzzle();
  addLog('> LINK ESTABLISHED', 'info');
  addLog('> SECTOR 01 ONLINE', 'dim');
  P.left.badge.textContent; // (no-op, keeps bindings alive)
  sessionSpan.textContent = `SESSION TOKEN: 0x${S.code}_${S.role === 'host' ? 'H' : 'G'}`;
  setBadge('CONVERGENCE ACTIVE');
  lastCorrupt = false;
  pushState();
  renderTele();
  clearInterval(tickTimer); clearInterval(pingTimer);
  tickTimer = setInterval(tick, 50);
  pingTimer = setInterval(() => send({ type: 'ping', t: Date.now() }), 2000);
  send({ type: 'ping', t: Date.now() });
}

function tick() {
  renderTimer();
  renderBus();
  const c = isCorrupt();
  if (c !== lastCorrupt) { lastCorrupt = c; if (!c) addLog('> BUS RESTORED', 'info'); pushState(); }
  if (S.role === 'host' && S.phase === 'active' && Date.now() >= S.endAt) {
    const m = snapshot(), o = S.oppSnap || { done: 0, score: 0, lives: 0 };
    const mk = (s) => [s.done, s.score, s.lives];
    let w = 'draw';
    const a = mk(m), b = mk(o);
    for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) { w = a[i] > b[i] ? 'host' : 'guest'; break; } }
    hostEnd(w, 'TIME EXPIRED: HIGHER PENETRATION WINS');
  }
}

function claim(kind) {
  if (S.role === 'host') handleClaim('host', kind);
  else send({ type: 'claim', kind });
}
function handleClaim(role, kind) {
  const other = role === 'host' ? 'guest' : 'host';
  const nm = role === 'host' ? S.name : S.oppName;
  if (kind === 'finished') hostEnd(role, `${nm} CLEARED ALL 5 SECTORS`);
  else if (kind === 'dead') hostEnd(other, `${nm} LOST ALL INTEGRITY`);
  else hostEnd(other, `${nm} SURRENDERED`);
}
function hostEnd(winner, reason) {
  if (S.phase !== 'active') return;
  send({ type: 'end', winner, reason });
  endMatch(winner, reason);
}
function endMatch(winner, reason) {
  if (S.phase === 'ended') return;
  S.phase = 'ended';
  clearInterval(tickTimer); clearInterval(pingTimer);
  setBadge('LINK CLOSED');
  render(mySide(), snapshot(), false);
  if (S.oppSnap) render(oppSide(), S.oppSnap, false);
  renderHeader(); renderBus();
  const result = winner === 'draw' ? 'draw' : winner === S.role ? 'win' : 'lose';
  setTimeout(() => showResult(result, reason), 900);
}

/* ------------------------------ NETWORK ----------------------------- */
function loadPeer() {
  return new Promise((res, rej) => {
    if (window.Peer) return res();
    const s = document.createElement('script');
    s.src = CFG.PEER_CDN; s.onload = res;
    s.onerror = () => rej(new Error('PeerJS load nahi hua (internet check karein)'));
    document.head.appendChild(s);
  });
}
const genCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

function wireConn(c) {
  S.conn = c;
  c.on('data', onMsg);
  c.on('close', onClose);
  c.on('error', onClose);
}
function onClose() {
  if (S.phase === 'active') endMatch(S.role, 'OPPONENT LINK LOST');
}

function onMsg(m) {
  if (!m || !m.type) return;
  switch (m.type) {
    case 'hello':                                  // host side
      if (S.role !== 'host' || S.phase !== 'waiting') return;
      S.oppName = cleanName(m.name) || 'GUEST';
      send({ type: 'welcome', name: S.name });
      send({ type: 'start' });
      startMatch();
      break;
    case 'welcome': S.oppName = cleanName(m.name) || 'HOST'; break;
    case 'start': if (S.role === 'guest') startMatch(); break;
    case 'busy': lobbyError('MATCH PEHLE SE FULL HAI'); break;
    case 'state':
      if (S.phase === 'idle' || S.phase === 'waiting') return;
      S.oppSnap = m.snap;
      render(oppSide(), m.snap, false);
      renderHeader();
      break;
    case 'corrupt':
      if (S.phase !== 'active') return;
      me.corruptUntil = Date.now() + CFG.CORRUPT_SECS * 1000;
      addLog(`> WARNING: TARGET BUS INVERTED ${CFG.CORRUPT_SECS}s`, 'warn');
      addTele(agentNo(S.role === 'host' ? 'guest' : 'host'), 'BUS INVERSION INJECTED');
      lastCorrupt = true;
      pushState();
      break;
    case 'claim': if (S.role === 'host') handleClaim('guest', m.kind); break;
    case 'end': endMatch(m.winner, m.reason); break;
    case 'ping': send({ type: 'pong', t: m.t }); break;
    case 'pong': S.rtt = Date.now() - m.t; renderHeader(); break;
  }
}

async function createMatch(name) {
  S.name = name; S.role = 'host';
  lobbyBusy('LINK INITIALISE HO RAHA HAI...');
  try { await loadPeer(); } catch (e) { return lobbyError(e.message); }
  const attempt = (n) => {
    const code = genCode();
    const peer = new Peer(CFG.PEER_PREFIX + code);
    peer.on('open', () => {
      S.peer = peer; S.code = code; S.phase = 'waiting';
      setBadge('AWAITING OPPONENT');
      sessionSpan.textContent = `SESSION TOKEN: 0x${code}_H`;
      showWaiting(code);
    });
    peer.on('connection', (c) => {
      if (S.conn) { c.on('open', () => { c.send({ type: 'busy' }); setTimeout(() => c.close(), 300); }); return; }
      wireConn(c);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && n < 5) { peer.destroy(); attempt(n + 1); }
      else lobbyError('CONNECTION ERROR: ' + err.type);
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
  };
  attempt(0);
}

async function joinMatch(name, code) {
  S.name = name; S.role = 'guest'; S.code = code;
  lobbyBusy('MATCH SE CONNECT HO RAHA HAI...');
  try { await loadPeer(); } catch (e) { return lobbyError(e.message); }
  const peer = new Peer();
  S.peer = peer;
  peer.on('error', (err) => {
    lobbyError(err.type === 'peer-unavailable' ? 'MATCH ID NAHI MILI (ya match khatam ho chuka)' : 'CONNECTION ERROR: ' + err.type);
  });
  peer.on('open', () => {
    const c = peer.connect(CFG.PEER_PREFIX + code, { reliable: true });
    wireConn(c);
    let opened = false;
    c.on('open', () => {
      opened = true; S.phase = 'waiting';
      c.send({ type: 'hello', name });
      lobbyBusy('CONNECTED: HOST KA START WAIT HO RAHA HAI...');
    });
    setTimeout(() => { if (!opened && S.phase === 'idle') lobbyError('CONNECT NAHI HUA: ID check karein ya dobara try karein'); }, 15000);
  });
}

/* ------------------------------ LOBBY UI ---------------------------- */
const BTN_CSS = 'width:100%;padding:12px;margin-top:10px;font-family:inherit;font-weight:700;letter-spacing:.12em;font-size:13px;cursor:pointer;';
const INPUT_CSS = 'width:100%;padding:11px;background:#10141a;border:1px solid #3c4b35;color:#dfe2eb;font-family:inherit;font-size:14px;letter-spacing:.1em;outline:none;user-select:text;-webkit-user-select:text;';
const lobby = document.createElement('div');
lobby.style.cssText = 'position:fixed;inset:0;z-index:100;background:rgba(10,14,20,.97);display:flex;align-items:center;justify-content:center;font-family:"JetBrains Mono",monospace;color:#dfe2eb;padding:16px;';
lobby.innerHTML = `
<div style="width:100%;max-width:440px;border:1px solid #3c4b35;background:#0a0e14;padding:28px;box-shadow:0 0 24px rgba(57,255,20,.15)">
  <div style="color:#39ff14;font-weight:700;letter-spacing:.14em;font-size:18px">BINARY HEIST // VERSUS</div>
  <div style="color:#85967c;font-size:12px;margin:4px 0 20px;letter-spacing:.1em">DUAL INTRUSION PROTOCOL</div>
  <div id="vs-form">
    <div style="font-size:11px;color:#85967c;letter-spacing:.12em;margin-bottom:6px">OPERATOR NAME</div>
    <input id="vs-name" maxlength="14" placeholder="ENTER NAME" style="${INPUT_CSS}">
    <button id="vs-create" style="${BTN_CSS}background:#39ff14;color:#022100;border:none">CREATE MATCH</button>
    <div style="text-align:center;color:#85967c;font-size:11px;margin:16px 0 6px;letter-spacing:.2em">// OR //</div>
    <input id="vs-code" maxlength="6" placeholder="MATCH ID" style="${INPUT_CSS}text-transform:uppercase">
    <button id="vs-join" style="${BTN_CSS}background:transparent;color:#00e3fd;border:1px solid #00e3fd">JOIN MATCH</button>
  </div>
  <div id="vs-wait" style="display:none;text-align:center">
    <div style="font-size:11px;color:#85967c;letter-spacing:.12em">SHARE THIS MATCH ID</div>
    <div id="vs-id" style="font-size:38px;font-weight:700;letter-spacing:.3em;color:#00e3fd;margin:12px 0;user-select:text;-webkit-user-select:text"></div>
    <button id="vs-copy" style="${BTN_CSS}background:transparent;color:#ffba43;border:1px solid #ffba43">COPY ID</button>
    <div style="margin-top:16px;color:#39ff14;font-size:12px;letter-spacing:.1em">&gt; WAITING FOR OPPONENT...</div>
    <button id="vs-cancel" style="${BTN_CSS}background:transparent;color:#ffb4ab;border:1px solid #ffb4ab">CANCEL</button>
  </div>
  <div id="vs-msg" style="min-height:18px;margin-top:14px;font-size:12px;letter-spacing:.06em"></div>
</div>`;
document.body.appendChild(lobby);

const L = (id) => lobby.querySelector('#' + id);
function lobbyMsg(t, c) { const m = L('vs-msg'); m.textContent = t; m.style.color = c; }
function lobbyError(t) { lobbyMsg('> ' + t, COL.err); S.role = S.phase === 'waiting' ? S.role : null; L('vs-form').style.display = S.phase === 'waiting' ? 'none' : 'block'; if (S.phase === 'idle' && S.peer) { try { S.peer.destroy(); } catch (e) { /* ignore */ } S.peer = null; S.conn = null; } L('vs-create').disabled = L('vs-join').disabled = false; }
function lobbyBusy(t) { lobbyMsg('> ' + t, COL.warn); L('vs-create').disabled = L('vs-join').disabled = true; }
function showWaiting(code) { L('vs-form').style.display = 'none'; L('vs-wait').style.display = 'block'; L('vs-id').textContent = code; lobbyMsg('', COL.ok); }
function hideLobby() { lobby.style.display = 'none'; }

function readName() {
  const n = cleanName(L('vs-name').value);
  if (!n) { lobbyMsg('> PEHLE APNA NAME LIKHEIN', COL.err); L('vs-name').focus(); return null; }
  return n;
}
L('vs-create').onclick = () => { const n = readName(); if (n) createMatch(n); };
L('vs-join').onclick = () => {
  const n = readName(); if (!n) return;
  const code = L('vs-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) { lobbyMsg('> 6 CHARACTER KI MATCH ID LIKHEIN', COL.err); return; }
  joinMatch(n, code);
};
L('vs-copy').onclick = () => { try { navigator.clipboard.writeText(S.code); L('vs-copy').textContent = 'COPIED'; } catch (e) { /* ignore */ } };
L('vs-cancel').onclick = () => location.reload();
L('vs-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') L('vs-join').click(); });
L('vs-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') L('vs-create').click(); });

/* ----------------------------- RESULT UI ---------------------------- */
function showResult(result, reason) {
  const cfg = {
    win:  { title: 'VICTORY', sub: 'VAULT BREACHED: YOU WIN', color: '#39ff14' },
    lose: { title: 'DEFEAT', sub: 'INTRUSION FAILED: YOU LOSE', color: '#ffb4ab' },
    draw: { title: 'DRAW', sub: 'BOTH LINKS SEVERED EVEN', color: '#ffba43' }
  }[result];
  const m = snapshot(), o = S.oppSnap || { name: S.oppName || 'NULL', score: 0, acc: 0, lives: 0, done: 0 };
  const row = (s, you) => `<div style="flex:1;border:1px solid ${you ? cfg.color : '#3c4b35'};padding:12px;background:#10141a">
      <div style="font-weight:700;color:#dfe2eb;font-size:13px">${esc(s.name)}${you ? ' (YOU)' : ''}</div>
      <div style="font-size:11px;color:#85967c;margin-top:8px;line-height:1.8">SCORE: <b style="color:#dfe2eb">${fmt(s.score)}</b><br>SECTORS: <b style="color:#dfe2eb">${s.done}/5</b><br>ACCURACY: <b style="color:#dfe2eb">${s.acc.toFixed(1)}%</b><br>CRC LEFT: <b style="color:#dfe2eb">${s.lives}/3</b></div></div>`;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:110;background:rgba(10,14,20,.94);display:flex;align-items:center;justify-content:center;font-family:"JetBrains Mono",monospace;padding:16px;';
  ov.innerHTML = `<div style="width:100%;max-width:520px;border:2px solid ${cfg.color};background:#0a0e14;padding:28px;text-align:center;box-shadow:0 0 40px ${cfg.color}55">
    <div style="font-size:44px;font-weight:700;letter-spacing:.2em;color:${cfg.color}">${cfg.title}</div>
    <div style="color:#85967c;font-size:12px;letter-spacing:.14em;margin:6px 0 4px">${cfg.sub}</div>
    <div style="color:#baccb0;font-size:12px;margin-bottom:18px">${esc(reason || '')}</div>
    <div style="display:flex;gap:12px;text-align:left">${row(m, true)}${row(o, false)}</div>
    <button id="vs-again" style="${BTN_CSS}background:${cfg.color};color:#0a0e14;border:none;margin-top:20px">BACK TO LOBBY</button>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#vs-again').onclick = () => location.reload();
}

/* ------------------------------ CONTROLS ---------------------------- */
['left', 'right'].forEach((side) => {
  P[side].btns.forEach((b, i) => {
    b.dataset.gate = SIDE[side].gates[i];
    b.addEventListener('click', () => { if (S.phase === 'active' && side === mySide()) pickGate(b.dataset.gate); });
  });
});
corruptBtn.addEventListener('click', triggerCorruption);
surrenderBtn.addEventListener('click', () => {
  if (S.phase === 'active' && confirm('Surrender karna hai? Match haar jayega.')) claim('surrender');
});
abortBtn.addEventListener('click', () => {
  if (S.phase === 'active' && !confirm('Link abort karna hai? Opponent jeet jayega.')) return;
  try { if (S.conn) S.conn.close(); } catch (e) { /* ignore */ }
  location.reload();
});
window.addEventListener('beforeunload', () => { try { if (S.conn) S.conn.close(); } catch (e) { /* ignore */ } });

/* ------------------------------ INITIAL ----------------------------- */
// Pehle sab NULL (default/demo data hata do)
render('left', null, false);
render('right', null, false);
sessionSpan.textContent = 'SESSION TOKEN: NULL';
setBadge('STANDBY');
renderHeader(); renderTimer(); renderBus(); renderTele();
})();