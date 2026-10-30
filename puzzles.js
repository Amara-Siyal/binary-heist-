// Randomised puzzle generator. One session = 5 stages:
// 1 Binary clue -> 2 Logic lock -> 3 Truth table -> 4 Boss (adder) -> 5 Final code (vault)
// Stages 1-4 each reveal one random bit; those 4 bits form the RAW code used in stage 5.

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const bin = (n, w = 4) => (n & ((1 << w) - 1)).toString(2).padStart(w, '0');

const GATES = {
  AND:  (a, b) => a & b,
  OR:   (a, b) => a | b,
  NAND: (a, b) => 1 - (a & b),
  NOR:  (a, b) => 1 - (a | b),
  XOR:  (a, b) => a ^ b,
  XNOR: (a, b) => 1 - (a ^ b),
};
const GATE_INFO = {
  AND:  'AND outputs 1 only when both inputs are 1.',
  OR:   'OR outputs 1 when at least one input is 1.',
  NAND: 'NAND is AND inverted: it outputs 0 only when both inputs are 1.',
  NOR:  'NOR is OR inverted: it outputs 1 only when both inputs are 0.',
  XOR:  'XOR outputs 1 only when its inputs differ.',
  XNOR: 'XNOR outputs 1 only when its inputs are equal.',
};

function binaryPuzzle(level) {
  const n = 1 + rnd(15);
  const weights = [8, 4, 2, 1].filter((w) => n & w).join(' + ');
  if (level === 'easy') {
    return {
      puzzle_type: 'binary_decode', concept: 'Binary', input_mode: 'bits4',
      question: `The thief left a PIN digit written in decimal: ${n}. Enter it as 4 binary bits.`,
      answer: bin(n),
      hint: `Bit weights are 8-4-2-1. Which of them add up to ${n}?`,
      explanation: `${n} = ${weights}, so the bits are ${bin(n)}.`,
    };
  }
  if (level === 'medium') {
    const h = n.toString(16).toUpperCase();
    return {
      puzzle_type: 'binary_decode', concept: 'Binary', input_mode: 'bits4',
      question: `A memory dump shows the hex digit 0x${h}. Enter it as 4 binary bits.`,
      answer: bin(n),
      hint: 'One hex digit is exactly 4 bits. A=10, B=11, C=12, D=13, E=14, F=15.',
      explanation: `0x${h} = ${n} = ${weights}, so the bits are ${bin(n)}.`,
    };
  }
  // hard: Gray code -> binary
  const g = n ^ (n >> 1);
  return {
    puzzle_type: 'binary_decode', concept: 'Binary', input_mode: 'bits4',
    question: `The encoder is Gray-coded. It reads ${bin(g)}. Enter the true binary value.`,
    answer: bin(n),
    hint: 'Gray to binary: keep the MSB, then each next binary bit = previous binary bit XOR next Gray bit.',
    explanation: `Gray ${bin(g)} converts to binary ${bin(n)} (MSB kept, then cascading XOR).`,
  };
}

const EXPR2 = [
  ['A AND NOT(B)',   (a, b) => a & (1 - b),       'AND/OR'],
  ['NOT(A) OR B',    (a, b) => (1 - a) | b,       'AND/OR'],
  ['NOT(A AND B)',   (a, b) => 1 - (a & b),       'AND/OR'],
  ['NOT(A OR B)',    (a, b) => 1 - (a | b),       'AND/OR'],
  ['A XOR B',        (a, b) => a ^ b,             'XOR'],
  ['(A XOR B) AND A', (a, b) => (a ^ b) & a,      'XOR'],
];
const EXPR3 = [
  ['(A AND B) OR C',      (a, b, c) => (a & b) | c,          'AND/OR'],
  ['NOT(A) AND (B OR C)', (a, b, c) => (1 - a) & (b | c),    'AND/OR'],
  ['A XOR (B AND C)',     (a, b, c) => a ^ (b & c),          'XOR'],
  ['(A XOR B) OR C',      (a, b, c) => (a ^ b) | c,          'XOR'],
];

function logicPuzzle(level) {
  const a = rnd(2), b = rnd(2), c = rnd(2);
  let expr, fn, concept;
  if (level === 'hard') [expr, fn, concept] = pick(EXPR3);
  else if (level === 'easy') [expr, fn, concept] = pick(EXPR2.slice(0, 3));
  else [expr, fn, concept] = pick(EXPR2);
  const out = fn(a, b, c);
  const vals = level === 'hard' ? `A=${a}, B=${b}, C=${c}` : `A=${a}, B=${b}`;
  return {
    puzzle_type: 'logic_gate', concept, input_mode: 'bits1',
    question: `Logic Lock 1: ${vals}. Evaluate ${expr}. Enter the output bit.`,
    answer: String(out),
    hint: 'Solve the innermost brackets or NOT first, then work outward.',
    explanation: `With ${vals}, ${expr} evaluates to ${out}.`,
  };
}

function truthPuzzle(level) {
  const pool = level === 'easy' ? ['AND', 'OR', 'XOR', 'NAND'] : Object.keys(GATES);
  const gate = pick(pool);
  const rows = [[0, 0], [0, 1], [1, 0], [1, 1]].map(([a, b]) => [a, b, GATES[gate](a, b)]);
  const outs = rows.map((r) => r[2]).join('');
  return {
    puzzle_type: 'truth_table',
    concept: gate === 'XOR' || gate === 'XNOR' ? 'XOR' : 'Truth Tables',
    input_mode: 'gate',
    question: `For inputs 00, 01, 10, 11 the hidden gate outputs ${outs.split('').join(', ')}. Identify the gate.`,
    answer: gate,
    hint: `${outs.split('').filter((x) => x === '1').length} of the 4 rows output 1. Which gates match that pattern?`,
    explanation: `${GATE_INFO[gate]} Output column: ${outs}.`,
    payload: { table: rows.map(([a, b]) => ({ A: a, B: b })), outputs: outs.split('').map(Number),
               options: ['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR'] },
  };
}

function bossPuzzle(level) {
  const a = rnd(2), b = rnd(2), c = rnd(2);
  if (level === 'hard') {
    const total = a + b + c;
    return {
      puzzle_type: 'boss_adder', concept: 'Adders', input_mode: 'bits2',
      question: `FIREWALL BOSS: full adder with A=${a}, B=${b}, Cin=${c}. Enter CARRY then SUM (2 bits).`,
      answer: bin(total, 2),
      hint: 'SUM = A XOR B XOR Cin. COUT = majority of the three inputs.',
      explanation: `${a}+${b}+${c} = ${total} = ${bin(total, 2)} (COUT=${total >> 1}, SUM=${total & 1}).`,
    };
  }
  const total = a + b;
  return {
    puzzle_type: 'boss_adder', concept: 'Adders', input_mode: 'bits2',
    question: `FIREWALL BOSS: half adder with A=${a}, B=${b}. Enter CARRY then SUM (2 bits).`,
    answer: bin(total, 2),
    hint: 'A half adder is SUM = A XOR B and CARRY = A AND B.',
    explanation: `SUM = ${a} XOR ${b} = ${a ^ b}; CARRY = ${a} AND ${b} = ${a & b}. Result CS = ${bin(total, 2)}.`,
  };
}

function generate(level = 'easy') {
  const stages = [binaryPuzzle(level), logicPuzzle(level), truthPuzzle(level), bossPuzzle(level)];
  const bits = stages.map(() => rnd(2));
  stages.forEach((s, i) => { s.stage_no = i + 1; s.reveal_bit = bits[i]; });

  const raw = parseInt(bits.join(''), 2);
  const mask = 1 + rnd(14);
  const useXnor = level !== 'easy' && rnd(2) === 1;
  const out = useXnor ? (~(raw ^ mask)) & 15 : raw ^ mask;
  const op = useXnor ? 'XNOR' : 'XOR';
  stages.push({
    stage_no: 5, puzzle_type: 'final_code', concept: 'Final Code', input_mode: 'bits4',
    question: `VAULT: Your evidence board code is {RAW}. Apply ${op} with the mask ${bin(mask)}. Enter the final 4-bit result.`,
    answer: bin(out),
    hint: useXnor ? 'XNOR = XOR then invert every bit.' : 'XOR each bit: output is 1 where the code and mask differ.',
    explanation: `${bin(raw)} ${op} ${bin(mask)} = ${bin(out)}.`,
    reveal_bit: null,
  });
  return stages;
}

module.exports = { generate, bin };
