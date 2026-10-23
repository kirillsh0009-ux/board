/**
 * Safe math expression parser + evaluator for the [func] graph editor.
 * No eval / new Function — hand-written tokenizer + recursive descent parser.
 *
 * Supported syntax:
 *   numbers: 12, 3.5, .5          variables: x, y
 *   constants: pi (π), e          operators: + - * / ^  (unary minus)
 *   implicit multiplication: 2x, 3sin(x), (x+1)(x-1), x(x+1)
 *   equation form: "x^2 + y^2 = 4"  ->  compiled as F(x,y) = left - right
 *   functions: sin cos tan asin acos atan sinh cosh tanh sqrt abs ln log
 *              exp floor ceil round sign  min(a,b) max(a,b) mod(a,b) atan2(a,b)
 */

export interface CompiledExpr {
  raw: string
  /** human-readable error in Russian, or null when the expression compiles */
  error: string | null
  /** true when the expression depends on y (implicit plot / equation) */
  usesY: boolean
  /** evaluator; NaN on math errors (div by zero, domain, overflow) */
  f: (x: number, y: number) => number
}

interface Token {
  kind: 'num' | 'ident' | 'op'
  value: string
  pos: number
}

const FUNCTIONS: Record<string, { arity: number; fn: (...args: number[]) => number }> = {
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  asin: { arity: 1, fn: Math.asin },
  acos: { arity: 1, fn: Math.acos },
  atan: { arity: 1, fn: Math.atan },
  sinh: { arity: 1, fn: Math.sinh },
  cosh: { arity: 1, fn: Math.cosh },
  tanh: { arity: 1, fn: Math.tanh },
  sqrt: { arity: 1, fn: Math.sqrt },
  abs: { arity: 1, fn: Math.abs },
  ln: { arity: 1, fn: Math.log },
  log: { arity: 1, fn: Math.log10 },
  exp: { arity: 1, fn: Math.exp },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  round: { arity: 1, fn: Math.round },
  sign: { arity: 1, fn: Math.sign },
  min: { arity: 2, fn: Math.min },
  max: { arity: 2, fn: Math.max },
  mod: { arity: 2, fn: (a, b) => a - b * Math.floor(a / (b || NaN)) },
  atan2: { arity: 2, fn: Math.atan2 },
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, 'π': Math.PI, e: Math.E }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t') {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      const start = i
      while (i < src.length && /[0-9.]/.test(src[i])) i++
      const value = src.slice(start, i)
      if ((value.match(/\./g) || []).length > 1) throw new Error(`некорректное число «${value}»`)
      tokens.push({ kind: 'num', value, pos: start })
      continue
    }
    if (/[a-zA-Zа-яА-Яπ_]/.test(c)) {
      const start = i
      while (i < src.length && /[a-zA-Zа-яА-Я0-9π_]/.test(src[i])) i++
      tokens.push({ kind: 'ident', value: src.slice(start, i), pos: start })
      continue
    }
    if ('+-*/^(),'.includes(c)) {
      tokens.push({ kind: 'op', value: c, pos: i })
      i++
      continue
    }
    throw new Error(`непонятный символ «${c}»`)
  }
  return tokens
}

type EvalFn = (x: number, y: number) => number

class Parser {
  private pos = 0
  usesY = false

  constructor(private tokens: Token[]) {}

  private peek(): Token | null {
    return this.tokens[this.pos] ?? null
  }

  private eat(kind: Token['kind'], value?: string): Token {
    const t = this.tokens[this.pos]
    if (!t || t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new Error(value ? `ожидалось «${value}»` : 'неожиданное выражение')
    }
    this.pos++
    return t
  }

  private isOp(value: string): boolean {
    const t = this.peek()
    return !!t && t.kind === 'op' && t.value === value
  }

  parse(): EvalFn {
    const node = this.parseExpr()
    if (this.pos < this.tokens.length) throw new Error('лишние символы в конце')
    return node
  }

  private parseExpr(): EvalFn {
    let left = this.parseTerm()
    for (;;) {
      if (this.isOp('+')) {
        this.pos++
        const right = this.parseTerm()
        const l = left
        left = (x, y) => l(x, y) + right(x, y)
      } else if (this.isOp('-')) {
        this.pos++
        const right = this.parseTerm()
        const l = left
        left = (x, y) => l(x, y) - right(x, y)
      } else return left
    }
  }

  private parseTerm(): EvalFn {
    let left = this.parseUnary()
    for (;;) {
      if (this.isOp('*')) {
        this.pos++
        const right = this.parseUnary()
        const l = left
        left = (x, y) => l(x, y) * right(x, y)
      } else if (this.isOp('/')) {
        this.pos++
        const right = this.parseUnary()
        const l = left
        left = (x, y) => l(x, y) / right(x, y)
      } else {
        // implicit multiplication: 2x, 3(x+1), x(x-1), (x+1)(x-1), 2sin(x)
        const t = this.peek()
        const startsAtom = !!t && (t.kind === 'num' || t.kind === 'ident' || (t.kind === 'op' && t.value === '('))
        if (startsAtom) {
          const right = this.parseUnary()
          const l = left
          left = (x, y) => l(x, y) * right(x, y)
        } else return left
      }
    }
  }

  private parseUnary(): EvalFn {
    if (this.isOp('-')) {
      this.pos++
      const inner = this.parseUnary()
      return (x, y) => -inner(x, y)
    }
    if (this.isOp('+')) {
      this.pos++
      return this.parseUnary()
    }
    return this.parsePower()
  }

  private parsePower(): EvalFn {
    const base = this.parseAtom()
    if (this.isOp('^')) {
      this.pos++
      const exponent = this.parseUnary() // right-assoc: 2^3^2 = 2^(3^2); 2^-3 works
      const b = base
      return (x, y) => Math.pow(b(x, y), exponent(x, y))
    }
    return base
  }

  private parseAtom(): EvalFn {
    const t = this.peek()
    if (!t) throw new Error('выражение не закончено')
    if (t.kind === 'num') {
      this.pos++
      const v = parseFloat(t.value)
      if (!isFinite(v)) throw new Error(`некорректное число «${t.value}»`)
      return () => v
    }
    if (t.kind === 'op' && t.value === '(') {
      this.pos++
      const inner = this.parseExpr()
      this.eat('op', ')')
      return inner
    }
    if (t.kind === 'ident') {
      this.pos++
      const name = t.value.toLowerCase()
      const fn = FUNCTIONS[name]
      if (fn) {
        this.eat('op', '(')
        const args: EvalFn[] = []
        if (!this.isOp(')')) {
          args.push(this.parseExpr())
          while (this.isOp(',')) {
            this.pos++
            args.push(this.parseExpr())
          }
        }
        this.eat('op', ')')
        if (args.length !== fn.arity) {
          throw new Error(`«${name}» ожидает ${fn.arity} аргумент(ов)`)
        }
        if (fn.arity === 1) {
          const [a] = args
          const g = fn.fn
          return (x, y) => g(a(x, y))
        }
        const [a, b] = args
        const g = fn.fn
        return (x, y) => g(a(x, y), b(x, y))
      }
      if (name in CONSTANTS) {
        const v = CONSTANTS[name]
        return () => v
      }
      if (name === 'x' || name === 'y' || name === 'х' || name === 'у') {
        // latin + cyrillic lookalikes
        if (name === 'y' || name === 'у') this.usesY = true
        return name === 'x' || name === 'х' ? (x) => x : (_x, y) => y
      }
      throw new Error(`неизвестное имя «${t.value}»`)
    }
    throw new Error(`неожиданный символ «${t.value}»`)
  }
}

/** compile a single expression (or equation) */
export function compileOne(input: string): CompiledExpr {
  const raw = input.trim()
  if (!raw) return { raw, error: null, usesY: false, f: () => NaN }
  try {
    // top-level '=' -> F(x,y) = left - right
    let body = raw
    let depth = 0
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === '=' && depth === 0) {
        if (!raw.slice(i + 1).trim()) throw new Error('пустая правая часть уравнения')
        body = `(${raw.slice(0, i)})-(${raw.slice(i + 1)})`
        break
      } else if (c === '=' && depth !== 0) {
        throw new Error('«=» только на верхнем уровне')
      }
    }
    const parser = new Parser(tokenize(body))
    const node = parser.parse()
    return { raw, error: null, usesY: parser.usesY, f: node }
  } catch (err) {
    return { raw, error: (err as Error).message || 'ошибка', usesY: false, f: () => NaN }
  }
}

/** split the expression string on ";" or newlines, max 6 functions */
export function splitExprs(exprStr: string): string[] {
  return exprStr
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6)
}

export function compileAll(exprStr: string): CompiledExpr[] {
  return splitExprs(exprStr).map(compileOne)
}

/** nice grid step in world units for a given px-per-unit scale (>= ~64px) */
export function niceStep(scale: number): number {
  const target = 64 / scale
  const p = Math.pow(10, Math.floor(Math.log10(target)))
  for (const m of [1, 2, 5, 10]) {
    if (m * p >= target) return m * p
  }
  return 10 * p
}

/** format a tick label compactly */
export function fmtTick(v: number, step: number): string {
  if (Math.abs(v) < step / 2) return '0'
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)))
  return v.toFixed(decimals)
}
