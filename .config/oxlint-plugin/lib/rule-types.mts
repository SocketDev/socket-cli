/**
 * @fileoverview Shared type aliases for oxlint plugin rules.
 *
 * Oxlint rules consume ESTree AST nodes via callback visitors, but
 * neither @types/estree nor the oxlint runtime expose a single
 * cohesive type for them. Authoring rules against the full union
 * would inflate the rule bodies with narrowing boilerplate; using
 * raw `any` triggers `noImplicitAny`. This module exports `any`-
 * shaped aliases so rules can opt out of the narrow surface without
 * paying the `any` linter cost at each callsite.
 *
 * Conventions:
 *   - `AstNode` — any ESTree node (Program, Literal, CallExpression, …).
 *   - `RuleContext` — the second arg to a rule's `create(context)`.
 *   - `RuleFixer` — the fixer passed to `context.report({ fix })`.
 *   - `RuleListener` — a record mapping visitor names (e.g.
 *     `CallExpression`, `Literal`) to handler functions.
 *
 * Rules should `import type { AstNode } from '../lib/rule-types.mts'`
 * and annotate visitor callbacks: `Literal(node: AstNode) { … }`.
 *
 * Why `any` not `unknown`: rule bodies traverse arbitrary nested
 * structure (`node.id.type`, `node.declarations[0].init.callee.name`).
 * Forcing `unknown` would multiply narrowing boilerplate without
 * catching bugs the runtime visitor signature already guarantees.
 * The AST contract is "ESTree-shaped, mostly"; locking it down
 * properly belongs in the lint-tooling layer, not per-rule.
 */

// eslint-disable-next-line typescript/no-explicit-any
export type AstNode = any

// eslint-disable-next-line typescript/no-explicit-any
export type RuleContext = any

// eslint-disable-next-line typescript/no-explicit-any
export type RuleFixer = any

export type RuleListener = Record<string, (node: AstNode) => void>
