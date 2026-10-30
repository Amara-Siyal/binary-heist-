
(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const setText = (selector, value) => {
    const element = $(selector);
    if (element) element.textContent = value;
  };

  const formatNumber = (value) =>
    Number(value || 0).toLocaleString();

  const formatTime = (seconds) => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = String(Math.floor(total / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const secs = String(total % 60).padStart(2, '0');

    return `${hours}:${minutes}:${secs}`;
  };

  function addLog(container, message, type = 'normal') {
    const line = document.createElement('p');

    line.className =
      type === 'error'
        ? 'text-error font-medium'
        : type === 'success'
          ? 'text-primary-container'
          : 'text-on-surface-variant';

    line.textContent = `> ${message}`;
    container.appendChild(line);
  }

  function findTextElement(text) {
    return $$('span, div, p').find(
      (element) =>
        element.children.length === 0 &&
        element.textContent.trim() === text
    );
  }

  function updateTextContaining(oldText, newText) {
    const element = findTextElement(oldText);
    if (element) element.textContent = newText;
  }

  function updateTimer(seconds) {
    const timer = $$('div').find((element) =>
      element.classList.contains('font-label-lg') &&
      element.classList.contains('tracking-widest') &&
      element.textContent.includes('00:00:00')
    );

    if (timer) {
      timer.textContent = formatTime(seconds);
    }
  }

  function updateLives(data) {
    const lives = Number(data.lives_left ?? 0);
    const maxLives = Number(data.max_lives ?? 3);

    updateTextContaining('0/3 LIVES', `${lives}/${maxLives} LIVES`);

    const label = $$('span').find((element) =>
      /^\d+\s*\/\s*\d+\s*LIVES$/i.test(element.textContent.trim())
    );

    if (label) {
      label.textContent = `${lives}/${maxLives} LIVES`;
    }

    const indicators = $$('.flex.items-center.gap-1\\.5 > div');

    indicators.forEach((indicator, index) => {
      const alive = index < lives;

      indicator.classList.toggle('bg-error', !alive);
      indicator.classList.toggle('bg-primary-container', alive);
      indicator.classList.toggle('animate-red-pulse', !alive);
      indicator.classList.toggle('border-error', !alive);
      indicator.classList.toggle('border-primary-container', alive);
    });
  }

  function updateStage(data) {
    const stage = Number(data.stage || 1);
    const total = Number(data.total_stages || 5);

    const vector = $$('span').find((element) =>
      element.textContent.trim().startsWith('TERMINATED AT: STAGE')
    );

    if (vector) {
      vector.textContent =
        `TERMINATED AT: STAGE ${String(stage).padStart(2, '0')} / ${String(total).padStart(2, '0')} [SESSION TERMINATED]`;
    }
  }

  function updateReason(data, report) {
    const lives = Number(data.lives_left ?? 0);
    const reason = report.summary?.reason || 'session_terminated';

    let explanation = 'SESSION TERMINATED';

    if (reason === 'time_expired') {
      explanation = 'TIME LIMIT EXPIRED';
    } else if (reason === 'out_of_lives') {
      explanation = 'ALL LIVES DEPLETED';
    } else if (reason === 'hardware_lockdown') {
      explanation = 'HARDWARE LOCKDOWN';
    } else if (reason === 'player_quit') {
      explanation = 'SESSION ABANDONED';
    }

    setText('#failure-reason',
      `[ FAILURE VECTOR: ${explanation} // ${lives} LIVES REMAINING ]`
    );

    setText('#termination-cause', explanation);
  }

  function updateBounty(score) {
    const amount = formatNumber(score);

    const bountyLabel = $$('span').find((element) =>
      element.textContent.trim() === 'BOUNTY FORFEITED:'
    );

    if (bountyLabel?.parentElement) {
      const value = bountyLabel.parentElement.querySelector(
        'span:last-child'
      );

      if (value) value.textContent = `${amount} PTS`;
    }
  }

  function updateIncidentLog(attempts, report) {
    const log = $('#incident-log');
    if (!log) return;

    log.replaceChildren();

    addLog(log, `SESSION ${report.session.session_id} REPORT LOADED`);

    if (!attempts.length) {
      addLog(log, 'No recorded answers found for this session.');
    }

    attempts.forEach((attempt) => {
      const result = Number(attempt.is_correct) === 1 ? 'CORRECT' : 'INCORRECT';
      const type = result === 'CORRECT' ? 'success' : 'error';

      addLog(
        log,
        `STAGE ${attempt.stage_no} | ${attempt.concept} | ANSWER: ${attempt.player_answer} | ${result}`,
        type
      );
    });

    const wrong = attempts.filter((attempt) => !Number(attempt.is_correct)).length;

    addLog(log, `TOTAL ATTEMPTS: ${attempts.length}`);
    addLog(log, `INCORRECT ANSWERS: ${wrong}`, wrong ? 'error' : 'normal');
    addLog(log, `SESSION RESULT: ${report.summary?.result || 'unknown'}`);
  }

  function updateSkillDiagnostics(concepts) {
    const panels = $$('.space-y-4.mb-5 > div');

    panels.forEach((panel) => {
      const label = panel.querySelector('.font-label-sm');
      const metric = panel.querySelector('.font-label-sm.font-bold, .font-label-sm.font-semibold');
      const bar = panel.querySelector('.h-full');
      const note = panel.querySelector('.font-body-sm');

      if (!label || !metric) return;

      const name = label.textContent.trim().toUpperCase();

      const concept = concepts.find((item) => {
        const actual = String(item.concept || '').toUpperCase();

        if (name.includes('XOR')) return actual.includes('XOR');
        if (name.includes('CARRY')) return actual.includes('CARRY') || actual.includes('ADDER');
        if (name.includes('HEX')) return actual.includes('HEX') || actual.includes('BINARY');
        if (name.includes('TIMING')) return actual.includes('TIMING') || actual.includes('RACE');
        return actual.includes(name);
      });

      if (!concept || !Number(concept.attempts)) {
        metric.textContent = 'UNTESTED';
        if (bar) bar.style.width = '0%';
        if (note) note.textContent = 'No attempts recorded for this concept.';
        return;
      }

      const accuracy = Math.max(0, Math.min(100, Number(concept.accuracy) || 0));

      metric.textContent = `${accuracy}% (${concept.correct}/${concept.attempts})`;
      if (bar) bar.style.width = `${accuracy}%`;
      if (note) {
        note.textContent = `${concept.attempts} attempt(s), ${concept.wrong} incorrect.`;
      }
    });
  }

  function updateTruthTable(report) {
    const table = $('main table tbody');
    if (!table) return;

    const truthPuzzle = report.puzzles.find((puzzle) =>
      puzzle.puzzle_type === 'truth_table'
    );

    if (!truthPuzzle) {
      table.replaceChildren();

      const row = document.createElement('tr');
      const cell = document.createElement('td');

      cell.colSpan = 4;
      cell.className = 'p-3 text-on-surface-variant';
      cell.textContent =
        'No truth-table puzzle was recorded in this session.';

      row.appendChild(cell);
      table.appendChild(row);
      return;
    }

    const attempts = report.attempts.filter(
      (attempt) => attempt.stage_no === truthPuzzle.stage_no
    );

    table.replaceChildren();

    const row = document.createElement('tr');
    row.className = 'border-b border-outline-variant/60';

    const values = [
      `STAGE ${truthPuzzle.stage_no}`,
      truthPuzzle.concept,
      attempts.length
        ? attempts[attempts.length - 1].player_answer
        : 'NO ANSWER',
      attempts.length
        ? (Number(attempts[attempts.length - 1].is_correct) === 1
          ? 'CORRECT'
          : 'INCORRECT')
        : 'UNATTEMPTED'
    ];

    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.className = 'p-2.5';

      if (index === 3) {
        cell.classList.add(
          value === 'CORRECT' ? 'text-primary-container' : 'text-error'
        );
      }

      cell.textContent = value;
      row.appendChild(cell);
    });

    table.appendChild(row);
  }

  function bindButtons() {
    $$('button').forEach((button) => {
      if (button.dataset.failureBound) return;
      button.dataset.failureBound = 'true';

      const text = button.textContent.toLowerCase();

      if (text.includes('retry case 0101')) {
        button.addEventListener('click', () => {
          location.href = '/case-select.html';
        });
      } else if (text.includes('study mode')) {
        button.addEventListener('click', () => {
          location.href = '/truth.html';
        });
      } else if (text.includes('return to case dossier desk')) {
        button.addEventListener('click', () => {
          location.href = '/case-select.html';
        });
      }
    });
  }

  async function loadFailureData() {
    const player = Heist.player();
    const sessionId = Heist.player() && Heist.player().player_id
      ? sessionStorage.getItem('session')
      : null;

    if (!sessionId) {
      console.error('[Binary Heist] No saved session ID found.');
      setText('#failure-reason',
        '[ SESSION DATA UNAVAILABLE: START OR FINISH A CASE FIRST ]'
      );
      return;
    }

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(JSON.parse(sessionId))}/report`);

      if (!response.ok) {
        throw new Error(`Report request failed (${response.status})`);
      }

      const report = await response.json();
      const data = report.session;

      updateTimer(report.summary?.time_taken_sec || 0);
      updateLives(data);
      updateStage(data);
      updateBounty(data.score);
      updateReason(data, report);
      updateIncidentLog(report.attempts || [], report);
      updateSkillDiagnostics(report.concepts || []);
      updateTruthTable(report);

      console.log('[Binary Heist] Failure screen connected to real session data.');
    } catch (error) {
      console.error('[Binary Heist] Could not load failure report:', error);

      setText('#failure-reason',
        '[ REPORT ERROR: COULD NOT LOAD SESSION DATA ]'
      );
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindButtons();
    loadFailureData();
  });
})();
