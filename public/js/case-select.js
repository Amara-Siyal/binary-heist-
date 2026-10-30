// Case Select controller. Works on the Stitch "Dossier Archive" page with NO HTML edits.
// Needs /js/heist-api.js loaded first.
(() => {
  const LOCKING = false;            // true = case N unlocks only after you win case N-1
  const PUZZLE_PAGE = '/evidence.html'; // page opened after ACCEPT CASE // page opened after ACCEPT CASE

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  const CHIP = ['text-primary-container', 'text-secondary-container', 'text-tertiary-fixed-dim'];

  const META = {
    easy:   { label: 'EASY',   tier: 'TIER 1', target: 'NEO-SHINJUKU',       color: 'text-primary-container',   tab: 'bg-primary-container text-surface-container-lowest', gates: ['AND', 'OR', 'NOT', 'XOR'] },
    medium: { label: 'MEDIUM', tier: 'TIER 2', target: 'GINKO TOWER 14F',    color: 'text-secondary-container', tab: 'bg-surface-variant text-on-surface',                 gates: ['AND', 'OR', 'NOT', 'XOR', 'NAND'] },
    hard:   { label: 'HARD',   tier: 'TIER 3', target: 'CENTRAL CITADEL GRID', color: 'text-error',             tab: 'bg-error-container text-error',                      gates: ['XOR', 'XNOR', 'NAND', 'FULL ADDER'] },
  };

  let cases = [], won = new Set(), selectedId = null;
  const list = () => $('main > div.space-y-3');

  function fillProfile(p) {
    const sec = $('main > section:first-of-type');
    if (!sec) return;
    const set = (el, t) => { if (el) el.textContent = t; };
    set($('.tracking-wide', sec), p.agent_name.toUpperCase());
    set($('span.text-secondary-container', sec), p.rank_title.toUpperCase());
    set($('.text-right .text-primary-container', sec), `${p.cases_solved} CASE${p.cases_solved === 1 ? '' : 'S'} SOLVED`);
    const pct = p.next_rank_xp ? Math.min(100, Math.floor((100 * p.total_xp) / p.next_rank_xp)) : 100;
    set($('.space-y-1 > div > span:last-child', sec),
      p.next_rank_xp ? `${p.total_xp.toLocaleString()} / ${p.next_rank_xp.toLocaleString()} XP [${pct}%]` : `${p.total_xp.toLocaleString()} XP [MAX RANK]`);
    const bar = $('.grid-cols-10', sec);
    if (bar) {
      const on = Math.round(pct / 10);
      bar.innerHTML = Array.from({ length: 10 }, (_, i) =>
        i < on ? '<div class="bg-secondary-container phosphor-glow-cyan h-full"></div>' : '<div class="bg-surface-variant h-full"></div>').join('');
    }
  }

  const isLocked = (c, i) => LOCKING && i > 0 && !won.has(cases[i - 1].case_id);

  function selectedCard(c, i) {
    const m = META[c.difficulty], done = won.has(c.case_id);
    return `
<article class="bg-surface-container-low border-2 border-primary-container p-3 relative clip-chamfer-sm phosphor-glow-green transition-all">
  <div class="absolute -top-3 left-4 bg-primary-container text-surface-container-lowest font-label-sm text-label-sm font-bold px-2 py-0.5 clip-chamfer-tab flex items-center space-x-1">
    <span class="material-symbols-outlined text-xs">attach_file</span><span>SEC-A0${c.case_id} // DOSSIER ACTIVE</span>
  </div>
  <div class="flex justify-between items-start pt-1.5 mb-2">
    <div>
      <div class="flex items-center space-x-2">
        <h2 class="font-headline-md text-headline-md text-primary font-bold tracking-tight">${esc(c.title.toUpperCase())}</h2>
        <span class="inline-block border border-tertiary-fixed-dim text-tertiary-fixed-dim font-label-sm text-label-sm px-1.5 rotate-[-4deg] tracking-widest font-bold">${done ? 'SOLVED' : 'NEW'}</span>
      </div>
      <div class="flex items-center space-x-2 mt-1">
        <span class="bg-surface-container-lowest border border-outline-variant ${m.color} font-label-sm text-label-sm px-2 py-0.5">${m.label} // ${m.tier}</span>
        <span class="font-label-sm text-label-sm text-outline">TARGET: ${m.target}</span>
      </div>
    </div>
    <div class="w-5 h-5 border border-primary-container bg-surface-container-lowest flex items-center justify-center text-primary-container"><span class="text-xs">■</span></div>
  </div>
  <div class="grid grid-cols-3 gap-1.5 bg-surface-container-lowest border border-outline-variant p-2 mb-3">
    <div class="text-center border-r border-outline-variant"><div class="font-label-sm text-label-sm text-outline">TIME ALLOTTED</div><div class="font-label-md text-label-md text-on-surface font-semibold">${mmss(c.time_limit_sec)} MIN</div></div>
    <div class="text-center border-r border-outline-variant"><div class="font-label-sm text-label-sm text-outline">LIVES</div><div class="font-label-md text-label-md text-primary-container font-semibold">${c.lives}</div></div>
    <div class="text-center"><div class="font-label-sm text-label-sm text-outline">STAGES</div><div class="font-label-md text-label-md text-secondary-container font-semibold">5</div></div>
  </div>
  <div class="border-t border-dashed border-outline-variant pt-3 space-y-3">
    <div class="bg-surface-container-lowest p-2.5 border border-outline-variant">
      <div class="font-label-sm text-label-sm text-secondary-container mb-1 tracking-wider flex items-center justify-between"><span>CASE BRIEFING // INCIDENT_0${c.case_id}01</span><span class="text-tertiary-fixed-dim">CONFIDENTIAL</span></div>
      <p class="font-body-sm text-body-sm text-on-surface leading-relaxed">${esc(c.story)}</p>
    </div>
    <div class="bg-surface-container p-2 border border-outline-variant flex items-center justify-between">
      <span class="font-label-sm text-label-sm text-on-surface-variant">REQ LOGIC GATES:</span>
      <div class="flex items-center flex-wrap gap-1.5 font-label-sm text-label-sm justify-end">
        ${m.gates.map((g, k) => `<span class="px-1.5 py-0.5 bg-surface-container-lowest border border-outline-variant ${CHIP[k % 3]} font-bold">${g}</span>`).join('')}
      </div>
    </div>
    <div class="pt-1">
      <button data-accept="${c.case_id}" class="w-full py-2.5 bg-primary-container text-surface-container-lowest font-headline-sm text-headline-sm font-bold tracking-wider uppercase flare-action transition-all flex items-center justify-center space-x-2 active:scale-95">
        <span class="material-symbols-outlined text-lg">terminal</span><span>[ ACCEPT CASE &amp; INITIALIZE ]</span>
      </button>
    </div>
  </div>
</article>`;
  }

  function compactCard(c, i) {
    const m = META[c.difficulty], locked = isLocked(c, i), done = won.has(c.case_id);
    const stamp = locked ? 'LOCKED' : done ? 'SOLVED' : 'OPEN';
    return `
<article ${locked ? '' : `data-select="${c.case_id}"`} class="bg-surface-container border border-outline-variant p-3 relative clip-chamfer-sm ${locked ? 'opacity-75' : 'opacity-90 hover:opacity-100 cursor-pointer'} transition-opacity">
  <div class="absolute -top-3 left-4 ${m.tab} font-label-sm text-label-sm px-2 py-0.5 clip-chamfer-tab flex items-center space-x-1">
    <span class="material-symbols-outlined text-xs">${locked ? 'lock' : 'folder'}</span><span>SEC-${m.label[0]}0${c.case_id} // ${locked ? 'ARCHIVE' : 'DOSSIER'}</span>
  </div>
  <div class="flex justify-between items-start pt-1.5 mb-2">
    <div>
      <div class="flex items-center space-x-2">
        <h2 class="font-headline-md text-headline-md text-on-surface font-bold tracking-tight">${esc(c.title.toUpperCase())}</h2>
        <span class="border border-outline-variant ${m.color} font-label-sm text-label-sm px-1.5 tracking-wider">${stamp}</span>
      </div>
      <div class="flex items-center space-x-2 mt-1">
        <span class="bg-surface-container-lowest border border-outline-variant ${m.color} font-label-sm text-label-sm px-2 py-0.5">${m.label} // ${m.tier}</span>
        <span class="font-label-sm text-label-sm text-outline">TARGET: ${m.target}</span>
      </div>
    </div>
    <div class="w-5 h-5 border border-outline-variant bg-surface-container-lowest flex items-center justify-center text-outline"><span class="material-symbols-outlined text-xs">${locked ? 'lock' : 'chevron_right'}</span></div>
  </div>
  <div class="grid grid-cols-3 gap-1.5 bg-surface-container-lowest border border-outline-variant p-2">
    <div class="text-center border-r border-outline-variant font-label-sm text-label-sm text-outline">TIME: ${mmss(c.time_limit_sec)}</div>
    <div class="text-center border-r border-outline-variant font-label-sm text-label-sm text-outline">LIVES: ${c.lives}</div>
    <div class="text-center font-label-sm text-label-sm ${m.color}">5 STAGES</div>
  </div>
  ${locked ? `<div class="flex items-center space-x-1 text-outline font-label-sm text-label-sm px-1 pt-2"><span class="material-symbols-outlined text-xs">key_off</span><span>COMPLETE CASE 0${i} TO UNLOCK</span></div>` : ''}
</article>`;
  }

  function render() {
    list().innerHTML = cases.map((c, i) => (c.case_id === selectedId ? selectedCard(c, i) : compactCard(c, i))).join('');
    const count = $('main > div.flex.items-center.justify-between span.text-outline');
    if (count) count.textContent = `${cases.length} CASES TOTAL`;
  }

  async function accept(btn) {
    const id = +btn.dataset.accept;
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>[ INITIALIZING... ]</span>';
    try {
      const s = await Heist.start(id);
      const exists = await fetch(PUZZLE_PAGE, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
      if (exists) { location.href = PUZZLE_PAGE; return; }
      alert(`Case started! (session ${s.session_id}, ${s.time_left}s, ${s.lives_left} lives)\n\nStage 1: ${s.puzzle.question}\n\nThe puzzle screen is not added yet.`);
    } catch (e) {
      alert(e.message);
    }
    btn.disabled = false;
    btn.innerHTML = label;
  }

  async function init() {
    if (!Heist.player()) { location.href = '/'; return; }
    try {
      const [cs, an] = await Promise.all([Heist.cases(), Heist.analytics()]);
      cases = cs;
      won = new Set(an.score_history.filter((h) => h.result === 'win').map((h) => h.case_id));
      fillProfile(an.profile);
      const firstOpen = cases.find((c, i) => !isLocked(c, i)) || cases[0];
      selectedId = firstOpen.case_id;
      render();
      list().addEventListener('click', (e) => {
        const acc = e.target.closest('[data-accept]');
        if (acc) return accept(acc);
        const sel = e.target.closest('[data-select]');
        if (sel) { selectedId = +sel.dataset.select; render(); }
      });
    } catch (e) {
      list().innerHTML = `<div class="border border-error-container text-error p-3 font-body-sm">CONNECTION ERROR: ${esc(e.message)}. Is the server running?</div>`;
    }
  }
       // VERSUS MODE entry button (shown under the case list)
     const vsBtn = document.createElement('a');
     vsBtn.href = '/versus.html';
     vsBtn.className = 'block w-full text-center py-3 border-2 border-error text-error font-headline-sm text-headline-sm font-bold tracking-wider uppercase hover:bg-error/10 active:scale-95 transition-all';
     vsBtn.textContent = '[ VERSUS MODE // 1V1 ONLINE ]';
     const caseList = document.querySelector('main > div.space-y-3');
     if (caseList) caseList.insertAdjacentElement('afterend', vsBtn);
  init();

})();
