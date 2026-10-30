// Evidence Board controller. Works on the Stitch "Forensic Evidence Board" page with NO HTML edits.
// Needs /js/heist-api.js loaded first.
(() => {
  const PUZZLE_PAGE = '/puzzle.html';
  const CASES_PAGE = '/case-select.html';
  const RESULT_PAGES = { win: '/victory.html', lose: '/failure.html' };

  const $ = (s, r = document) => r.querySelector(s);
  const set = (el, t) => { if (el) el.textContent = t; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mmss = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find((e) => !e.children.length && re.test(e.textContent.trim()));

  const STEPS = ['STAGE 1: BINARY', 'STAGE 2: LOGIC LOCK', 'STAGE 3: TRUTH TABLE', 'STAGE 4: FIREWALL', 'STAGE 5: VAULT'];
  const REASONS = { out_of_lives: 'OUT OF LIVES', time_expired: 'TIME EXPIRED', vault_opened: 'VAULT OPENED', player_quit: 'MISSION ABANDONED', hardware_lockdown: 'HARDWARE LOCKDOWN' };
  const CARDS = [
    { n: 1, stages: [1], title: 'BINARY CLUE',           span: 'lg:col-span-6', pin: 'left-8',   tag: '#EVIDENCE_TAPE_A', tagPos: 'right-6', tilt: 'rotate-2',  icon: 'memory',
      note: 'Intercepted binary feed decoded. The value is written into the register bus.' },
    { n: 2, stages: [2], title: 'LOGIC LOCK',            span: 'lg:col-span-6', pin: 'right-12', tag: 'BUS_TAP_TRACE #B', tagPos: 'left-6',  tilt: '-rotate-1', icon: 'lock_open',
      note: 'Logic gate network evaluated and the lock bypassed. Output verified.' },
    { n: 3, stages: [3], title: 'TRUTH TABLE SCHEMATIC', span: 'lg:col-span-7', pin: 'left-14',  tag: '#TRUTH_PROBE_C',   tagPos: 'right-6', tilt: 'rotate-1',  icon: 'table_chart',
      note: 'Hidden gate identified from its truth table.' },
    { n: 4, stages: [4, 5], title: 'FINAL CODE VECTOR',  span: 'lg:col-span-5', pin: 'right-8',  tag: 'RESTRICTED // 0101', tagPos: 'left-6', tilt: '-rotate-2', icon: 'vpn_key',
      note: 'Firewall boss defeated and the final code accepted by the vault comparator.' },
  ];

  let snap = null, deadline = 0, sig = '', shown = false, expiring = false, hw = { connected: false };
  let clockEl, boardSig = '';

  // ---------- small UI helpers ----------
  function toast(msg) {
    let t = $('#hx-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'hx-toast';
      t.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 z-[90] max-w-sm w-[90%] px-4 py-2 bg-surface-container-high border border-secondary-container text-secondary-container font-body-sm text-body-sm text-center cyan-phosphor-glow';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._h);
    t._h = setTimeout(() => (t.style.display = 'none'), 4000);
  }
  async function go(url) {
    const ok = await fetch(url, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
    if (ok) location.href = url;
    else toast(`${url} is not added yet. It is the next screen to connect.`);
  }
  const hwOnline = () => !!hw.connected; // freshness is computed server-side

  // ---------- card renderers ----------
  const bitOf = (s, n) => { const b = s.bits_collected.find((x) => x.stage_no === n); return b ? b.bit : null; };
  const pin = (c, cls, inner) => `<div data-pin class="absolute -top-3 ${c.pin} w-6 h-6 rounded-full bg-surface-bright border-2 ${cls} flex items-center justify-center z-30"><div class="w-2 h-2 rounded-full ${inner}"></div></div>`;
  const tape = (c) => `<div class="absolute -top-2 ${c.tagPos} px-3 py-0.5 bg-surface-container-high border border-outline-variant text-[10px] text-on-surface-variant font-label-sm transform ${c.tilt}">${c.tag}</div>`;
  const resultRow = (label, value, cls) => `
    <div class="flex items-center justify-between p-3 bg-surface-container-lowest border border-outline-variant">
      <span class="text-label-sm font-label-sm text-outline uppercase tracking-wider">${label}</span>
      <div class="text-headline-sm font-headline-sm ${cls} font-bold tracking-widest px-3 py-1 bg-surface-container-low border border-outline-variant">${value}</div>
    </div>`;

  function solvedCard(c, s) {
    const lastStage = c.stages[c.stages.length - 1];
    const b = bitOf(s, c.stages[0] === 4 ? 4 : c.stages[0]);
    const row = c.n === 4
      ? resultRow('VAULT STATUS:', 'BREACHED', 'text-primary-container green-phosphor-glow')
      : resultRow('EXTRACTION RESULT:', `BIT_${c.n - 1} = [ ${b} ]`, 'text-primary-container green-phosphor-glow');
    return `
<div class="${c.span} bg-surface-container border border-outline-variant p-5 relative shadow-2xl">
  ${pin(c, 'border-primary-container green-phosphor-glow', 'bg-primary-container')}${tape(c)}
  <div class="flex items-center justify-between border-b border-outline-variant pb-2 mb-3">
    <div class="flex items-center gap-2"><span class="text-label-sm font-label-sm text-outline">[CARD 0${c.n}]</span><h3 class="text-headline-sm font-headline-sm text-on-surface tracking-wide">${c.title}</h3></div>
    <span class="px-2 py-0.5 bg-surface-container-low border border-outline-variant text-primary-container text-label-sm font-label-sm font-bold flex items-center gap-1 green-phosphor-glow">
      <span class="material-symbols-outlined text-primary-container" style="font-size:14px;">check</span>[DECRYPTED]</span>
  </div>
  <div class="flex gap-4 items-start mb-4">
    <div class="w-24 h-24 bg-surface-container-lowest border border-outline-variant flex items-center justify-center flex-shrink-0">
      <span class="material-symbols-outlined text-primary-container opacity-80" style="font-size:38px;">${c.icon}</span></div>
    <p class="flex-1 text-body-sm font-body-sm text-on-surface-variant leading-relaxed">&gt; ${c.note}</p>
  </div>
  ${row}
</div>`;
  }

  function truthTable(d) {
    return `<div class="overflow-x-auto"><table class="w-full text-left font-mono text-body-sm border border-outline-variant">
      <thead class="bg-surface-container-highest text-secondary-fixed text-[11px] uppercase"><tr><th class="p-1.5 border-r border-outline-variant">NODE_A</th><th class="p-1.5 border-r border-outline-variant">NODE_B</th><th class="p-1.5">OUT (Q)</th></tr></thead>
      <tbody class="divide-y divide-outline-variant text-[12px] bg-surface-container-lowest">
      ${d.table.map((r, i) => `<tr><td class="p-1.5 border-r border-outline-variant text-outline">${r.A}</td><td class="p-1.5 border-r border-outline-variant text-outline">${r.B}</td><td class="p-1.5 text-primary-container">${d.outputs[i]}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function activeCard(c, s) {
    const p = s.puzzle;
    const isTruth = p && p.puzzle_type === 'truth_table';
    const stageNo = p ? p.stage_no : c.stages[0];
    const status = s.status === 'active' ? 'IN PROGRESS // ACTIVE RECON' : 'SIGNAL LOST';
    const boss = c.n === 4 && stageNo === 4 ? 'FIREWALL ENGAGED' : c.n === 4 ? 'VAULT COMPARATOR' : 'SAMPLING';
    return `
<div class="${c.span} bg-surface-container border-2 border-secondary-container p-5 relative shadow-2xl cyan-phosphor-glow">
  ${pin(c, 'border-secondary-container animate-pulse-cyan', 'bg-secondary-container')}
  <div class="flex items-center justify-between border-b border-outline-variant pb-2 mb-3">
    <div class="flex items-center gap-2"><span class="text-label-sm font-label-sm text-secondary-container">[CARD 0${c.n}]</span><h3 class="text-headline-sm font-headline-sm text-secondary tracking-wide">${c.title}</h3></div>
    <span class="px-2 py-0.5 bg-surface-container-lowest border border-secondary-container text-secondary-container text-label-sm font-label-sm font-bold flex items-center gap-1.5 animate-pulse">
      <span class="inline-block w-2 h-2 rounded-full bg-secondary-container"></span>${status}</span>
  </div>
  <div class="grid grid-cols-1 ${isTruth ? 'md:grid-cols-2' : ''} gap-4 mb-4">
    ${isTruth ? truthTable(p.data) : ''}
    <div class="flex flex-col justify-between bg-surface-container-lowest p-3 border border-outline-variant">
      <div class="space-y-1">
        <div class="text-secondary-fixed text-label-sm font-label-sm">[CHAMBER STATUS: ${boss}]</div>
        <p class="text-on-surface-variant text-[12px] leading-relaxed">${p ? esc(p.question) : ''}</p>
      </div>
      <div class="mt-2 pt-2 border-t border-outline-variant flex items-center justify-between">
        <span class="text-label-sm font-label-sm text-outline">BIT_${stageNo - 1} STATE:</span>
        <span class="text-secondary-container font-headline-sm font-bold animate-pulse">[ ? ] ANALYZING...</span>
      </div>
    </div>
  </div>
  <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
    <div class="flex items-center gap-2 text-label-sm font-label-sm text-outline"><span class="material-symbols-outlined text-secondary-container" style="font-size:16px;">terminal</span><span>PROBE: PHYSICAL BOX PIN 0${c.n}</span></div>
    ${s.status === 'active' ? `<button data-launch class="px-4 py-2 bg-secondary-container text-on-secondary font-headline-sm uppercase text-label-md tracking-wider font-bold hover:bg-secondary-fixed transition-colors flex items-center gap-2 active:scale-95">
      <span class="material-symbols-outlined" style="font-size:18px;">radar</span>[ LAUNCH DECRYPTOR ]</button>` : ''}
  </div>
</div>`;
  }

  function lockedCard(c) {
    return `
<div class="${c.span} bg-surface-container-low border border-outline-variant p-5 relative opacity-85 shadow-2xl">
  ${pin(c, 'border-outline', 'bg-outline').replace('bg-surface-bright', 'bg-surface-container-highest')}
  <div class="flex items-center justify-between border-b border-outline-variant pb-2 mb-3">
    <div class="flex items-center gap-2"><span class="text-label-sm font-label-sm text-outline">[CARD 0${c.n}]</span><h3 class="text-headline-sm font-headline-sm text-on-surface-variant tracking-wide">${c.title}</h3></div>
    <span class="px-2 py-0.5 bg-surface-container-lowest border border-outline-variant text-outline text-label-sm font-label-sm flex items-center gap-1"><span class="material-symbols-outlined text-outline" style="font-size:14px;">lock</span>[ENCRYPTED]</span>
  </div>
  <div class="space-y-2 mb-4">
    <div class="text-on-surface-variant text-[12px]">Clear stage ${c.stages[0] - 1} to decrypt this evidence.</div>
    <div class="h-4 bg-surface-container-lowest border-b border-outline-variant w-full"></div>
    <div class="h-4 bg-surface-container-lowest border-b border-outline-variant w-3/4"></div>
  </div>
  ${resultRow('EXTRACTION TARGET:', '<span class="material-symbols-outlined text-outline align-middle" style="font-size:16px;">lock</span> [ LOCKED ]', 'text-outline')}
</div>`;
  }

  function cardState(c, s) {
    const last = c.stages[c.stages.length - 1];
    if (s.status === 'win' || s.stage > last) return 'solved';
    if (s.stage >= c.stages[0]) return 'active';
    return 'locked';
  }

  // ---------- board pieces ----------
  function renderTracker(s) {
    const box = $('section.bg-surface .max-w-7xl');
    if (!box) return;
    box.innerHTML = STEPS.map((label, i) => {
      const n = i + 1, done = s.status === 'win' || n < s.stage, active = !done && n === s.stage;
      const last = n === 5;
      const chip = done
        ? `<div class="flex items-center gap-1.5 px-2 py-1 bg-surface-container-low border border-outline-variant text-primary-container green-phosphor-glow flex-shrink-0"><span class="material-symbols-outlined text-primary-container" style="font-size:16px;">check_circle</span><span class="text-label-sm font-label-sm hidden sm:inline">${label}</span></div>`
        : active
        ? `<div class="flex items-center gap-1.5 px-2 py-1 bg-surface-container-high border-2 border-secondary-container text-secondary-container animate-pulse-cyan flex-shrink-0"><span class="inline-block w-2 h-2 rounded-full bg-secondary-container"></span><span class="text-label-sm font-label-sm font-bold">${label}</span></div>`
        : `<div class="flex items-center gap-1.5 px-2 py-1 bg-surface-container-lowest border border-outline-variant text-outline opacity-60 flex-shrink-0"><span class="material-symbols-outlined text-outline" style="font-size:16px;">lock</span><span class="text-label-sm font-label-sm hidden md:inline">${label}</span></div>`;
      if (last) return chip;
      return `<div class="flex-1 flex items-center gap-2">${chip}<div class="h-0.5 w-full ${done ? 'bg-primary-container' : 'bg-outline-variant'}"></div></div>`;
    }).join('');
  }

  function renderBoard(s) {
    const grid = $('main > .grid');
    if (!grid) return;
    grid.innerHTML = CARDS.map((c) => ({ solved: solvedCard, active: activeCard, locked: lockedCard }[cardState(c, s)](c, s))).join('');
    drawStrings();
  }

  function drawStrings() {
    const svg = $('main > svg'), main = $('main');
    if (!svg || !main) return;
    const mr = main.getBoundingClientRect();
    const pts = [...document.querySelectorAll('[data-pin]')].map((p) => {
      const r = p.getBoundingClientRect();
      return [r.left + r.width / 2 - mr.left, r.top + r.height / 2 - mr.top];
    });
    if (pts.length < 4) return;
    const links = [[0, 1, '4 2'], [0, 2, ''], [1, 2, '8 3'], [1, 3, ''], [2, 3, '6 2']];
    svg.innerHTML = links.map(([a, b, d]) => {
      const [x1, y1] = pts[a], [x2, y2] = pts[b];
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 + Math.min(70, Math.abs(x2 - x1) / 4 + 24);
      return `<path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" fill="none" stroke="#FF2E4C" stroke-width="2.2" opacity="0.85" ${d ? `stroke-dasharray="${d}"` : ''}/>`;
    }).join('');
  }

  function renderRegister(s) {
    const slots = $('.grid-cols-4');
    if (slots) {
      slots.innerHTML = [1, 2, 3, 4].map((n) => {
        const b = bitOf(s, n), i = n - 1;
        if (b !== null) return `<div class="bg-surface-container-lowest border border-primary-container p-2 flex flex-col items-center justify-center green-phosphor-glow"><span class="text-label-sm font-label-sm text-primary-container font-mono">REG_${i}</span><div class="text-headline-md font-headline-md text-primary-container font-bold my-1">${b}</div><span class="text-[9px] text-primary-container uppercase font-mono">[LOCKED-IN]</span></div>`;
        if (n === s.stage && s.status === 'active') return `<div class="bg-surface-container-lowest border-2 border-secondary-container p-2 flex flex-col items-center justify-center cyan-phosphor-glow"><span class="text-label-sm font-label-sm text-secondary-container font-mono">REG_${i}</span><div class="text-headline-md font-headline-md text-secondary-container font-bold my-1 blink-cursor">_</div><span class="text-[9px] text-secondary-container uppercase font-mono animate-pulse">[AWAITING]</span></div>`;
        return `<div class="bg-surface-container-lowest border border-outline-variant p-2 flex flex-col items-center justify-center opacity-60"><span class="text-label-sm font-label-sm text-outline font-mono">REG_${i}</span><div class="text-headline-md font-headline-md text-outline my-1 flex items-center justify-center"><span class="material-symbols-outlined text-outline" style="font-size:20px;">lock</span></div><span class="text-[9px] text-outline uppercase font-mono">[ENCRYPTED]</span></div>`;
      }).join('');
    }
    const n = s.bits_collected.length;
    set(byText('span', /^BUS SYNCHRONIZATION/), `BUS SYNCHRONIZATION: ${n} / 4 VALIDATED`);
    set(byText('span', /^ENCLAVE:/), `ENCLAVE: 0x${s.session_id.toString(16).toUpperCase()}`);
    const pct = s.status === 'win' ? 100 : Math.round((n / 4) * 100);
    set(byText('span', /READY$/), `${pct}% READY`);
    const bar = $('body > section:last-of-type .bg-primary-container.h-full');
    if (bar) { bar.classList.remove('w-1/2'); bar.style.width = `${pct}%`; }
  }

  function renderHud(s) {
    set(byText('span', /^STAGE \d\d\/\d\d$/), `STAGE ${String(s.stage).padStart(2, '0')}/0${s.total_stages}`);
    set(byText('span', /^BUS: /), `FSM STATE: ${s.fsm_state}`);
    set(byText('div', /^FREQ:/), `SCORE: ${s.score}`);
    const leds = $('.ml-2');
    if (leds) leds.innerHTML = Array.from({ length: s.max_lives }, (_, i) =>
      `<span class="w-2 h-2 rounded-full ${i < s.lives_left ? 'bg-primary-container' : 'bg-surface-variant'}"></span>`).join('');
  }

  function renderHw() {
    const el = byText('span', /HW_VAULT/);
    if (!el) return;
    el.textContent = hwOnline()
      ? `[HW_VAULT: ONLINE // ${hw.fsm_state || '--'} // BITS ${hw.code_bits || '----'}]`
      : '[HW_VAULT: OFFLINE // SOFTWARE MODE]';
  }

  function showResult(s) {
    if (shown) return;
    shown = true;
    const page = RESULT_PAGES[s.status];
    const sm = s.summary || {}, win = s.status === 'win';
    const show = () => {
      const ach = (sm.achievements || []).map((a) => `<span class="px-2 py-0.5 border border-tertiary-fixed-dim text-tertiary-fixed-dim text-label-sm font-label-sm">${esc(a.name)}</span>`).join(' ');
      const el = document.createElement('div');
      el.className = 'fixed inset-0 z-[100] bg-surface-container-lowest/95 flex items-center justify-center p-4';
      el.innerHTML = `<div class="max-w-md w-full bg-surface-container border-2 ${win ? 'border-primary-container green-phosphor-glow' : 'border-error-container'} p-6 text-center space-y-4">
        <div class="text-headline-lg font-headline-lg ${win ? 'text-primary-container' : 'text-error'} tracking-widest">${win ? 'VAULT BREACHED' : 'MISSION FAILED'}</div>
        <div class="text-label-md font-label-md text-on-surface-variant">${REASONS[sm.reason] || ''}</div>
        <div class="grid grid-cols-3 gap-2 text-label-sm font-label-sm">
          <div class="bg-surface-container-lowest border border-outline-variant p-2"><div class="text-outline">SCORE</div><div class="text-primary-container text-label-lg">${sm.score ?? s.score}</div></div>
          <div class="bg-surface-container-lowest border border-outline-variant p-2"><div class="text-outline">XP</div><div class="text-secondary-container text-label-lg">+${sm.xp_earned ?? 0}</div></div>
          <div class="bg-surface-container-lowest border border-outline-variant p-2"><div class="text-outline">TIME</div><div class="text-on-surface text-label-lg">${mmss(sm.time_taken_sec ?? 0)}</div></div>
        </div>
        ${sm.agent ? `<div class="text-label-sm font-label-sm text-outline">RANK: <span class="text-secondary-container">${esc(sm.agent.rank_title.toUpperCase())}</span></div>` : ''}
        <div class="flex flex-wrap justify-center gap-2">${ach}</div>
        <a href="${CASES_PAGE}" class="block w-full py-2.5 bg-primary-container text-on-primary font-headline-sm uppercase tracking-wider font-bold">[ BACK TO CASE FILES ]</a></div>`;
      document.body.appendChild(el);
    };
    if (!page) return show();

location.href = page;
  }

  // ---------- data ----------
  function render(s) {
    snap = s;
    deadline = Date.now() + s.time_left * 1000;
    renderHud(s);
    const key = `${s.status}|${s.stage}|${s.bits_collected.map((b) => b.bit).join('')}`;
    if (key !== boardSig) { boardSig = key; renderTracker(s); renderBoard(s); renderRegister(s); }
    if (s.status !== 'active') showResult(s);
  }

  async function refresh() {
    try {
      render(await Heist.state());
    } catch (e) {
      if (/not found/i.test(e.message)) { sessionStorage.removeItem('session'); location.href = CASES_PAGE; }
      else throw e;
    }
  }

  function tick() {
    if (!snap || !clockEl) return;
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    clockEl.textContent = mmss(left);
    clockEl.classList.toggle('animate-pulse', snap.status === 'active' && left < 60);
    if (left === 0 && snap.status === 'active' && !expiring) { expiring = true; refresh().finally(() => (expiring = false)); }
  }

  function pollHw() {
    fetch('/api/hardware/state').then((r) => r.json()).then((s) => { hw = s; renderHw(); }).catch(() => {});
  }

  async function init() {
    if (!sessionStorage.getItem('session') || !Heist.player()) { location.href = CASES_PAGE; return; }
    clockEl = byText('div', /^\d\d:\d\d:\d\d:\d\d$/);

    // navigation + buttons (event delegation, so re-rendering the board is safe)
    const navs = document.querySelectorAll('nav a');
    if (navs[0]) navs[0].href = CASES_PAGE;           // DECK
    if (navs[3]) navs[3].addEventListener('click', (e) => { e.preventDefault(); go(PUZZLE_PAGE); }); // DECRYPT
    document.addEventListener('click', (e) => { if (e.target.closest('[data-launch]')) go(PUZZLE_PAGE); });
    const sync = $('body > section:last-of-type button');
    if (sync) sync.addEventListener('click', () => toast(hwOnline()
      ? `HARDWARE LINK ONLINE: FSM ${hw.fsm_state || '--'}, BITS ${hw.code_bits || '----'}, COMPARATOR ${hw.comparator ?? '-'}`
      : 'NO HARDWARE LINK. Playing in software mode.'));
    window.addEventListener('resize', drawStrings);
    window.addEventListener('load', drawStrings);

    try { await refresh(); } catch (e) { toast(`CONNECTION ERROR: ${e.message}`); }
    Heist.analytics().then((a) => set($('section.bg-surface-container-low .text-secondary-fixed'), `${a.profile.total_xp.toLocaleString()} total`)).catch(() => {});
    pollHw();
    setInterval(tick, 1000);
    setInterval(() => { refresh().catch(() => {}); pollHw(); }, 5000);
    try {
      Heist.live((m) => {
        if (m.type === 'hardware') { hw = m.state; renderHw(); }
        else if (m.type === 'answer' || m.type === 'session_end') refresh().catch(() => {});
      });
    } catch { /* websocket optional */ }
  }
  init();
})();
