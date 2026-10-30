
/* =========================================================
   BINARY HEIST: OPERATIONAL DECK
   DIP switches + telemetry + backend answer/hint integration
   ========================================================= */

(() => {
  'use strict';

  // Bit order: [B3, B2, B1, B0]
  let switchStates = [1, 0, 1, 0];
  let secondsLeft = (2 * 3600) + (45 * 60) + 12;

  const $ = (id) => document.getElementById(id);

  function getDecimalValue() {
    return switchStates.reduce(
      (total, bit, index) => total + bit * (2 ** (3 - index)),
      0
    );
  }

  function getHexValue() {
    return '0x' + getDecimalValue().toString(16).toUpperCase().padStart(2, '0');
  }

  function updateTelemetryUI() {
    // Update the four displayed bits.
    for (let bit = 3; bit >= 0; bit--) {
      const value = switchStates[3 - bit];
      const bitDisplay = $('bit' + bit + '-val');

      if (bitDisplay) {
        bitDisplay.textContent = value;
        bitDisplay.className = value
          ? 'text-primary-container'
          : 'text-outline';
      }
    }

    // Update decimal and hexadecimal values.
    if ($('dec-val')) $('dec-val').textContent = getDecimalValue();
    if ($('hex-val')) $('hex-val').textContent = getHexValue();

    // Update the physical switch appearance.
    for (let bit = 0; bit <= 3; bit++) {
      const value = switchStates[3 - bit];
      const button = $('switch-' + bit);
      const lever = $('lever-' + bit);
      const led = $('led-' + bit);
      const label = $('label-' + bit);

      if (!button || !lever || !led || !label) continue;

      if (value === 1) {
        button.className =
          'w-12 h-24 bg-surface-container-lowest border-2 border-outline relative p-1 flex flex-col justify-start items-center transition-all focus:outline-none glow-green';

        lever.className =
          'w-10 h-10 bg-primary-container text-surface-container-lowest font-headline-sm font-bold flex items-center justify-center border border-primary transition-all duration-150 transform translate-y-0';

        lever.textContent = '1';
        led.className = 'w-3 h-1 bg-primary-container mb-1 shadow-sm';
        label.className =
          'text-label-sm font-label-sm text-primary-container font-mono mt-2 font-bold';
        label.textContent = '[HIGH]';

        button.setAttribute('aria-pressed', 'true');
      } else {
        button.className =
          'w-12 h-24 bg-surface-container-lowest border-2 border-outline-variant relative p-1 flex flex-col justify-end items-center transition-all focus:outline-none';

        lever.className =
          'w-10 h-10 bg-surface-bright text-outline font-headline-sm font-bold flex items-center justify-center border border-outline transition-all duration-150 transform translate-y-0';

        lever.textContent = '0';
        led.className = 'w-3 h-1 bg-outline-variant mt-1';
        label.className =
          'text-label-sm font-label-sm text-outline font-mono mt-2';
        label.textContent = '[LOW]';

        button.setAttribute('aria-pressed', 'false');
      }
    }
  }

  function toggleBit(bitIndex) {
    if (!Number.isInteger(bitIndex) || bitIndex < 0 || bitIndex > 3) {
      return;
    }

    const arrayIndex = 3 - bitIndex;
    switchStates[arrayIndex] = switchStates[arrayIndex] === 1 ? 0 : 1;

    updateTelemetryUI();
    appendLog(
      'BIT ' + bitIndex + ' changed to ' + switchStates[arrayIndex] + '.'
    );
  }

  function clearMatrix() {
    switchStates = [0, 0, 0, 0];
    updateTelemetryUI();
    appendLog('DIP matrix cleared: [ 0 0 0 0 ] (0x00).');
  }

  function invertBits() {
    switchStates = switchStates.map((bit) => bit === 1 ? 0 : 1);
    updateTelemetryUI();
    appendLog('Bits inverted using logical NOT.');
  }

  function appendLog(message, colorClass = 'text-secondary') {
    const logs = $('system-logs');
    if (!logs) return;

    const now = new Date();
    const time = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join(':');

    const entry = document.createElement('div');
    entry.className = colorClass;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'text-on-surface-variant';
    timeSpan.textContent = '[' + time + '] ';

    const messageSpan = document.createElement('span');
    messageSpan.textContent = '> ' + message;

    entry.append(timeSpan, messageSpan);
    logs.appendChild(entry);
    logs.scrollTop = logs.scrollHeight;
  }

  function hasActiveSession() {
    const savedSession = sessionStorage.getItem('session');
    return Boolean(savedSession && savedSession !== 'null');
  }

  async function submitPayload() {
    const bitString = switchStates.join('');
    const decimal = getDecimalValue();
    const hex = getHexValue();

    appendLog(
      'Transmitting payload [' + switchStates.join(' ') +
      '] = ' + decimal + ' DEC / ' + hex + ' HEX...',
      'text-primary-container font-bold'
    );

    // If the player started a game from Case Select, use the backend.
    if (typeof Heist !== 'undefined' && hasActiveSession()) {
      try {
        const result = await Heist.answer(bitString);

        const rejected =
          result.correct === false ||
          result.success === false ||
          result.is_correct === false;

        if (rejected) {
          appendLog(
            result.message || 'Answer rejected. Check the bus bits and try again.',
            'text-error font-bold'
          );
          return;
        }

        appendLog(
          result.message || 'Backend accepted the submitted answer.',
          'text-primary-container font-bold'
        );

        if (result.hint) {
          appendLog('SERVER: ' + result.hint, 'text-secondary');
        }

        if (result.stage_complete || result.completed) {
          appendLog(
            'Stage completed. Return to the puzzle screen to continue the game.',
            'text-primary-container font-bold'
          );
        }

        return;
      } catch (error) {
        appendLog(
          'SERVER ERROR: ' + (error.message || 'Answer could not be submitted.'),
          'text-error font-bold'
        );
        return;
      }
    }

    // Standalone fallback if no game session has been started.
    // This checks the deck clue locally; it does not save progress.
    if (bitString === '0101') {
      appendLog(
        'LOCAL CHECK PASSED: 0101 = 5. No active game session, so progress was not saved.',
        'text-primary-container font-bold'
      );
    } else {
      appendLog(
        'CRC ERROR: ' + bitString + ' (' + hex +
        ') is incorrect for this deck clue. The target is 0101.',
        'text-error font-bold'
      );
    }
  }

  async function requestHint() {
    appendLog('Hint requested.', 'text-[#ffb000] font-bold');

    if (typeof Heist !== 'undefined' && hasActiveSession()) {
      try {
        const result = await Heist.hint();

        const hintText = result.hint || result.message || 'No hint text was returned.';
        appendLog('SERVER HINT: ' + hintText, 'text-[#ffb000] font-bold');

        if (result.penalty !== undefined) {
          appendLog('Hint penalty: ' + result.penalty, 'text-[#ffb000]');
        }

        return;
      } catch (error) {
        appendLog(
          'HINT ERROR: ' + (error.message || 'Hint could not be retrieved.'),
          'text-error font-bold'
        );
        return;
      }
    }

    appendLog(
      "Check the low 4 bits of ASCII '5': 0x35 ends in binary 0101.",
      'text-[#ffb000] font-bold'
    );
    appendLog(
      'No active game session. This is a local hint; server penalties do not apply.',
      'text-outline'
    );
  }

  function updateCountdown() {
    const timer = $('countdown-timer');
    if (!timer) return;

    if (secondsLeft > 0) secondsLeft--;

    const hours = String(Math.floor(secondsLeft / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((secondsLeft % 3600) / 60)).padStart(2, '0');
    const seconds = String(secondsLeft % 60).padStart(2, '0');

    timer.textContent = hours + ':' + minutes + ':' + seconds;
  }

  function setupFieldNotes() {
    const notes = document.querySelector('textarea');
    if (!notes) return;

    const storageKey = 'binaryHeistDeckNotes';
    const savedNotes = sessionStorage.getItem(storageKey);

    if (savedNotes !== null) {
      notes.value = savedNotes;
    }

    notes.addEventListener('input', () => {
      sessionStorage.setItem(storageKey, notes.value);
    });
  }

  function setupNavigation() {
    document.querySelectorAll('nav button').forEach((button) => {
      button.addEventListener('click', () => {
        const label = button.innerText.trim().toUpperCase();

        if (label.includes('DOSSIER')) {
          window.location.href = 'evidence.html';
        } else if (label.includes('DECRYPT')) {
          window.location.href = 'puzzle.html';
        } else if (label.includes('LOGS')) {
          const logs = $('system-logs');
          if (logs) logs.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (label.includes('DECK')) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  function setupUtilityButtons() {
    document.querySelectorAll('button').forEach((button) => {
      const label = button.innerText.trim().toUpperCase();

      if (label.includes('LOGIC GATE SKETCHPAD')) {
        button.addEventListener('click', () => {
          appendLog(
            'Scratchpad: XOR gives 1 when the two input bits differ.',
            'text-secondary'
          );
        });
      }

      if (label.includes('PROBE REGISTER PIN')) {
        button.addEventListener('click', () => {
          appendLog(
            'Register probe: ' + switchStates.join('') +
            ' = ' + getDecimalValue() + ' DEC / ' + getHexValue() + ' HEX.',
            'text-primary-container'
          );
        });
      }
    });
  }

  // Existing HTML buttons use inline onclick attributes.
  // Expose these functions so those buttons can call them.
  window.toggleBit = toggleBit;
  window.clearMatrix = clearMatrix;
  window.invertBits = invertBits;
  window.submitPayload = submitPayload;
  window.requestHint = requestHint;

  document.addEventListener('DOMContentLoaded', () => {
    updateTelemetryUI();
    setupFieldNotes();
    setupNavigation();
    setupUtilityButtons();

    const initialTimer = $('countdown-timer');
    if (initialTimer) initialTimer.textContent = '02:45:12';

    window.setInterval(updateCountdown, 1000);

    appendLog('Deck interface initialized. DIP matrix ready.');
    appendLog(
      hasActiveSession()
        ? 'Game session detected. Answers and hints will use the backend.'
        : 'No active game session. Start a case to submit answers to the backend.',
      'text-outline'
    );
  });
})();
