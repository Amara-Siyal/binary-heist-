// Drop-in client for the Stitch HTML screens. Include with:
//   <script src="/js/heist-api.js"></script>
const Heist = (() => {
  const API = '';                                   // same origin
  const j = async (method, url, body) => {
    const r = await fetch(API + url, { method, headers: { 'content-type': 'application/json', ...(((load('player') || {}).token) ? { authorization: 'Bearer ' + load('player').token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.error || 'request failed'), { data });
    return data;
  };
  const save = (k, v) => sessionStorage.setItem(k, JSON.stringify(v));
  const load = (k) => JSON.parse(sessionStorage.getItem(k) || 'null');

  return {
    login: async (agent_name, rfid_uid) => { const p = await j('POST', '/api/login', { agent_name, rfid_uid }); save('player', p); return p; },
    player: () => load('player'),
    cases: () => j('GET', '/api/cases'),
    dailyCase: () => j('GET', '/api/cases/daily'),
    start: async (case_id, mode = 'solo') => { const s = await j('POST', '/api/sessions', { player_id: load('player').player_id, case_id, mode }); save('session', s.session_id); return s; },
    state: () => j('GET', `/api/sessions/${load('session')}`),
    answer: (answer) => j('POST', `/api/sessions/${load('session')}/answer`, { answer }),
    hint: () => j('POST', `/api/sessions/${load('session')}/hint`),
    abandon: () => j('POST', `/api/sessions/${load('session')}/abandon`),
    leaderboard: (period = 'all', case_id) => j('GET', `/api/leaderboard?period=${period}${case_id ? '&case_id=' + case_id : ''}`),
    analytics: () => j('GET', `/api/players/${load('player').player_id}/analytics`),
    // live hardware box + session events
    // Vercel has no WebSockets, so this polls the hardware state instead. Returns { close() }.
    live: (onMessage) => {
      let stop = false;
      const tick = async () => {
        if (stop) return;
        try { onMessage({ type: 'hardware', state: await j('GET', '/api/hardware/state') }); } catch { /* ignore */ }
        if (!stop) setTimeout(tick, 3000);
      };
      tick();
      return { close: () => { stop = true; } };
    },
  };
})();
window.Heist = Heist;
/* Example: wire the boot screen (START MISSION button + #agentIdInput)
document.querySelector('button[type=button]').addEventListener('click', async () => {
  const name = document.getElementById('agentIdInput').value;
  await Heist.login(name);
  location.href = '/case-select.html';
});
*/
