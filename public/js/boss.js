
(() => {
  'use strict';

  let selectedGate = null;
  let gateSlots = ['', '', ''];
  let secondsLeft = 18;
  let challengeFinished = false;

  const correctGates = ['XOR', 'AND', 'OR'];

  function showMessage(message, success = true) {
    let box = document.getElementById('boss-result');

    if (!box) {
      box = document.createElement('div');
      box.id = 'boss-result';
      box.className = 'p-3 mt-3 border font-mono text-sm';
      box.setAttribute('role', 'status');

      const main = document.querySelector('main');
      if (main) main.prepend(box);
    }

    box.textContent = message;
    box.style.color = success ? '#39ff14' : '#ff2e4c';
    box.style.borderColor = success ? '#39ff14' : '#ff2e4c';
  }

  function logEvent(message) {
    let log = document.getElementById('boss-log');

    if (!log) {
      log = document.createElement('div');
      log.id = 'boss-log';
      log.className =
        'bg-surface-container-lowest border border-outline-variant p-2 mt-3 text-xs font-mono';

      const aside = document.querySelector('main aside');
      if (aside) aside.appendChild(log);
    }

    const line = document.createElement('p');
    line.textContent = '> ' + message;
    log.prepend(line);
  }

  function getGateButtons() {
    const names = ['XOR', 'AND', 'OR', 'NAND', 'NOR', 'XNOR'];

    return [...document.querySelectorAll('main button')].filter(button => {
      const label = button.innerText.trim().toUpperCase();
      return names.includes(label);
    });
  }

  function getTargetSlots() {
    return [...document.querySelectorAll('svg g[transform]')]
      .filter(group => {
        const text = group.innerText.toUpperCase();
        return text.includes('TARGET 1') ||
               text.includes('TARGET 2') ||
               text.includes('TARGET 3');
      });
  }

  function updateSlots() {
    const slots = getTargetSlots();

    slots.forEach((slot, index) => {
      const text = slot.querySelectorAll('text');
      const gateText = text[1];

      if (gateText) {
        gateText.textContent = gateSlots[index]
          ? '? ' + gateSlots[index]
          : '? ' + ['XOR', 'AND', 'OR'][index];

        gateText.setAttribute(
          'fill',
          gateSlots[index] ? '#39ff14' : '#ff2e4c'
        );
      }

      slot.style.cursor = 'pointer';
    });

    getGateButtons().forEach(button => {
      const gate = button.innerText.trim().toUpperCase();
      button.style.outline =
        gate === selectedGate ? '2px solid #39ff14' : '';
    });
  }

  function selectGate(gate) {
    if (challengeFinished) return;

    selectedGate = gate;
    showMessage(
      'Selected ' + gate + '. Now click TARGET 1, 2, or 3 in the schematic.'
    );

    logEvent('Gate selected: ' + gate);
    updateSlots();
  }

  function assignGate(index) {
    if (challengeFinished) return;

    if (!selectedGate) {
      showMessage('Select a gate from the arsenal first.', false);
      return;
    }

    gateSlots[index] = selectedGate;

    showMessage(
      selectedGate + ' assigned to Target ' + (index + 1) + '.'
    );

    logEvent('Target ' + (index + 1) + ' assigned: ' + selectedGate);
    selectedGate = null;
    updateSlots();
  }

  function injectOverload() {
    if (challengeFinished) {
      showMessage('Challenge already completed. Reset the buffer to retry.');
      return;
    }

    if (gateSlots.some(gate => !gate)) {
      showMessage('INJECTION FAILED: Fill all three target slots first.', false);
      return;
    }

    const correct = gateSlots.every(
      (gate, index) => gate === correctGates[index]
    );

    if (correct) {
      challengeFinished = true;
      showMessage(
        'ACCESS GRANTED! XOR + AND + OR verified. Firewall core compromised!'
      );
      logEvent('SUCCESS: Full-Adder gate arrangement verified.');

      const healthLabel = [...document.querySelectorAll('main, section')]
        .flatMap(element => [...element.querySelectorAll('span')])
        .find(span => span.innerText.includes('65% REMAINING'));

      if (healthLabel) healthLabel.textContent = '[0% REMAINING]';

      return;
    }

    showMessage(
      'ACCESS DENIED. Check the gate order: Target 1 = XOR, Target 2 = AND, Target 3 = OR.',
      false
    );
    logEvent('Incorrect gate arrangement. Firewall remains active.');
  }

  function flushBuffer() {
    gateSlots = ['', '', ''];
    selectedGate = null;
    challengeFinished = false;

    showMessage('Buffer flushed. Select gates and assign all three targets.');
    logEvent('Buffer cleared.');
    updateSlots();
  }

  function simulateCarry() {
    const A = 1;
    const B = 1;
    const Cin = 0;

    const intermediate = A ^ B;
    const sum = intermediate ^ Cin;
    const carry1 = A & B;
    const carry2 = intermediate & Cin;
    const cout = carry1 | carry2;

    showMessage(
      'SIMULATION: A=1, B=1, Cin=0 | Sum=' + sum +
      ' | Carry-Out=' + cout
    );

    logEvent('Carry simulation completed: Sum=' + sum + ', Cout=' + cout);
  }

  function requestHint() {
    showMessage(
      'HINT: Target 1 uses XOR. Target 2 uses AND. Target 3 uses OR. ' +
      'These combine to make a Full-Adder.'
    );

    logEvent('Emergency clue requested.');
  }

  function setup() {
    getGateButtons().forEach(button => {
      button.type = 'button';
      button.addEventListener('click', () => {
        selectGate(button.innerText.trim().toUpperCase());
      });
    });

    getTargetSlots().forEach((slot, index) => {
      slot.addEventListener('click', () => assignGate(index));
      slot.style.cursor = 'pointer';
    });

    const buttons = [...document.querySelectorAll('main button')];

    buttons.forEach(button => {
      const label = button.innerText.toUpperCase();

      if (label.includes('INJECT LOGIC OVERLOAD')) {
        button.type = 'button';
        button.addEventListener('click', injectOverload);
      } else if (label.includes('FLUSH BUFFER')) {
        button.type = 'button';
        button.addEventListener('click', flushBuffer);
      } else if (label.includes('SIMULATE CARRY')) {
        button.type = 'button';
        button.addEventListener('click', simulateCarry);
      } else if (label.includes('SACRIFICE 20S')) {
        button.type = 'button';
        button.addEventListener('click', requestHint);
      }
    });

    updateSlots();
    showMessage('SYSTEM READY: Select a logic gate to begin.');
    logEvent('Boss challenge initialized.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
