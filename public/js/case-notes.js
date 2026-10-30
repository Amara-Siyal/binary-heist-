
(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  let snapshot = null;

  function findButton(text) {
    return $$('button').find((button) =>
      button.textContent.toUpperCase().includes(text.toUpperCase())
    );
  }

  function getSessionId() {
    return sessionStorage.getItem('session');
  }

  function isFinished(data) {
    return ['finished', 'win', 'lose', 'abandoned']
      .includes(data?.status);
  }

  function navigateNext() {
    if (isFinished(snapshot)) {
      location.href = '/evidence.html';
      return;
    }

    location.href = '/puzzle.html';
  }

  
function updateStage(data) {
  const stage = Math.min(5, Math.max(1, Number(data.stage) || 1));
  const formatted = String(stage).padStart(2, '0');

  document.querySelectorAll('header div, section span').forEach((element) => {
    const text = element.textContent.trim();

    if (/^STAGE \d+\/05$/i.test(text)) {
      element.textContent = `STAGE ${formatted}/05`;
    }

    if (/^\[STAGE \d+ \/ 05 DECRYPTED\]$/i.test(text)) {
      element.textContent = `[STAGE ${formatted} / 05 DECRYPTED]`;
    }
  });
}


  function updateSessionInfo(data) {
    updateStage(data);

    // Update the score shown in the debrief ribbon.
    const bountyLabel = $$('span, strong').find((element) =>
      element.textContent.includes('BOUNTY AWARDED:')
    );

    if (bountyLabel) {
      const strong = bountyLabel.querySelector('strong');
      if (strong) {
        strong.textContent = `+${Number(data.score || 0).toLocaleString()} PTS`;
      }
    }

    // Never invent elapsed time when the backend doesn't provide it.
    const timeLabel = $$('span, div').find((element) =>
      element.children.length > 0 &&
      element.textContent.includes('TIME CONSUMED:')
    );

    if (timeLabel) {
      const strong = timeLabel.querySelector('strong');
      if (strong) {
        const seconds = data.summary?.time_taken_sec;

        strong.textContent = Number.isFinite(Number(seconds)) &&
          seconds !== null
          ? formatTime(seconds)
          : '--:--';
      }
    }

    const nextButton = findButton('NEXT STAGE');

    if (nextButton) {
      nextButton.onclick = navigateNext;

      const label = nextButton.querySelector('span');
      if (label) {
        label.textContent = isFinished(data)
          ? '[ RETURN TO EVIDENCE BOARD ]'
          : `[ NEXT STAGE // PROCEED TO CIRCUIT ${String(
              Math.min(5, Number(data.stage) || 1)
            ).padStart(2, '0')} ]`;
      }
    }
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));

    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  function exportReport() {
    const report = [
      'BINARY HEIST // CASE NOTES',
      'CASE: 0101',
      `SESSION: ${getSessionId() || 'Unavailable'}`,
      `STAGE: ${snapshot?.stage ?? 'Unavailable'}`,
      `STATUS: ${snapshot?.status ?? 'Unavailable'}`,
      `SCORE: ${snapshot?.score ?? 0}`,
      `LIVES LEFT: ${snapshot?.lives_left ?? 'Unavailable'}`,
      `TIME LEFT: ${snapshot?.time_left ?? 'Unavailable'} seconds`,
      '',
      'CURRENT PUZZLE:',
      snapshot?.puzzle?.question || 'No active puzzle available.',
      '',
      'This report contains the session data available to this screen.'
    ].join('\n');

    const blob = new Blob([report], {
      type: 'text/plain;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'binary-heist-case-notes.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  function reviewLogs() {
    const table = $('table');

    if (table) {
      table.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });

      table.classList.add('phosphor-cyan-glow');

      setTimeout(() => {
        table.classList.remove('phosphor-cyan-glow');
      }, 1500);
    }

    if (!snapshot?.puzzle) {
      console.info('[Binary Heist] No active puzzle is available in this session snapshot.');
    }
  }

  function bindNavigation() {
    const buttons = $$('button');

    buttons.forEach((button) => {
      const text = button.textContent.toUpperCase();

      if (text.includes('EXPORT CASE REPORT')) {
        button.addEventListener('click', exportReport);
      }

      if (text.includes('REVIEW TEST LOGS')) {
        button.addEventListener('click', reviewLogs);
      }

      if (button.title === 'Dismiss Debrief Modal') {
        button.addEventListener('click', navigateNext);
      }
    });

    // Connect the mobile navigation to existing project screens.
    const navLinks = $$('nav a');
    const routes = [
      '/deck.html',
      '/evidence.html',
      '/case-notes.html',
      '/puzzle.html'
    ];

    navLinks.forEach((link, index) => {
      if (routes[index]) {
        link.href = routes[index];
      }
    });
  }

  async function init() {
    bindNavigation();

    if (!getSessionId()) {
      console.warn('[Binary Heist] No active session found.');
      return;
    }

    try {
      snapshot = await Heist.state();
      updateSessionInfo(snapshot);

      console.log('[Binary Heist] Case notes connected to backend.');
    } catch (error) {
      console.error('[Binary Heist] Could not load session:', error);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
