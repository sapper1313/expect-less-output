// A small, safe arithmetic evaluator. The Math Checker uses it so every number is checked by running code,
// never by trusting a language model's own arithmetic. No eval, no Function.

const OPS: Record<string, { prec: number; right?: boolean; fn: (a: number, b: number) => number }> = {
  '+': { prec: 1, fn: (a, b) => a + b },
  '-': { prec: 1, fn: (a, b) => a - b },
  '*': { prec: 2, fn: (a, b) => a * b },
  '/': { prec: 2, fn: (a, b) => a / b },
  '%': { prec: 2, fn: (a, b) => a % b },
  '^': { prec: 3, right: true, fn: (a, b) => Math.pow(a, b) },
}

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
}

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: '(' } | { t: ')' } | { t: 'fn'; v: string } | { t: ',' }

function tokenize(src: string): Tok[] {
  const s = src
    .replaceAll('×', '*')
    .replaceAll('÷', '/')
    .replace(/(\d)\s*x\s*(?=[\d(])/gi, '$1*')
    .replace(/,(?=\d{3}(\D|$))/g, '')
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      const v = Number(s.slice(i, j))
      if (!Number.isFinite(v)) throw new Error(`Bad number "${s.slice(i, j)}".`)
      out.push({ t: 'num', v })
      i = j
      continue
    }
    if (/[a-z]/i.test(c)) {
      let j = i
      while (j < s.length && /[a-z]/i.test(s[j])) j++
      const name = s.slice(i, j).toLowerCase()
      if (name === 'pi') out.push({ t: 'num', v: Math.PI })
      else if (FUNCS[name]) out.push({ t: 'fn', v: name })
      else throw new Error(`Unknown word "${name}" in the expression.`)
      i = j
      continue
    }
    if (c === '(' || c === ')' || c === ',') {
      out.push({ t: c } as Tok)
      i++
      continue
    }
    if (OPS[c]) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    throw new Error(`Unexpected "${c}" in the expression.`)
  }
  return out
}

/** Evaluates an arithmetic expression. Throws a plain Error when it cannot. */
export function evaluate(expr: string): number {
  const toks = tokenize(expr)
  const output: Array<number | { fn: string; argc: number } | string> = []
  const stack: Array<Tok | { t: 'u' }> = []
  const argc: number[] = []
  let prev: Tok | null = null
  for (const tok of toks) {
    if (tok.t === 'num') output.push(tok.v)
    else if (tok.t === 'fn') stack.push(tok)
    else if (tok.t === ',') {
      while (stack.length && stack[stack.length - 1].t !== '(') output.push(popOp(stack))
      if (argc.length) argc[argc.length - 1]++
    } else if (tok.t === 'op') {
      const unary = !prev || prev.t === 'op' || prev.t === '(' || prev.t === ','
      if (unary) {
        if (tok.v === '-') stack.push({ t: 'u' })
        else if (tok.v !== '+') throw new Error('The expression is not valid.')
      } else {
        const o1 = OPS[tok.v]
        while (stack.length) {
          const top = stack[stack.length - 1]
          if (top.t === 'u') {
            output.push(popOp(stack))
            continue
          }
          if (top.t !== 'op') break
          const o2 = OPS[top.v]
          if (o2.prec > o1.prec || (o2.prec === o1.prec && !o1.right)) output.push(popOp(stack))
          else break
        }
        stack.push(tok)
      }
    } else if (tok.t === '(') {
      if (prev?.t === 'fn') argc.push(1)
      stack.push(tok)
    } else if (tok.t === ')') {
      while (stack.length && stack[stack.length - 1].t !== '(') output.push(popOp(stack))
      if (!stack.length) throw new Error('A bracket is missing.')
      stack.pop()
      const top = stack[stack.length - 1]
      if (top && top.t === 'fn') {
        stack.pop()
        output.push({ fn: top.v, argc: argc.pop() ?? 1 })
      }
    }
    prev = tok
  }
  while (stack.length) {
    const top = stack[stack.length - 1]
    if (top.t === '(') throw new Error('A bracket is missing.')
    output.push(popOp(stack))
  }
  const st: number[] = []
  for (const item of output) {
    if (typeof item === 'number') st.push(item)
    else if (typeof item === 'string') {
      if (item === 'u') {
        const a = st.pop()
        if (a === undefined) throw new Error('The expression is not valid.')
        st.push(-a)
      } else {
        const b = st.pop()
        const a = st.pop()
        if (a === undefined || b === undefined) throw new Error('The expression is not valid.')
        st.push(OPS[item].fn(a, b))
      }
    } else {
      const args = st.splice(st.length - item.argc, item.argc)
      st.push(FUNCS[item.fn](...args))
    }
  }
  if (st.length !== 1 || !Number.isFinite(st[0])) throw new Error('The expression did not give a number.')
  return st[0]
}

function popOp(stack: Array<Tok | { t: 'u' }>): string {
  const top = stack.pop() as Tok | { t: 'u' }
  if (top.t === 'u') return 'u'
  if (top.t === 'op') return top.v
  throw new Error('The expression is not valid.')
}

export function closeEnough(a: number, b: number, tolerance = 0.005): boolean {
  return Math.abs(a - b) <= Math.max(Math.abs(b) * tolerance, 1e-9) || Math.abs(a - b) < 0.0051
}

// ---------- number words and counted objects ----------

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
}

export function wordToNumber(w: string): number | null {
  const t = w.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (/^\d+$/.test(t)) return Number(t)
  return t in WORDS ? WORDS[t] : null
}

/** Every number (digits or words) in a text, in order. */
export function numbersIn(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/[A-Za-z]+|\d+/g)) {
    const n = wordToNumber(m[0])
    if (n !== null) out.push(n)
  }
  return out
}

export interface MathClaim {
  text: string
  expression: string
  claimed: number
}

/** Finds "7 x 8 = 56" style statements and percent statements in plain text. */
export function extractClaims(text: string): MathClaim[] {
  const claims: MathClaim[] = []
  const num = String.raw`\d[\d,]*(?:\.\d+)?`
  const chain = new RegExp(
    String.raw`((?:\$?${num})(?:\s*(?:[+x×*\/÷]|\s-\s)\s*\$?${num})+)\s*(?:=|equals|is|makes|gives|comes to|adds up to)\s*\$?(${num})`,
    'gi',
  )
  for (const m of text.matchAll(chain)) {
    claims.push({ text: m[0], expression: m[1].replaceAll('$', ''), claimed: Number(m[2].replaceAll(',', '')) })
  }
  const pct = new RegExp(String.raw`(${num})%\s+of\s+\$?(${num})\s*(?:=|equals|is|makes|gives)\s*\$?(${num})`, 'gi')
  for (const m of text.matchAll(pct)) {
    claims.push({
      text: m[0],
      expression: `${m[1].replaceAll(',', '')}/100*${m[2].replaceAll(',', '')}`,
      claimed: Number(m[3].replaceAll(',', '')),
    })
  }
  return claims
}

export interface ClaimResult {
  text: string
  expression: string
  claimed: number
  actual: number | null
  ok: boolean
  error?: string
}

export function checkClaims(claims: MathClaim[]): ClaimResult[] {
  return claims.map((c) => {
    try {
      const actual = evaluate(c.expression)
      return { ...c, actual, ok: closeEnough(actual, c.claimed) }
    } catch (e) {
      return { ...c, actual: null, ok: false, error: (e as Error).message }
    }
  })
}
