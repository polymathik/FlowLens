/**
 * References that are neither calls nor plain reads (TS/JS/TSX/JSX).
 *
 *   app.get('/x', handler)        emitter.on('e', this.onEvent)      xs.map(format)
 *   export default { save }       const routes = [{ run: start }]
 *   <Panel onClick={open} />      <Panel />                          <ui.Button />
 *
 * The first three put a function/method/class in the hands of other code; the
 * route-table forms register it; JSX attributes bind it to markup. Each becomes
 * a `use` edge from the enclosing owner (`meta.ref` says which form, `ref_via`
 * names the callee / attribute); a JSX element `<Comp />` is a `create` edge.
 *
 * Precision rules: the name must be a same-file entity or a project import
 * (optional relation, so unresolved names disappear silently); a name declared
 * as a parameter or local of an enclosing function shadows the entity and is
 * skipped; at module scope only function/method/class/component targets count
 * (a `main(CONFIG)` argument is a read, not a hand-off).
 */
import type { SgNode } from '@ast-grep/napi';
import type { EntityKind } from '../../contracts/entities.js';
import type { RelationMeta } from '../../contracts/relations.js';
import type { ScopeFrame, TsRelationContext } from './ts-context.js';
import { ownerOptions, refText, sameNode } from './ts-context.js';

const FUNCTIONAL: EntityKind[] = ['function', 'method', 'class', 'component'];
const WITH_VALUES: EntityKind[] = [...FUNCTIONAL, 'variable', 'field', 'enum_member'];
const JSX_TAGS = new Set(['jsx_opening_element', 'jsx_self_closing_element', 'jsx_closing_element']);
const WRAPPERS = new Set(['parenthesized_expression', 'as_expression', 'satisfies_expression', 'non_null_expression']);
const MAX_DEPTH = 6;

export interface RefContext { ref: NonNullable<RelationMeta['ref']>; via: string | null; route?: string }

const ROUTE_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'use', 'route']);

/** Callee of a call / `new` as written, `.name` for a member call on a non-trivial receiver. */
function calleeText(call: SgNode): string | null {
  const isNew = call.kind() === 'new_expression';
  const callee = call.children().find((c) => c.kind() !== 'new');
  if (!callee) return null;
  const text = refText(callee);
  if (text) return isNew ? `new ${text}` : text;
  if (callee.kind() === 'member_expression') {
    const prop = callee.children().at(-1);
    return prop && prop.kind() === 'property_identifier' ? `.${prop.text()}` : null;
  }
  return null;
}

function attributeName(expr: SgNode): string | null {
  const attr = expr.parent();
  if (!attr || attr.kind() !== 'jsx_attribute') return null;
  const name = attr.children()[0];
  return name ? name.text() : null;
}

/** `GET /x` for `app.get('/x', handler)`: a verb-named callee whose first argument is a path literal. */
function routeOf(call: SgNode, args: SgNode): string | undefined {
  const callee = call.children()[0];
  const verb = callee && callee.kind() === 'member_expression' ? callee.children().at(-1)?.text() : undefined;
  if (!verb || !ROUTE_VERBS.has(verb)) return undefined;
  const first = args.children().find((c) => c.kind() !== '(');
  if (!first || first.kind() !== 'string') return undefined;
  const path = first.text().slice(1, -1);
  return /^[/*]/.test(path) ? `${verb.toUpperCase()} ${path}` : undefined;
}

/**
 * Is `node` (an identifier / `this.member`) a hand-off position? Climbs through
 * array and object literals (at most `MAX_DEPTH` levels) to an argument list, a
 * JSX attribute value, or the value of a declaration / export / assignment.
 */
export function referenceContext(node: SgNode): RefContext | null {
  let cur = node;
  let nested = false;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const parent = cur.parent();
    if (!parent) return null;
    const pk = String(parent.kind());
    if (pk === 'arguments') {
      const call = parent.parent();
      if (!call) return null;
      const route = call.kind() === 'call_expression' ? routeOf(call, parent) : undefined;
      return { ref: 'argument', via: calleeText(call), ...(route ? { route } : {}) };
    }
    if (pk === 'jsx_expression') {
      const via = nested ? null : attributeName(parent);
      return via ? { ref: 'binding', via } : null;
    }
    if (pk === 'array' || pk === 'object' || WRAPPERS.has(pk)) {
      nested = nested || pk === 'array' || pk === 'object';
      cur = parent;
      continue;
    }
    if (pk === 'pair') {
      const kids = parent.children();
      if (!sameNode(kids[kids.length - 1], cur) || sameNode(kids[0], cur)) return null;
      nested = true;
      cur = parent;
      continue;
    }
    if (!nested) return null;
    if (pk === 'variable_declarator') return sameNode(parent.children()[0], cur) ? null : { ref: 'table', via: null };
    if (pk === 'assignment_expression') return sameNode(parent.children()[0], cur) ? null : { ref: 'table', via: null };
    if (pk === 'export_statement') return { ref: 'table', via: null };
    return null;
  }
  return null;
}

/**
 * Plain-module code owned by the file entity: its plain reads are not recorded
 * (data-relations.ts), so only function-like hand-offs are. A single-file
 * component keeps recording every script-level read, hand-offs included.
 */
function moduleOwned(frame: ScopeFrame, ctx: TsRelationContext): boolean {
  return ctx.ownerIsFile && frame.entity?.id === ctx.rootOwner.id;
}

function kindsFor(rc: RefContext, owned: boolean): EntityKind[] {
  if (owned) return FUNCTIONAL;
  if (rc.ref === 'binding' && !/^on[A-Z]/.test(rc.via ?? '')) return FUNCTIONAL;
  return WITH_VALUES;
}

function metaFor(rc: RefContext, frame: ScopeFrame, ctx: TsRelationContext): RelationMeta {
  const meta: RelationMeta = { ref: rc.ref, ...ownerOptions(frame, ctx).meta };
  if (rc.via) meta.ref_via = rc.via;
  if (rc.route) meta.route = rc.route;
  return meta;
}

/** Declared as a parameter / local of an enclosing function (not at module level). */
function shadowed(name: string, frame: ScopeFrame): boolean {
  const hit = frame.scope.lookup(name);
  return !!hit && !hit.moduleLevel;
}

/**
 * Identifier in a hand-off position. Returns true when the identifier was
 * consumed (emitted or deliberately skipped) so the plain-read path must not
 * see it again.
 */
export function handleReferenceIdentifier(node: SgNode, name: string, frame: ScopeFrame, ctx: TsRelationContext): boolean {
  const parent = node.parent();
  if (!parent) return false;
  const pk = String(parent.kind());
  if (JSX_TAGS.has(pk) || (pk === 'member_expression' && JSX_TAGS.has(String(parent.parent()?.kind())))) return true; // tag name: handleJsxElement
  const rc = referenceContext(node);
  if (!rc || !frame.entity) return false;
  if (shadowed(name, frame)) return true;
  ctx.emitter.link(frame.entity, 'use', name, node, {
    optional: true, kinds: kindsFor(rc, moduleOwned(frame, ctx)), meta: metaFor(rc, frame, ctx),
  });
  return true;
}

/**
 * `this.method` handed over in an argument list (`el.addEventListener('x', this.onX)`,
 * `[this.a, this.b]`, `{ cb: this.c }`). Driven from the `arguments` node so that the
 * thousands of other member expressions are never inspected.
 */
export function handleThisReferences(args: SgNode, frame: ScopeFrame, ctx: TsRelationContext): void {
  if (!frame.cls || !frame.entity) return;
  let rc: RefContext | null = null;
  const visit = (node: SgNode, depth: number): void => {
    const kind = String(node.kind());
    if (kind === 'member_expression') {
      const kids = node.children();
      if (kids.length !== 3 || kids[0].kind() !== 'this' || kids[2].kind() !== 'property_identifier') return;
      const call = args.parent();
      rc ??= { ref: 'argument', via: call ? calleeText(call) : null };
      emitThisReference(node, kids[2].text(), rc, frame, ctx);
    } else if (depth < 2 && (kind === 'array' || kind === 'object' || kind === 'pair')) {
      for (const sub of node.children()) visit(sub, depth + 1);
    }
  };
  for (const child of args.children()) visit(child, 0);
}

function emitThisReference(node: SgNode, name: string, rc: RefContext, frame: ScopeFrame, ctx: TsRelationContext): void {
  if (!frame.cls || !frame.entity) return;
  const meta = metaFor(rc, frame, ctx);
  const own = ctx.emitter.member(frame.cls.entity, name, ['method']);
  if (own) ctx.emitter.direct(frame.entity, own, 'use', node, { meta });
  else if (frame.cls.parentRef) {
    ctx.emitter.link(frame.entity, 'use', `${frame.cls.parentRef}.${name}`, node, { optional: true, kinds: ['method'], meta });
  }
}

/** `{ handler }` shorthand in a hand-off position. */
export function handleShorthandReference(node: SgNode, frame: ScopeFrame, ctx: TsRelationContext): void {
  if (!frame.entity) return;
  const name = node.text();
  if (!ctx.emitter.isLocal(name) && !ctx.emitter.isImported(name)) return;
  handleReferenceIdentifier(node, name, frame, ctx);
}

/** `<Comp />` / `<ns.Comp>`: a `create` edge to the component (lower-case tags are DOM elements). */
export function handleJsxElement(node: SgNode, frame: ScopeFrame, ctx: TsRelationContext): void {
  if (!frame.entity) return;
  const tag = node.children().find((c) => c.kind() === 'identifier' || c.kind() === 'member_expression');
  const name = tag ? refText(tag) : null;
  if (!name) return;
  const head = name.split('.')[0];
  if (!/^[A-Z]/.test(head) && !name.includes('.')) return;
  if (!ctx.emitter.isLocal(head) && !ctx.emitter.isImported(head)) return;
  if (shadowed(head, frame)) return;
  ctx.emitter.link(frame.entity, 'create', name, node, {
    optional: true, kinds: ['class', 'component', 'function', 'variable'], ...ownerOptions(frame, ctx),
  });
}
