/**
 * Hard-rule predicate DSL — a small, safe expression language for compiled rules.
 *
 * The rule compiler emits strings like:
 *   - `character.alive`
 *   - `character.energy >= 5`
 *   - `character.energy - action.cost >= 0`
 *   - `action.args.content.length <= 280`
 *   - `action.args.target in character.allies`
 *   - `!action.args.content.includes("secret")`
 *   - `character.name.toLowerCase() == "alice"`
 *   - `character.locationId == action.args.destination || character.role == "admin"`
 *
 * We evaluate these against `{ character, action, world }` without ever touching
 * `eval()` or `Function()` — everything goes through a hand-rolled lexer + parser
 * + tree walker. The output is a boolean (or throws on malformed input; the
 * enforcer catches and defaults to "allow" with a logged warning).
 *
 * Supported grammar (precedence low → high):
 *
 *   expr     := or
 *   or       := and ("||" and)*
 *   and      := notOp ("&&" notOp)*
 *   notOp    := "!" notOp | inOp
 *   inOp     := compare ("in" compare)?
 *   compare  := add (cmpop add)?
 *   add      := mul (("+" | "-") mul)*
 *   mul      := unary (("*" | "/" | "%") unary)*
 *   unary    := "-" unary | primary
 *   primary  := number | string | bool | null | path | "(" expr ")"
 *   path     := ident pathTail*
 *   pathTail := "." ident ("(" (expr ("," expr)*)? ")")?       # method or property
 *            | "[" (number | string) "]"
 *
 * Method calls are whitelisted: `includes`, `startsWith`, `endsWith`,
 * `toLowerCase`, `toUpperCase`, `trim`. No arbitrary JS is reachable.
 * `.length` on strings/arrays is a recognized pseudo-property.
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

// Multi-char operators checked before single-char; order matters for longest-match.
const MULTI_CHAR_OPS = ['==', '!=', '>=', '<=', '&&', '||'];
const SINGLE_CHAR_OPS = ['>', '<', '!', '+', '-', '*', '/', '%'];
// Identifiers we treat specially in `parseAtom`. Kept as documentation —
// the actual recognition happens inline by value comparison.
// (`in` is also here but used as an operator keyword by the parser.)
const ALLOWED_METHODS = new Set([
  'includes',
  'startsWith',
  'endsWith',
  'toLowerCase',
  'toUpperCase',
  'trim',
]);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (MULTI_CHAR_OPS.includes(two)) {
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
      // Disambiguate: `.5` (number) vs `.name` (dot-access). If next char is digit,
      // still treat as dot — numbers must start with a digit in this grammar.
      tokens.push({ kind: 'dot', value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma', value: ch, pos: i });
      i++;
      continue;
    }
    if (SINGLE_CHAR_OPS.includes(ch)) {
      tokens.push({ kind: 'op', value: ch, pos: i });
      i++;
      continue;
    }

    // Numbers — integer or decimal
    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < src.length && /[0-9]/.test(src[i]!)) i++;
      if (src[i] === '.') {
        i++;
        while (i < src.length && /[0-9]/.test(src[i]!)) i++;
      }
      tokens.push({ kind: 'number', value: src.slice(start, i), pos: start });
      continue;
    }

    // Strings — single or double quoted, with a small escape set
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
      i++;
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
// AST
// ============================================================

type PathSegment =
  | { kind: 'prop'; name: string }
  | { kind: 'index'; value: string | number }
  | { kind: 'method'; name: string; args: Node[] };

type Node =
  | { type: 'literal'; value: number | string | boolean | null }
  | { type: 'path'; segments: PathSegment[] }
  | { type: 'chain'; receiver: Node; segments: PathSegment[] }
  | { type: 'unary'; op: '!' | '-'; arg: Node }
  | { type: 'binary'; op: string; left: Node; right: Node };

// ============================================================
// Parser — recursive descent
// ============================================================

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
      return { type: 'unary', op: '!', arg: this.parseNot() };
    }
    return this.parseIn();
  }

  private parseIn(): Node {
    const left = this.parseCompare();
    if (this.peek()?.kind === 'ident' && this.peek()?.value === 'in') {
      this.advance();
      const right = this.parseCompare();
      return { type: 'binary', op: 'in', left, right };
    }
    return left;
  }

  private parseCompare(): Node {
    const left = this.parseAdd();
    const t = this.peek();
    if (t?.kind === 'op' && ['==', '!=', '>=', '<=', '>', '<'].includes(t.value)) {
      this.advance();
      const right = this.parseAdd();
      return { type: 'binary', op: t.value, left, right };
    }
    return left;
  }

  private parseAdd(): Node {
    let left = this.parseMul();
    while (
      this.peek()?.kind === 'op' &&
      (this.peek()?.value === '+' || this.peek()?.value === '-')
    ) {
      const op = this.advance()!.value;
      const right = this.parseMul();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  private parseMul(): Node {
    let left = this.parseUnary();
    while (
      this.peek()?.kind === 'op' &&
      (this.peek()?.value === '*' || this.peek()?.value === '/' || this.peek()?.value === '%')
    ) {
      const op = this.advance()!.value;
      const right = this.parseUnary();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.peek()?.kind === 'op' && this.peek()?.value === '-') {
      this.advance();
      return { type: 'unary', op: '-', arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const base = this.parseAtom();
    return this.parseTailsOn(base);
  }

  private parseAtom(): Node {
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
    if (t.kind === 'number') return { type: 'literal', value: Number(t.value) };
    if (t.kind === 'string') return { type: 'literal', value: t.value };
    if (t.kind === 'ident') {
      if (t.value === 'true') return { type: 'literal', value: true };
      if (t.value === 'false') return { type: 'literal', value: false };
      if (t.value === 'null' || t.value === 'undefined') return { type: 'literal', value: null };
      if (t.value === 'in') {
        throw new PredicateError('"in" cannot start an expression', this.src, t.pos);
      }
      return { type: 'path', segments: [{ kind: 'prop', name: t.value }] };
    }
    throw new PredicateError(`unexpected token ${JSON.stringify(t.value)}`, this.src, t.pos);
  }

  /** Eat `.prop`, `.method(args?)`, and `[index]` tails off any base node. */
  private parseTailsOn(base: Node): Node {
    const tails: PathSegment[] = [];
    while (true) {
      if (this.match('dot')) {
        const name = this.advance();
        if (!name || name.kind !== 'ident') {
          throw new PredicateError('expected property name after "."', this.src);
        }
        if (this.match('lparen')) {
          if (!ALLOWED_METHODS.has(name.value)) {
            throw new PredicateError(
              `method "${name.value}" is not allowed. Whitelist: ${[...ALLOWED_METHODS].join(', ')}`,
              this.src,
              name.pos,
            );
          }
          const args: Node[] = [];
          if (!this.match('rparen')) {
            args.push(this.parseExpression());
            while (this.match('comma')) args.push(this.parseExpression());
            const rp = this.advance();
            if (!rp || rp.kind !== 'rparen') {
              throw new PredicateError('missing ")" after method args', this.src, name.pos);
            }
          }
          tails.push({ kind: 'method', name: name.value, args });
        } else {
          tails.push({ kind: 'prop', name: name.value });
        }
      } else if (this.match('lbracket')) {
        const key = this.advance();
        if (!key) throw new PredicateError('expected index', this.src);
        if (key.kind === 'number') {
          tails.push({ kind: 'index', value: Number(key.value) });
        } else if (key.kind === 'string') {
          tails.push({ kind: 'index', value: key.value });
        } else {
          throw new PredicateError('index must be number or string literal', this.src, key.pos);
        }
        const close = this.advance();
        if (!close || close.kind !== 'rbracket') {
          throw new PredicateError('missing "]"', this.src);
        }
      } else {
        break;
      }
    }

    if (tails.length === 0) return base;
    // Merge into an existing path when possible for uniform eval;
    // otherwise use a chain node that first evaluates the receiver.
    if (base.type === 'path') {
      return { type: 'path', segments: [...base.segments, ...tails] };
    }
    return { type: 'chain', receiver: base, segments: tails };
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
      return walkSegments(ctx, node.segments, ctx);
    case 'chain':
      return walkSegments(evaluate(node.receiver, ctx), node.segments, ctx);
    case 'unary':
      if (node.op === '!') return !toBool(evaluate(node.arg, ctx));
      if (node.op === '-') {
        const v = evaluate(node.arg, ctx);
        return -Number(v);
      }
      return undefined;
    case 'binary': {
      // Short-circuit && and ||
      if (node.op === '&&') {
        const l = evaluate(node.left, ctx);
        if (!toBool(l)) return false;
        return toBool(evaluate(node.right, ctx));
      }
      if (node.op === '||') {
        const l = evaluate(node.left, ctx);
        if (toBool(l)) return true;
        return toBool(evaluate(node.right, ctx));
      }
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      return applyBinary(node.op, l, r);
    }
  }
}

function walkSegments(start: unknown, segments: PathSegment[], ctx: PredicateContext): unknown {
  let cur: unknown = start;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;

    if (seg.kind === 'prop') {
      if (seg.name === 'length' && (typeof cur === 'string' || Array.isArray(cur))) {
        cur = (cur as string | unknown[]).length;
      } else if (typeof cur === 'object') {
        cur = (cur as Record<string, unknown>)[seg.name];
      } else {
        return undefined;
      }
    } else if (seg.kind === 'index') {
      if (Array.isArray(cur)) {
        cur = cur[Number(seg.value)];
      } else if (cur && typeof cur === 'object') {
        cur = (cur as Record<string, unknown>)[String(seg.value)];
      } else {
        return undefined;
      }
    } else if (seg.kind === 'method') {
      const args = seg.args.map((a) => evaluate(a, ctx));
      cur = invokeMethod(cur, seg.name, args);
    }
  }
  return cur;
}

function invokeMethod(receiver: unknown, method: string, args: unknown[]): unknown {
  if (receiver === null || receiver === undefined) return undefined;

  if (typeof receiver === 'string') {
    switch (method) {
      case 'includes':
        return typeof args[0] === 'string' ? receiver.includes(args[0]) : false;
      case 'startsWith':
        return typeof args[0] === 'string' ? receiver.startsWith(args[0]) : false;
      case 'endsWith':
        return typeof args[0] === 'string' ? receiver.endsWith(args[0]) : false;
      case 'toLowerCase':
        return receiver.toLowerCase();
      case 'toUpperCase':
        return receiver.toUpperCase();
      case 'trim':
        return receiver.trim();
      default:
        return undefined;
    }
  }

  if (Array.isArray(receiver)) {
    switch (method) {
      case 'includes':
        return receiver.includes(args[0]);
      default:
        return undefined;
    }
  }

  return undefined;
}

function applyBinary(op: string, l: unknown, r: unknown): unknown {
  switch (op) {
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
    case '+':
      // String concatenation if either side is a string; else numeric.
      if (typeof l === 'string' || typeof r === 'string') return `${l ?? ''}${r ?? ''}`;
      return Number(l) + Number(r);
    case '-':
      return Number(l) - Number(r);
    case '*':
      return Number(l) * Number(r);
    case '/': {
      const rn = Number(r);
      if (rn === 0) return Number.NaN;
      return Number(l) / rn;
    }
    case '%': {
      const rn = Number(r);
      if (rn === 0) return Number.NaN;
      return Number(l) % rn;
    }
    case 'in':
      if (Array.isArray(r)) return r.includes(l);
      if (typeof r === 'string' && typeof l === 'string') return r.includes(l);
      if (r && typeof r === 'object') return Object.prototype.hasOwnProperty.call(r, String(l));
      return false;
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
