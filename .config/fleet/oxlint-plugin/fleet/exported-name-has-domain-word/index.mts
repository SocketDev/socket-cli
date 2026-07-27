/*
 * @file Flag an EXPORTED identifier whose name is a single generic token with no
 *   domain word (`export function create`, `export const parse`, `export type
 *   Result`). Coding agents navigate by grep at ~10 tokens per line, and a
 *   one-word generic export is a grep-noise magnet — `create` matched 1585 times
 *   across 459 files in a real audit vs `createStripeClient` 43 across 19;
 *   one-word names are ~61% unique, three-word ~96%. So a bare generic export
 *   carries no domain signal and taxes every future reader (human or agent).
 *   The denylist + predicate are the single source shared with the edit-time
 *   `generic-export-name-nudge` hook (`../../lib/generic-name-tokens.mts`).
 *
 *   Scope: EXPORTED declaration names only — a local helper's name is the
 *   author's business; an export is a fleet-wide search surface. Sanctioned
 *   structural conventions (`check`, `main`, `run`, `handler`, …) are exempt via
 *   the shared SANCTIONED_CONVENTION_NAMES set. No autofix — a rename is
 *   cross-file (it breaks callers), so the fix is a deliberate rename, not a
 *   per-file rewrite. Re-export specifiers (`export { x }`) are skipped: the
 *   name is flagged at its definition site, not every forward.
 */

import { isGenericExportName } from '../../lib/generic-name-tokens.mts'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

function reportIfGeneric(
  context: RuleContext,
  idNode: AstNode | undefined,
): void {
  if (!idNode || idNode.type !== 'Identifier' || !idNode.name) {
    return
  }
  if (isGenericExportName(idNode.name)) {
    context.report({
      node: idNode,
      messageId: 'exportedNameHasDomainWord',
      data: { name: idNode.name },
    })
  }
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require an exported name to carry a domain word — a single generic token (create/parse/get/…) is a grep-noise magnet for agents and readers.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    messages: {
      exportedNameHasDomainWord:
        "Exported '{{name}}' is a single generic token — a grep-noise magnet (one-word names are ~61% unique). Qualify it with a domain word (e.g. `create` → `createStripeClient`) so agents and readers can find it without reading unrelated files.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    return {
      // `export function foo`, `export class Foo`, `export interface Foo`,
      // `export type Foo`, `export enum Foo`, `export const foo = …`. A bare
      // `export { foo }` (no `declaration`) is a re-export — skip it; the name
      // is flagged at its definition.
      ExportNamedDeclaration(node: AstNode) {
        const decl = node.declaration
        if (!decl) {
          return
        }
        if (decl.type === 'VariableDeclaration') {
          const declarators = decl.declarations ?? []
          for (let i = 0, { length } = declarators; i < length; i += 1) {
            reportIfGeneric(context, declarators[i]?.id)
          }
          return
        }
        reportIfGeneric(context, decl.id)
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint loads a rule module via dynamic import and expects the rule object as the default export.
export default rule
