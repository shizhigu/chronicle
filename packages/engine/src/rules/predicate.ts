/**
 * Hard-rule predicate DSL — a small, safe expression language for compiled rules.
 *
 * The rule compiler emits strings like:
 *   - `character.alive`
 *   - `character.energy >= 5`
 *   - `action.args.content.length <= 280`
 *   - `character.locationId == action.args.destination || character.role == "admin"`
 *   - `!(character.mood == "enraged") && action.name != "attack"`
 *
 * We evaluate these against `{ character, action, world }` without ever touching
 * `eval()` or `Function()` — everything goes through a hand-rolled lexer + parser
 * + tree walker. The output is a boolean (or throws on malformed input; the
 * enforcer catches and defaults to "allow" with a logged warning).
 *
 * Supported grammar:
 *
 *   expr    := or
 *   or      := and ("||" and)*
 *   and     := not ("&&" not)*
 *   not     := "!" not | compare
 *   compare := primary (("==" | "!=" | ">=" | "<=" | ">" | "<") primary)?
 *   primary := number | string | bool | null | path | "(" expr ")"
 *   path    := ident ("." ident | "[" index "]")*
 *   ident   := [A-Za-z_][A-Za-z0-9_]*
 *   index   := number | string
 *
 * `.length` on strings / arrays is treated as a special property.
 */

export type PredicateContext = Record<string, unknown>;

export class PredicateError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly position?: number,
  ) {
    super(`${message} (at position ${position ?? '?'} in "${source}")`);
    this.name = 'PredicateError';
  }
}

// ============================================================
// Public entry points
// ============================================================

/** Evaluate `expr` against `ctx`. Throws PredicateError on malformed input. */
export function evaluatePredicate(expr: string, ctx: PredicateContext): boolean {
  const tokens = tokenize(expr);
  const parser = new Parser(expr, tokens);
  const ast = parser.parseExpression();
  parser.expectEof();
  const value = evaluate(ast, ctx);
  return toBool(value);
}

/** Safe variant: returns `fallback` instead of throwing on malformed input. */
export function evaluatePredicateSafe(
  expr: string,
  ctx: PredicateContext,
  fallback = true,
): boolean {
  try {
    return evaluatePredicate(expr, ctx);
  } catch {
    return fallback;
  }
}

// ============================================================
// Lexer
// ============================================================

type TokenKind =
  | 'number'
  | 'string'
  | 'ident'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'dot'
  | 'comma';

interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

const OPERATORS = ['==', '!=', '>=', '<=', '&&', '||', '>', '<', '!'];
const KEYWORDS = new Set(['true', 'false', 'null', 'undefined']);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Two-char ops first
    const two = src.slice(i, i + 2);
    if (OPERATORS.includes(two)) {
      tokens.push({ kind: 'op', value: two, pos: i });
      i += 2;
      continue;
    }

    if (ch === '(') {
      tokens.push({ kind: 'lparen', value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === '[') {
      tokens.push({ kind: 'lbracket', value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === ']') {
      tokens.push({ kind: 'rbracket', value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === '.') {
      tokens.push({ kind: 'dot', value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma', value: ch, pos: i });
      i++;
      continue;
    }
    if (OPERATORS.includes(ch)) {
      tokens.push({ kind: 'op', value: ch, pos: i });
      i++;
      continue;
    }

    // Numbers
    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < src.length && /[0-9.]/.test(src[i]!)) i++;
      tokens.push({ kind: 'number', value: src.slice(start, i), pos: start });
      continue;
    }

    // Strings — single or double quoted
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let acc = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) {
          const nxt = src[i + 1]!;
          acc += nxt === 'n' ? '\n' : nxt === 't' ? '\t' : nxt;
          i += 2;
        } else {
          acc += src[i];
          i++;
        }
      }
      if (i >= src.length) {
        throw new PredicateError('unterminated string', src, start);
      }
      i++; // consume closing quote
      tokens.push({ kind: 'string', value: acc, pos: start });
      continue;
    }

    // Identifier / keyword
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i++;
      tokens.push({ kind: 'ident', value: src.slice(start, i), pos: start });
      continue;
    }

    throw new PredicateError(`unexpected character ${JSON.stringify(ch)}`, src, i);
  }
  return tokens;
}

// ============================================================
// Parser — recursive descent with pratt-style precedence
// ============================================================

type Node =
  | { type: 'literal'; value: number | string | boolean | null }
  | { type: 'path'; segments: Array<{ kind: 'prop' | 'index'; value: string | number }> }
  | { type: 'unary'; op: '!'; arg: Node }
  | { type: 'binary'; op: string; left: Node; right: Node };

class Parser {
  private pos = 0;
  constructor(
    private readonly src: string,
    private readonly tokens: Token[],
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private advance(): Token | undefined {
    return this.tokens[this.pos++];
  }
  private match(kind: TokenKind, value?: string): Token | undefined {
    const t = this.peek();
    if (!t) return undefined;
    if (t.kind !== kind) return undefined;
    if (value !== undefined && t.value !== value) return undefined;
    this.pos++;
    return t;
  }

  expectEof(): void {
    if (this.pos < this.tokens.length) {
      const t = this.peek()!;
      throw new PredicateError(
        `unexpected trailing token ${JSON.stringify(t.value)}`,
        this.src,
        t.pos,
      );
    }
  }

  parseExpression(): Node {
    return this.parseOr();
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.peek()?.kind === 'op' && this.peek()?.value === '||') {
      this.advance();
      const right = this.parseAnd();
      left = { type: 'binary', op: '||', left, right };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.peek()?.kind === 'op' && this.peek()?.value === '&&') {
      this.advance();
      const right = this.parseNot();
      left = { type: 'binary', op: '&&', left, right };
    }
    return left;
  }

  private parseNot(): Node {
    if (this.peek()?.kind === 'op' && this.peek()?.value === '!') {
      this.advance();
      const arg = this.parseNot();
      return { type: 'unary', op: '!', arg };
    }
    return this.parseCompare();
  }

  private parseCompare(): Node {
    const left = this.parsePrimary();
    const t = this.peek();
    if (t?.kind === 'op' && ['==', '!=', '>=', '<=', '>', '<'].includes(t.value)) {
      this.advance();
      const right = this.parsePrimary();
      return { type: 'binary', op: t.value, left, right };
    }
    return left;
  }

  private parsePrimary(): Node {
    const t = this.advance();
    if (!t) {
      throw new PredicateError('unexpected end of expression', this.src);
    }
    if (t.kind === 'lparen') {
      const inner = this.parseExpression();
      const r = this.advance();
      if (!r || r.kind !== 'rparen') {
        throw new PredicateError('missing closing parenthesis', this.src, t.pos);
      }
      return inner;
    }
    if (t.kind === 'number') {
      return { type: 'literal', value: Number(t.value) };
    }
    if (t.kind === 'string') {
      return { type: 'literal', value: t.value };
    }
    if (t.kind === 'ident') {
      if (KEYWORDS.has(t.value)) {
        return {
          type: 'literal',
          value: t.value === 'true' ? true : t.value === 'false' ? false : null,
        };
      }
      // Parse path
      const segments: Array<{ kind: 'prop' | 'index'; value: string | number }> = [];
      segments.push({ kind: 'prop', value: t.value });
      while (true) {
        if (this.match('dot')) {
          const name = this.advance();
          if (!name || name.kind !== 'ident') {
            throw new PredicateError('expected property name after "."', this.src, t.pos);
          }
          segments.push({ kind: 'prop', value: name.value });
        } else if (this.match('lbracket')) {
          const key = this.advance();
          if (!key) throw new PredicateError('expected index', this.src, t.pos);
          if (key.kind === 'number') {
            segments.push({ kind: 'index', value: Number(key.value) });
          } else if (key.kind === 'string') {
            segments.push({ kind: 'index', value: key.value });
          } else {
            throw new PredicateError('index must be number or string', this.src, key.pos);
          }
          const close = this.advance();
          if (!close || close.kind !== 'rbracket') {
            throw new PredicateError('missing "]"', this.src, t.pos);
          }
        } else {
          break;
        }
      }
      return { type: 'path', segments };
    }
    throw new PredicateError(`unexpected token ${JSON.stringify(t.value)}`, this.src, t.pos);
  }
}

// ============================================================
// Evaluator
// ============================================================

function evaluate(node: Node, ctx: PredicateContext): unknown {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'path':
      return evaluatePath(node.segments, ctx);
    case 'unary':
      return !toBool(evaluate(node.arg, ctx));
    case 'binary': {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      return applyBinary(node.op, l, r);
    }
  }
}

function evaluatePath(
  segments: Array<{ kind: 'prop' | 'index'; value: string | number }>,
  ctx: PredicateContext,
): unknown {
  let cur: unknown = ctx;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (seg.kind === 'prop') {
      const name = String(seg.value);
      if (name === 'length' && (typeof cur === 'string' || Array.isArray(cur))) {
        cur = (cur as string | unknown[]).length;
      } else if (typeof cur === 'object') {
        cur = (cur as Record<string, unknown>)[name];
      } else {
        return undefined;
      }
    } else {
      const key = seg.value;
      if (Array.isArray(cur)) {
        cur = cur[Number(key)];
      } else if (cur && typeof cur === 'object') {
        cur = (cur as Record<string, unknown>)[String(key)];
      } else {
        return undefined;
      }
    }
  }
  return cur;
}

function applyBinary(op: string, l: unknown, r: unknown): unknown {
  switch (op) {
    case '&&':
      return toBool(l) && toBool(r);
    case '||':
      return toBool(l) || toBool(r);
    case '==':
      return looseEq(l, r);
    case '!=':
      return !looseEq(l, r);
    case '>':
      return Number(l) > Number(r);
    case '<':
      return Number(l) < Number(r);
    case '>=':
      return Number(l) >= Number(r);
    case '<=':
      return Number(l) <= Number(r);
    default:
      throw new PredicateError(`unknown operator ${op}`, '');
  }
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
  if (typeof b === 'number' && typeof a === 'string') return b === Number(a);
  return false;
}

function toBool(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
