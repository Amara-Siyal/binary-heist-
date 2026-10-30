
(() => {
  'use strict';

  const GATES = ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR'];

  let selectedGate = null;

  function calculateGate(gate, a, b) {
    switch (gate) {
      case 'AND':  return a & b;
      case 'OR':   return a | b;
      case 'NOT':  return a === 0 ? 1 : 0;
      case 'NAND': return (a & b) === 0 ? 1 : 0;
      case 'NOR':  return (a | b) === 0 ? 1 : 0;
      case 'XOR':  return a ^ b;
      case 'XNOR': return (a ^ b) === 0 ? 1 : 0;
      default:     return null;
    }
  }

  function findGateButtons() {
    const panel = document.getElementById('gates') ||
      document.getElementById('truth-gates');

    if (panel) {
      return [...panel.querySelectorAll('[data-gate]')];
    }

    return [...document.querySelectorAll('[data-gate]')];
  }

  function showMessage(message, success = false) {
    let output = document.getElementById('truth-result');

    if (!output) {
      output = document.createElement('div');
      output.id = 'truth-result';
      output.className = 'border p-3 mt-3 font-mono text-sm';
      output.setAttribute('role', 'status');

      const main = document.querySelector('main') || document.body;
      main.appendChild(output);
    }

    output.textContent = message;
    output.style.color = success ? '#39ff14' : '#ff2e4c';
    output.style.borderColor = success ? '#39ff14' : '#ff2e4c';
  }

  function renderSelection() {
  findGateButtons().forEach((button) => {
    const gate = (
      button.dataset.gate || button.textContent
    ).trim().toUpperCase();

    button.classList.remove(
      'border-2',
      'border-noir-cyan',
      'phosphor-cyan',
      'bg-cyan-400',
      'text-black',
      'border-cyan-300',
      'selected',
      'active'
    );

    button.removeAttribute('aria-pressed');

    if (gate === selectedGate && selectedGate !== null) {
      button.classList.add(
        'border-2',
        'border-noir-cyan',
        'phosphor-cyan'
      );

      button.setAttribute('aria-pressed', 'true');
    } else {
      button.setAttribute('aria-pressed', 'false');
    }
  });
}
  function selectGate(gate) {
    if (!GATES.includes(gate)) return;

    selectedGate = gate;
    renderSelection();

    showMessage(
      `Selected gate: ${gate}. Now test it against the truth table.`,
      true
    );
  }

  function getObservedOutputs() {
    /*
      Read outputs from a table with rows ordered:
      A=0,B=0; A=0,B=1; A=1,B=0; A=1,B=1.

      The table should use data-output="0" or "1" on each
      output cell, or contain a final output column.
    */
    const explicit = [
      ...document.querySelectorAll('[data-truth-output]')
    ];

    if (explicit.length === 4) {
      const values = explicit.map((element) =>
        element.dataset.truthOutput.trim()
      );

      if (values.every((value) => value === '0' || value === '1')) {
        return values.map(Number);
      }
    }

    const rows = [
      ...document.querySelectorAll(
        '#truth-table tbody tr, table[data-truth-table] tbody tr'
      )
    ].filter((row) => row.querySelectorAll('td').length >= 3);

    if (rows.length === 4) {
      const outputs = rows.map((row) => {
        const cells = [...row.querySelectorAll('td')];
        const cell = cells[cells.length - 1];
        const value = cell.textContent.trim();

        return value === '0' || value === '1' ? Number(value) : null;
      });

      if (outputs.every((value) => value === 0 || value === 1)) {
        return outputs;
      }
    }

    return null;
  }

  function testGate() {
    if (!selectedGate) {
      showMessage('Select a logic gate first.');
      return;
    }

    const observed = getObservedOutputs();

    if (!observed) {
      showMessage(
        'Cannot read the displayed truth table. Check its HTML table rows and output column.'
      );
      return;
    }

    const inputs = [[0, 0], [0, 1], [1, 0], [1, 1]];

    const matches = inputs.every(([a, b], index) => {
      return calculateGate(selectedGate, a, b) === observed[index];
    });

    if (!matches) {
      showMessage(
        `ACCESS DENIED: ${selectedGate} does not match the displayed truth table.`
      );
      return;
    }

    showMessage(
      `ACCESS GRANTED: ${selectedGate} matches the displayed truth table!`,
      true
    );

    /*
      Do not submit a second answer here if puzzle.js already handles
      the main Submit button. Its Heist.answer() call is responsible
      for advancing the actual game stage.
    */
  }

  function requestHint() {
    showMessage(
      'Compare all four rows. The correct gate must match every output.',
      true
    );
  }

  function setup() {
    findGateButtons().forEach((button) => {
      if (button.dataset.truthBound === 'true') return;

      const gate = (button.dataset.gate || button.textContent)
        .trim()
        .toUpperCase();

      if (!GATES.includes(gate)) return;

      button.dataset.gate = gate;
      button.type = 'button';
      button.dataset.truthBound = 'true';

      button.addEventListener('click', () => selectGate(gate));
    });

    // Never start with XOR or any other gate selected.
    selectedGate = null;
    renderSelection();

    const buttons = [...document.querySelectorAll('button')];

    const testButton = buttons.find((button) =>
      button.textContent.toUpperCase().includes('TEST GATE')
    );

    if (testButton && testButton.dataset.truthTestBound !== 'true') {
      testButton.type = 'button';
      testButton.dataset.truthTestBound = 'true';
      testButton.addEventListener('click', testGate);
    }

    const hintButton = buttons.find((button) =>
      button.textContent.toUpperCase().includes('REQUEST HINT')
    );

    if (hintButton && hintButton.dataset.truthHintBound !== 'true') {
      hintButton.type = 'button';
      hintButton.dataset.truthHintBound = 'true';
      hintButton.addEventListener('click', requestHint);
    }

    showMessage('SYSTEM READY: Select a gate, then test it.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, { once: true });
  } else {
    setup();
  }
})();
