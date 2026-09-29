// Parametriserade övningar (mallar) i Plugga: en övning med variabler som får
// nya tal varje gång eleven möter den — "Vilket värde har siffran {{d}} i
// {{n}}?" — så att en drilluppgift inte kan läras utantill. Glosan räknar
// själv, utan AI: slumptal ur ett frö, ett litet säkert uttrycksspråk (ingen
// eval) och svaret räknas fram för varje instans. Fröet följer med uppgiften
// till klienten och tillbaka med svaret — samma frö ger alltid samma tal, så
// servern rättar exakt de tal eleven såg utan att spara något.
//
// Mall: { vars: [{ name, int: [a,b] } | { name, decimal: [a,b], decimals } |
//                 { name, pick: [...] } | { name, calc: 'uttryck' }],
//         where: ['d != 0', 'n % 3 == 0'] }
// Text: {{n}} eller {{ uttryck }}, {{n:tex}} i LaTeX ($…$). Svar: answer.expr.

const MAX_EXPR = 200;
const MAX_DEPTH = 40;
const MAX_TRIES = 200;
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

// ── uttryck ──────────────────────────────────────────────────────────────────

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|&&|\|\||[-+*/%^(),<>!·×]))/y;

function tokenize(src) {
  const s = String(src);
  if (s.length > MAX_EXPR) throw new Error(`expression longer than ${MAX_EXPR} characters`);
  const out = [];
  TOKEN.lastIndex = 0;
  let i = 0;
  while (i < s.length) {
    if (/^\s*$/.test(s.slice(i))) break;
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(s);
    if (!m) throw new Error(`unexpected "${s.slice(i).trim().slice(0, 12)}"`);
    if (m[1] !== undefined) out.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ k: 'id', v: m[2] });
    else out.push({ k: 'op', v: m[3] === '·' || m[3] === '×' ? '*' : m[3] });
    i = TOKEN.lastIndex;
  }
  return out;
}

/** Tolka ett uttryck till ett träd. Kastar Error med ett begripligt meddelande. */
function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => peek()?.k === 'op' && peek().v === v;
  const take = (v) => {
    if (!isOp(v)) throw new Error(`expected "${v}"`);
    p += 1;
  };
  const bin = (next, ops) => (depth) => {
    let a = next(depth);
    while (peek()?.k === 'op' && ops.includes(peek().v)) {
      const op = toks[p++].v;
      a = { t: 'bin', op, a, b: next(depth) };
    }
    return a;
  };
  function primary(depth) {
    if (depth > MAX_DEPTH) throw new Error('expression nested too deeply');
    const t = toks[p++];
    if (!t) throw new Error('expression ends too early');
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'id') {
      if (isOp('(')) {
        take('(');
        const args = [];
        if (!isOp(')')) {
          args.push(or(depth + 1));
          while (isOp(',')) { take(','); args.push(or(depth + 1)); }
        }
        take(')');
        return { t: 'call', name: t.v, args };
      }
      return { t: 'var', name: t.v };
    }
    if (t.k === 'op' && t.v === '(') {
      const e = or(depth + 1);
      take(')');
      return e;
    }
    throw new Error(`unexpected "${t.v}"`);
  }
  function unary(depth) {
    if (peek()?.k === 'op' && ['-', '+', '!'].includes(peek().v)) {
      const op = toks[p++].v;
      return { t: 'un', op, a: unary(depth + 1) };
    }
    return power(depth);
  }
  function power(depth) {
    const a = primary(depth);
    if (isOp('^')) {
      take('^');
      return { t: 'bin', op: '^', a, b: unary(depth + 1) };
    }
    return a;
  }
  const mul = bin(unary, ['*', '/', '%']);
  const add = bin(mul, ['+', '-']);
  const cmp = bin(add, ['==', '!=', '<', '<=', '>', '>=']);
  const and = bin(cmp, ['&&']);
  const or = bin(and, ['||']);
  const tree = or(0);
  if (p < toks.length) throw new Error(`unexpected "${toks[p].v}"`);
  return tree;
}

const PLACE_NAMES = {
  6: 'miljontal', 5: 'hundratusental', 4: 'tiotusental', 3: 'tusental', 2: 'hundratal', 1: 'tiotal', 0: 'ental',
  '-1': 'tiondel', '-2': 'hundradel', '-3': 'tusendel', '-4': 'tiotusendel'
};

const gcd = (a, b) => {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) [x, y] = [y, x % y];
  return x;
};

const num = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} needs numbers`);
  return v;
};

const FUNCS = {
  round: (x, d = 0) => { const f = 10 ** num(d, 'round'); return Math.round(num(x, 'round') * f + Number.EPSILON * Math.sign(x)) / f; },
  floor: (x) => Math.floor(num(x, 'floor')),
  ceil: (x) => Math.ceil(num(x, 'ceil')),
  abs: (x) => Math.abs(num(x, 'abs')),
  sqrt: (x) => Math.sqrt(num(x, 'sqrt')),
  min: (...xs) => Math.min(...xs.map((x) => num(x, 'min'))),
  max: (...xs) => Math.max(...xs.map((x) => num(x, 'max'))),
  gcd: (a, b) => gcd(num(a, 'gcd'), num(b, 'gcd')),
  lcm: (a, b) => { const g = gcd(num(a, 'lcm'), num(b, 'lcm')); return g ? Math.abs(Math.round(a) * Math.round(b)) / g : 0; },
  // Siffran på plats k i n: k = 0 ental, 1 tiotal, −1 tiondel …
  digit: (n, k) => {
    const shifted = Math.abs(num(n, 'digit')) / 10 ** num(k, 'digit');
    return Math.floor(Math.round(shifted * 1e6) / 1e6) % 10;
  },
  // Antal siffror i heltalsdelen (27 350 → 5).
  digits: (n) => String(Math.floor(Math.abs(num(n, 'digits')))).length,
  // Positionens namn: posname(3) = "tusental", posname(-2) = "hundradel".
  posname: (k) => {
    const name = PLACE_NAMES[String(num(k, 'posname'))];
    if (!name) throw new Error('posname works for positions −4 … 6');
    return name;
  }
};

function evaluate(node, scope) {
  switch (node.t) {
    case 'num': return node.v;
    case 'var':
      // hasOwn — aldrig ärvda egenskaper som "constructor" eller "__proto__".
      if (!Object.hasOwn(scope, node.name)) throw new Error(`unknown variable "${node.name}"`);
      return scope[node.name];
    case 'call': {
      const fn = Object.hasOwn(FUNCS, node.name) ? FUNCS[node.name] : null;
      if (!fn) throw new Error(`unknown function "${node.name}" (use ${Object.keys(FUNCS).join(', ')})`);
      return fn(...node.args.map((a) => evaluate(a, scope)));
    }
    case 'un': {
      const v = evaluate(node.a, scope);
      if (node.op === '!') return v ? 0 : 1;
      return node.op === '-' ? -num(v, 'minus') : num(v, 'plus');
    }
    case 'bin': {
      const a = evaluate(node.a, scope);
      if (node.op === '&&') return a ? (evaluate(node.b, scope) ? 1 : 0) : 0;
      if (node.op === '||') return a ? 1 : (evaluate(node.b, scope) ? 1 : 0);
      const b = evaluate(node.b, scope);
      switch (node.op) {
        case '+': return num(a, '+') + num(b, '+');
        case '-': return num(a, '-') - num(b, '-');
        case '*': return num(a, '*') * num(b, '*');
        case '/': return num(a, '/') / num(b, '/');
        case '%': return num(a, '%') % num(b, '%');
        case '^':
          if (Math.abs(num(b, '^')) > 12) throw new Error('powers are limited to exponents up to 12');
          return num(a, '^') ** b;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '<': return num(a, '<') < num(b, '<') ? 1 : 0;
        case '<=': return num(a, '<=') <= num(b, '<=') ? 1 : 0;
        case '>': return num(a, '>') > num(b, '>') ? 1 : 0;
        case '>=': return num(a, '>=') >= num(b, '>=') ? 1 : 0;
        default: throw new Error(`unknown operator ${node.op}`);
      }
    }
    default: throw new Error('bad expression');
  }
}

const RESERVED = new Set([...Object.keys(FUNCS), 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']);

/** Räkna ut ett uttryck med variablerna. Flyttalsbrus rundas bort (0,1+0,2 = 0,3). */
function calc(src, scope) {
  const v = evaluate(parse(src), scope);
  return typeof v === 'number' ? Number(v.toPrecision(12)) : v;
}

// ── slump ────────────────────────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const newSeed = () => 1 + Math.floor(Math.random() * 2147483646);

/** Variablernas värden för ett frö, eller null om villkoren aldrig uppfylldes. */
function generate(template, seed) {
  const rand = mulberry32(seed);
  const wheres = (template.where || []).map((w) => parse(w));
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const vars = Object.create(null); // inga ärvda egenskaper att krocka med
    for (const v of template.vars || []) {
      if (v.int) {
        const [lo, hi] = v.int;
        vars[v.name] = lo + Math.floor(rand() * (hi - lo + 1));
      } else if (v.decimal) {
        const [lo, hi] = v.decimal;
        const d = v.decimals ?? 1;
        vars[v.name] = Number((lo + rand() * (hi - lo)).toFixed(d));
      } else if (v.pick) {
        vars[v.name] = v.pick[Math.floor(rand() * v.pick.length)];
      } else if (v.calc !== undefined) {
        vars[v.name] = calc(v.calc, vars);
      }
    }
    if (wheres.every((w) => evaluate(w, vars))) return vars;
  }
  return null;
}

// ── text ─────────────────────────────────────────────────────────────────────

const NBSP = ' ';

/** Svensk skrivning: 2,5 · 27 350 · −3 (i LaTeX: 2{,}5 · 27\,350). */
function formatSv(x, tex = false) {
  if (typeof x !== 'number') return String(x);
  const v = Number(x.toPrecision(12));
  const [int, dec] = Math.abs(v).toString().split('.');
  if (/e/i.test(int)) return String(v);
  const grouped = int.length >= 5 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, tex ? '\\,' : NBSP) : int;
  const sign = v < 0 ? (tex ? '-' : '−') : '';
  return `${sign}${grouped}${dec ? (tex ? `{,}${dec}` : `,${dec}`) : ''}`;
}

/** Byt {{n}}, {{n:tex}} och {{ uttryck }} mot värdena. */
function render(text, vars) {
  if (!text || !String(text).includes('{{')) return text;
  return String(text).replace(PLACEHOLDER, (_, inner) => {
    const tex = /:\s*tex\s*$/i.test(inner);
    const expr = inner.replace(/:\s*tex\s*$/i, '').replace(/^=\s*/, '');
    return formatSv(calc(expr, vars), tex);
  });
}

/** En instans av en mallövning: prompt, ledtrådar, lösning och svaret för fröet. */
function instance(item, seed) {
  const vars = generate(item.template, seed);
  if (!vars) throw new Error('template conditions could not be met');
  const value = calc(item.answer.expr, vars);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('the answer expression did not give a number');
  return {
    vars,
    prompt: render(item.prompt, vars),
    hints: (item.hints || []).map((h) => render(h, vars)),
    solution: render(item.solution, vars),
    answer: { ...(item.answer?.toObject ? item.answer.toObject() : item.answer), value }
  };
}

/**
 * Kontrollera en mall när AI:n skapar den: alla uttryck går att tolka, villkoren
 * går att uppfylla och svaret blir ett tal — i 30 olika instanser. Returnerar
 * { samples } (två exempel att visa AI:n) eller { error }.
 */
function validateTemplate({ template, answerExpr, texts }) {
  try {
    const names = new Set();
    for (const v of template.vars) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(v.name || '') || RESERVED.has(v.name)) return { error: `"${v.name}" can't be a variable name (letters, digits, _; not a function name)` };
      if (names.has(v.name)) return { error: `variable "${v.name}" is defined twice` };
      const kinds = ['int', 'decimal', 'pick', 'calc'].filter((k) => v[k] !== undefined);
      if (kinds.length !== 1) return { error: `variable "${v.name}" needs exactly one of int, decimal, pick or calc` };
      if (v.int && !(Number.isInteger(v.int[0]) && Number.isInteger(v.int[1]) && v.int[0] <= v.int[1])) return { error: `variable "${v.name}": int needs [min, max] whole numbers` };
      if (v.decimal && !(v.decimal[0] <= v.decimal[1])) return { error: `variable "${v.name}": decimal needs [min, max]` };
      if (v.calc !== undefined) parse(v.calc);
      names.add(v.name);
    }
    for (const w of template.where || []) parse(w);
    parse(answerExpr);
    const samples = [];
    for (let seed = 1; seed <= 30; seed++) {
      const vars = generate(template, seed);
      if (!vars) return { error: 'the where-conditions are (almost) never met — widen the ranges or loosen the conditions' };
      const value = calc(answerExpr, vars);
      if (typeof value !== 'number' || !Number.isFinite(value)) return { error: `the answer expression gave ${value} for ${JSON.stringify(vars)}` };
      const rendered = texts.map((t) => render(t, vars));
      if (samples.length < 2) samples.push({ vars, prompt: rendered[0], answer: value });
    }
    return { samples };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { parse, calc, generate, render, instance, validateTemplate, formatSv, newSeed, mulberry32, FUNCS };
