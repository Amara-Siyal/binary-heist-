
(function () {
  'use strict';

  const state = {
    stage: 1,
    lives: 3,
    score: 0,
    time: 300,
    bits: { 8: 0, 4: 0, 2: 0, 1: 0 },
    gate: null,
    over: false,
    busy: false,
    timerId: null,
    lastSync: Date.now()
  };

  let currentPuzzle = null;
  let lastAnswerResult = null;
  let hintRequested = false;

  const $ = (id) => document.getElementById(id);

  function log(message, colorClass) {
    const box = $('log');

    if (!box) {
      console.log('[Binary Heist]', message);
      return;
    }

    const line = document.createElement('div');
    line.className = colorClass || '';
    line.textContent = '> ' + message;
    box.prepend(line);
  }

  function showError(error) {
    log(
      error && error.message
        ? error.message
        : 'Something went wrong.',
      'text-[#FF2E4C]'
    );
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));

    return String(Math.floor(seconds / 60)).padStart(2, '0') +
      ':' + String(seconds % 60).padStart(2, '0');
  }

  function getOutcome(snapshot) {
    if (!snapshot) return 'active';

    const summary = snapshot.summary || {};

    const status = String(snapshot.status || '').toLowerCase();
    const result = String(
      snapshot.result || summary.result || ''
    ).toLowerCase();

    const reason = String(
      snapshot.end_reason ||
      snapshot.reason ||
      summary.reason ||
      summary.end_reason ||
      ''
    ).toLowerCase();

    if (
      ['win', 'won', 'vault_opened'].includes(status) ||
      ['win', 'won', 'vault_opened'].includes(result) ||
      reason === 'vault_opened'
    ) {
      return 'win';
    }

    if (
      [
        'lose', 'loss', 'failed', 'failure',
        'time_expired', 'out_of_lives',
        'player_quit', 'abandoned',
        'hardware_lockdown'
      ].includes(status) ||
      ['lose', 'loss', 'failed', 'failure'].includes(result) ||
      [
        'time_expired', 'out_of_lives',
        'player_quit', 'hardware_lockdown'
      ].includes(reason)
    ) {
      return 'lose';
    }

    if (status === 'finished' || result === 'finished') {
      if (Number(snapshot.stage) > 5) return 'win';
      return 'finished';
    }

    if (Number(snapshot.lives_left ?? state.lives) <= 0) {
      return 'lose';
    }

    if (
      status === 'active' &&
      Number(snapshot.time_left ?? state.time) <= 0
    ) {
      return 'lose';
    }

    return 'active';
  }

  function ensureStatusPanel() {
    if (
      $('timer') &&
      $('lives') &&
      $('score') &&
      $('stage')
    ) return;

    if ($('bhStatus')) return;

    const panel = document.createElement('div');
    panel.id = 'bhStatus';
    panel.className =
      'grid grid-cols-4 gap-2 p-3 mb-3 rounded border ' +
      'border-gray-700 bg-[#0A0E14] text-center';

    panel.innerHTML = `
      <div>
        <div class="text-xs text-gray-400">LIVES</div>
        <div id="lives">3</div>
      </div>
      <div>
        <div class="text-xs text-gray-400">TIME</div>
        <div id="timer">05:00</div>
      </div>
      <div>
        <div class="text-xs text-gray-400">SCORE</div>
        <div id="score">0</div>
      </div>
      <div>
        <div class="text-xs text-gray-400">STAGE</div>
        <div id="stage">1 / 5</div>
      </div>
    `;

    const anchor = $('readout') || $('switches');

    if (anchor && anchor.parentElement) {
      anchor.parentElement.before(panel);
    } else {
      document.body.prepend(panel);
    }
  }

  function renderTimer() {
    const timer = $('timer');
    if (!timer) return;

    timer.textContent = formatTime(state.time);
    timer.classList.toggle('text-[#FF2E4C]', state.time <= 30);
    timer.classList.toggle('text-[#FFB000]', state.time > 30);
  }

  function renderLives() {
    const lives = $('lives');
    if (!lives) return;

    lives.textContent =
      '♥ '.repeat(Math.max(0, state.lives)) +
      '♡ '.repeat(Math.max(0, 3 - state.lives));
  }

  function renderScoreAndStage() {
    if ($('score')) {
      $('score').textContent = state.score.toLocaleString();
    }

    if ($('stage')) {
      $('stage').textContent = state.stage + ' / 5';
    }
  }

  // Update BIN, DEC and HEX without changing the design.
  function renderReadout() {
    const binary = [8, 4, 2, 1]
      .map((weight) => state.bits[weight])
      .join('');

    const decimal = [8, 4, 2, 1].reduce(
      (sum, weight) => sum + state.bits[weight] * weight,
      0
    );

    if ($('readout')) {
      $('readout').textContent =
        `BIN ${binary} | DEC ${decimal} | HEX ${decimal.toString(16).toUpperCase()}`;
    }

    document.querySelectorAll(
      '#switches button[data-val], #switches button[data-weight]'
    ).forEach((button) => {
      const weight = Number(button.dataset.weight || button.dataset.val);
      if (![8, 4, 2, 1].includes(weight)) return;

      const active = state.bits[weight] === 1;

      button.dataset.state = active ? '1' : '0';
      button.setAttribute('aria-pressed', String(active));
    });
  }

  // Reset switch appearance AND internal values for every new stage.
  // Keep data-val/data-weight unchanged because they identify 8, 4, 2 and 1.
  function resetSwitches() {
    state.bits = { 8: 0, 4: 0, 2: 0, 1: 0 };

    document.querySelectorAll(
      '#switches button[data-val], #switches button[data-weight]'
    ).forEach((button) => {
      const weight = Number(button.dataset.weight || button.dataset.val);

      // Reset only valid binary switches.
      if (![8, 4, 2, 1].includes(weight)) return;

      button.dataset.state = '0';
      button.setAttribute('aria-pressed', 'false');

      // Remove the actual ON styling used by toggleSwitch().
      button.classList.remove(
        'border-[#39FF14]',
        'shadow-neon-green'
      );

      // Restore the original OFF border styling.
      button.classList.add('border-gray-700');

      // Reset the small 0/1 indicator inside the switch.
      const indicator = button.querySelector('.state-indicator');

      if (indicator) {
        indicator.textContent = '0';

        indicator.classList.remove(
          'bg-[#39FF14]',
          'border-[#39FF14]',
          'text-black',
          'shadow-neon-green'
        );

        indicator.classList.add(
          'bg-[#182230]',
          'border-gray-600',
          'text-gray-400'
        );
      }

      // Reset ON/OFF text without changing its layout.
      const label = button.querySelector('.status-lbl');

      if (label) {
        label.textContent = 'OFF';

        label.classList.remove('text-[#39FF14]');
        label.classList.add('text-gray-500');
      }

      // Clear inline colours if any earlier code added them.
      button.style.backgroundColor = '';
      button.style.borderColor = '';
      button.style.boxShadow = '';
    });

    // Refresh BIN, DEC, HEX display after resetting.
    renderReadout();
  }

  function renderSlots(snapshot) {
    const slots = $('slots');
    if (!slots || !snapshot) return;

    const collected = Array.isArray(snapshot.bits_collected)
      ? snapshot.bits_collected
      : [];

    slots.replaceChildren();

    collected.slice(-4).forEach((item) => {
      const value = item && typeof item === 'object'
        ? (item.bit ?? '?')
        : item;

      const slot = document.createElement('div');

      slot.className =
        'p-2 text-center border border-gray-700 rounded text-[#39FF14]';

      slot.textContent = String(value);
      slots.appendChild(slot);
    });

    if ($('slotCount')) {
      $('slotCount').textContent = `${collected.length} RECOVERED`;
    }
  }

  function getQuestionText(puzzle) {
    return puzzle.question ||
      puzzle.clue ||
      puzzle.concept ||
      'Read the puzzle and submit your answer.';
  }

  function renderGates() {
    document.querySelectorAll('#gates [data-gate]').forEach((button) => {
      const selected =
        String(button.dataset.gate).toUpperCase() === state.gate;

      button.classList.remove(
        'bg-cyan-400',
        'text-black',
        'border-cyan-300',
        'phosphor-cyan',
        'border-noir-cyan'
      );

      button.classList.toggle('bg-cyan-400', selected);
      button.classList.toggle('text-black', selected);
      button.classList.toggle('border-cyan-300', selected);
      button.classList.toggle('text-cyan-300', !selected);

      button.setAttribute('aria-pressed', String(selected));
    });
  }

 
function ensureGateButtons() {
  const panel = $('gates');
  if (!panel) return;

  const symbols = {
    AND: `
      <svg viewBox="0 0 64 40" class="w-12 h-8" aria-label="AND gate symbol">
        <path d="M8 5 V35 H28 A15 15 0 0 0 28 5 Z"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
        <path d="M0 12 H8 M0 28 H8 M43 20 H63"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
      </svg>`,
    OR: `
      <svg viewBox="0 0 64 40" class="w-12 h-8" aria-label="OR gate symbol">
        <path d="M8 5 Q22 20 8 35 Q34 35 48 20 Q34 5 8 5 Z"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
        <path d="M0 12 L15 12 M0 28 L15 28 M48 20 H63"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
      </svg>`,
    NOT: `
      <svg viewBox="0 0 64 40" class="w-12 h-8" aria-label="NOT gate symbol">
        <path d="M10 5 L10 35 L43 20 Z"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
        <circle cx="48" cy="20" r="4" fill="none"
          stroke="currentColor" stroke-width="2.5"/>
        <path d="M0 20 H10 M52 20 H63"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
      </svg>`,
    NAND: `
      <svg viewBox="0 0 64 40" class="w-12 h-8" aria-label="NAND gate symbol">
        <path d="M5 5 V35 H25 A15 15 0 0 0 25 5 Z"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
        <circle cx="45" cy="20" r="4" fill="none"
          stroke="currentColor" stroke-width="2.5"/>
        <path d="M0 12 H5 M0 28 H5 M49 20 H63"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
      </svg>`,
    NOR: `
      <svg viewBox="0 0 64 40" class="w-12 h-8" aria-label="NOR gate symbol">
        <path d="M5 5 Q19 20 5 35 Q31 35 42 20 Q31 5 5 5 Z"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
        <circle cx="46" cy="20" r="4" fill="none"
          stroke="currentColor" stroke-width="2.5"/>
        <path d="M0 12 H12 M0 28 H12 M50 20 H63"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
      </svg>`,
    XOR: `
      <svg viewBox="0 0 64 40" class="w-12 h-8" aria-label="XOR gate symbol">
        <path d="M2 5 Q16 20 2 35 M9 5 Q23 20 9 35 Q35 35 49 20 Q35 5 9 5 Z"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
        <path d="M0 12 H15 M0 28 H15 M49 20 H63"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
      </svg>`,
    XNOR: `
      <svg viewBox="0 0 64 40" class="w-12 h-8" aria-label="XNOR gate symbol">
        <path d="M0 5 Q14 20 0 35 M7 5 Q21 20 7 35 Q33 35 44 20 Q33 5 7 5 Z"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
        <circle cx="48" cy="20" r="4" fill="none"
          stroke="currentColor" stroke-width="2.5"/>
        <path d="M0 12 H13 M0 28 H13 M52 20 H63"
          fill="none" stroke="currentColor" stroke-width="2.5"/>
      </svg>`
  };

  const gates = ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR'];

  gates.forEach((gate) => {
    let button = panel.querySelector(`[data-gate="${gate}"]`);

    if (!button) {
      const container =
        panel.querySelector('.grid') || panel;

      button = document.createElement('button');
      button.type = 'button';
      button.dataset.gate = gate;
      button.className =
        'gate-btn p-1.5 rounded bg-[#0A0E14] border border-gray-700 ' +
        'text-gray-300 hover:border-[#39FF14] hover:text-[#39FF14] ' +
        'flex flex-col items-center';
      container.appendChild(button);
    }

    // Keep each existing button's original design classes.
    button.innerHTML = `
      ${symbols[gate]}
      <span class="text-[9px] font-bold mt-1">${gate}</span>
    `;

    button.type = 'button';

    if (button.dataset.puzzleGateBound !== 'true') {
      button.dataset.puzzleGateBound = 'true';

      button.addEventListener('click', () => {
        if (state.busy || state.over) return;

        state.gate = gate;
        renderGates();
      });
    }
  });

  renderGates();
}


  function renderPuzzle(puzzle) {
    if (!puzzle) return;

    // IMPORTANT: store the current puzzle so answer submission works.
    currentPuzzle = puzzle;

    state.stage = Number(puzzle.stage_no || state.stage);

    if ($('concept')) {
      $('concept').textContent = puzzle.concept || 'Logic Puzzle';
    }

    if ($('clue')) {
      $('clue').textContent = getQuestionText(puzzle);
    }

    // Reset all switches and their coloured indicators.
    resetSwitches();

    // Reset the selected logic gate for the new stage.
    state.gate = null;
    renderGates();

    // Show or hide the switch panel based on the puzzle input type.
    const switchPanel = $('switchPanel');

    if (switchPanel) {
      switchPanel.style.display =
        ['bits4', 'bits2', 'bits1'].includes(puzzle.input_mode)
          ? ''
          : 'none';
    }

    // Show gates only for the truth-table stage.
    
const gates = $('gates');

if (gates) {
  if (puzzle.input_mode === 'gate') {
    gates.style.display = 'block';
    gates.classList.remove('hidden');

    ensureGateButtons();
    renderGates();
  } else {
    gates.style.display = 'none';
  }
}

renderScoreAndStage();

  }

  function toggleSwitch(button, weight) {
    weight = Number(weight || (button && (
      button.dataset.weight || button.dataset.val
    )));

    if (![8, 4, 2, 1].includes(weight) || state.busy || state.over) {
      return;
    }

    state.bits[weight] = state.bits[weight] === 1 ? 0 : 1;

    const isOn = state.bits[weight] === 1;

    if (button) {
      button.dataset.state = isOn ? '1' : '0';
      button.setAttribute('aria-pressed', String(isOn));

      // Preserve the existing neon-green ON design.
      button.classList.toggle('border-[#39FF14]', isOn);
      button.classList.toggle('shadow-neon-green', isOn);
      button.classList.toggle('border-gray-700', !isOn);

      const indicator = button.querySelector('.state-indicator');

      if (indicator) {
        indicator.textContent = isOn ? '1' : '0';

        indicator.classList.toggle('bg-[#39FF14]', isOn);
        indicator.classList.toggle('border-[#39FF14]', isOn);
        indicator.classList.toggle('text-black', isOn);
        indicator.classList.toggle('shadow-neon-green', isOn);

        indicator.classList.toggle('bg-[#182230]', !isOn);
        indicator.classList.toggle('border-gray-600', !isOn);
        indicator.classList.toggle('text-gray-400', !isOn);
      }

      const label = button.querySelector('.status-lbl');

      if (label) {
        label.textContent = isOn ? 'ON' : 'OFF';
        label.classList.toggle('text-[#39FF14]', isOn);
        label.classList.toggle('text-gray-500', !isOn);
      }
    }

    renderReadout();
  }

  function answerFromInputs() {
    if (!currentPuzzle) return '';

    if (currentPuzzle.input_mode === 'gate') {
      return state.gate || '';
    }

    if (currentPuzzle.input_mode === 'bits1') {
      return String(state.bits[1]);
    }

    if (currentPuzzle.input_mode === 'bits2') {
      return `${state.bits[2]}${state.bits[1]}`;
    }

    return [8, 4, 2, 1]
      .map((weight) => state.bits[weight])
      .join('');
  }

  function syncBackend(snapshot) {
    if (!snapshot) return;

    state.stage = Number(snapshot.stage || state.stage || 1);
    state.lives = Number(snapshot.lives_left ?? state.lives);
    state.score = Number(snapshot.score ?? state.score);
    state.time = Number(snapshot.time_left ?? state.time);

    state.over = [
      'finished',
      'abandoned',
      'win',
      'lose',
      'time_expired',
      'out_of_lives',
      'player_quit',
      'vault_opened'
    ].includes(String(snapshot.status || '').toLowerCase());

    state.lastSync = Date.now();

    renderTimer();
    renderLives();
    renderScoreAndStage();
    renderSlots(snapshot);
  }

  async function refreshState() {
    if (state.busy || state.over) return;

    try {
      const previousPuzzleStage = currentPuzzle
        ? Number(currentPuzzle.stage_no)
        : null;

      const snapshot = await Heist.state();

      const newPuzzleStage = snapshot.puzzle
        ? Number(snapshot.puzzle.stage_no)
        : null;

      syncBackend(snapshot);

      const outcome = getOutcome(snapshot);

      if (outcome === 'win') {
        finishGame(true);
      } else if (
        outcome === 'lose' ||
        outcome === 'finished'
      ) {
        finishGame(false);
      } else if (
        snapshot.puzzle &&
        (
          !currentPuzzle ||
          previousPuzzleStage !== newPuzzleStage
        )
      ) {
        renderPuzzle(snapshot.puzzle);
      }
    } catch (_) {
      log(
        'Unable to refresh game state from the server.',
        'text-[#FF2E4C]'
      );
    }
  }

  function startTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = setInterval(refreshState, 1000);
  }

  async function submitAnswer() {
    if (state.over || state.busy || !currentPuzzle) return;

    const answer = answerFromInputs();

    if (answer === '') {
      log('Select an answer before submitting.', 'text-[#FFB000]');
      return;
    }

    state.busy = true;

    const submitButton = $('submitBtn');
    if (submitButton) submitButton.disabled = true;

    try {
      const result = await Heist.answer(answer);
      lastAnswerResult = result;

      let snapshot = result;

      try {
        snapshot = await Heist.state();
      } catch (_) {}

      syncBackend(snapshot);

      const outcome = getOutcome(snapshot);

      if (outcome === 'lose') {
        finishGame(false);
        return;
      }

      if (outcome === 'win') {
        finishGame(true);
        return;
      }

      if (outcome === 'finished') {
        finishGame(false);
        return;
      }

      if (result.correct) {
        log(
          'Correct answer. Server verified it.',
          'text-[#39FF14] font-semibold'
        );

        if ($('notes')) {
          $('notes').classList.remove('hidden');
        }

        if ($('notesCode')) {
          $('notesCode').textContent = `STAGE ${state.stage}`;
        }

        if ($('notesBody')) {
          $('notesBody').textContent =
            result.explanation ||
            'Answer verified by the server.';
        }

        if ($('notesBit')) {
          $('notesBit').textContent =
            result.revealed_bit == null
              ? 'NO BIT AWARDED'
              : `CAPTURED BIT = ${result.revealed_bit}`;
        }

        if ($('notesReward')) {
          $('notesReward').textContent =
            result.gain_popup != null
              ? `+${result.gain_popup} PTS`
              : `${state.score.toLocaleString()} PTS`;
        }

       if ($('nextLbl')) {
  $('nextLbl').textContent = 'RETURN TO EVIDENCE BOARD';
}
      } else {
        log(
          'Incorrect answer. The server rejected it.',
          'text-[#FF2E4C]'
        );

        const panel = $('answerPanel');

        if (panel) {
          panel.classList.remove('shake');
          void panel.offsetWidth;
          panel.classList.add('shake');
        }

        if (state.lives <= 0 || state.time <= 0) {
          finishGame(false);
        }
      }
    } catch (error) {
      showError(error);

      try {
        const snapshot = await Heist.state();
        syncBackend(snapshot);

        const outcome = getOutcome(snapshot);

        if (outcome === 'lose' || outcome === 'finished') {
          finishGame(false);
        } else if (outcome === 'win') {
          finishGame(true);
        }
      } catch (_) {}
    } finally {
      state.busy = false;

      if (submitButton && !state.over) {
        submitButton.disabled = false;
      }
    }
  }

  async function showHint() {
    if (
      state.over ||
      state.busy ||
      hintRequested ||
      !currentPuzzle
    ) return;

    state.busy = true;

    try {
      const result = await Heist.hint();
      hintRequested = true;

      if ($('hintText')) {
        $('hintText').textContent =
          result.hint || 'Hint received from the server.';

        $('hintText').classList.add('text-[#FFB000]');
      }

      if (typeof result.time_left === 'number') {
        state.time = result.time_left;
        renderTimer();
      } else {
        await refreshState();
      }

      if (state.time <= 0 || state.lives <= 0) {
        finishGame(false);
        return;
      }

      log(
        'Hint requested. Server applied the relevant penalty.',
        'text-[#FFB000]'
      );
    } catch (error) {
      showError(error);
    } finally {
      state.busy = false;
    }
  }

  
async function closeNotes() {
  try {
    const snapshot = await Heist.state();
    syncBackend(snapshot);

    const outcome = getOutcome(snapshot);

    if (outcome === 'lose') {
      window.location.href = '/failure.html';
      return;
    }

    if (outcome === 'win') {
      window.location.href = '/victory.html';
      return;
    }

    if (outcome === 'finished') {
      window.location.href = '/failure.html';
      return;
    }

    // Current stage successfully clear ho chuka hai.
    // Evidence Board par wapas jao.
    window.location.href = '/evidence.html';
  } catch (error) {
    showError(error);
  }
}


  function finishGame(won) {
    state.over = true;

    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }

    const heading = $('notesHeading');
    const body = $('notesText') || $('notesBody');
    const stage = $('notesStage');
    const score = $('notesScore');
    const nextButton = $('nextBtn');

    if ($('notes')) {
      $('notes').classList.remove('hidden');
    }

    if (heading) {
      heading.textContent = won
        ? 'MISSION COMPLETE'
        : 'MISSION FAILED';
    }

    if (body) {
      body.textContent = won
        ? 'Vault unlocked. You completed the mission successfully.'
        : 'All lives are exhausted or the mission timer has expired. Your mission has ended.';
    }

    if (stage) {
      stage.textContent = won
        ? 'MISSION CLEARED'
        : 'MISSION FAILED';
    }

    if (score) {
      score.textContent = state.score.toLocaleString();
    }

    if ($('notesCode')) {
      $('notesCode').textContent =
        won ? 'MISSION CLEARED' : 'MISSION FAILED';
    }

    if ($('notesBit')) {
      $('notesBit').textContent = 'SESSION ENDED';
    }

    if ($('notesReward')) {
      $('notesReward').textContent =
        `${state.score.toLocaleString()} PTS`;
    }

    if ($('nextLbl')) {
      $('nextLbl').textContent = won
        ? 'VIEW VICTORY REPORT'
        : 'VIEW FAILURE REPORT';
    }

    log(
      won ? 'MISSION COMPLETE.' : 'MISSION FAILED.',
      won ? 'text-[#39FF14]' : 'text-[#FF2E4C]'
    );

    if (nextButton) {
      nextButton.textContent = won
        ? 'VIEW VICTORY REPORT'
        : 'VIEW FAILURE REPORT';

      nextButton.onclick = function () {
        window.location.href = won
          ? '/victory.html'
          : '/failure.html';
      };
    }

    if ($('submitBtn')) $('submitBtn').disabled = true;
    if ($('hintBtn')) $('hintBtn').disabled = true;
  }

  window.toggleSwitch = toggleSwitch;
  window.showHint = showHint;
  window.simulateSubmit = submitAnswer;
  window.closeNotes = closeNotes;

  function bindButton(id, handler) {
    const button = $(id);
    if (!button || button.getAttribute('onclick')) return;

    if (button.dataset.puzzleBound === 'true') return;

    button.dataset.puzzleBound = 'true';
    button.addEventListener('click', handler);
  }

  function init() {
    document.querySelectorAll(
      '#switches button[data-val], #switches button[data-weight]'
    ).forEach((button) => {
      if (button.getAttribute('onclick')) return;
      if (button.dataset.switchBound === 'true') return;

      button.dataset.switchBound = 'true';

      button.addEventListener('click', () => {
        toggleSwitch(
          button,
          button.dataset.weight || button.dataset.val
        );
      });
    });

    ensureStatusPanel();
    ensureGateButtons();

    bindButton('submitBtn', submitAnswer);
    bindButton('hintBtn', showHint);
    bindButton('nextBtn', closeNotes);

    Heist.state()
      .then((snapshot) => {
        syncBackend(snapshot);

        const outcome = getOutcome(snapshot);

        if (outcome === 'win') {
          finishGame(true);
        } else if (
          outcome === 'lose' ||
          outcome === 'finished'
        ) {
          finishGame(false);
        } else {
          if (snapshot.puzzle) {
            renderPuzzle(snapshot.puzzle);
          }

          startTimer();
        }
      })
      .catch(showError);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
