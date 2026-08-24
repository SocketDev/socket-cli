/**
 * Classify a raw import/require specifier: relative (follow it in the graph
 * walk), bare (a candidate dependency - extract its package name), or
 * neither (a Node builtin, a URL, or a virtual specifier - not a dependency
 * edge). Ported from nub's `nub-phantom-core::specifier` (jdx/nub, MIT).
 */

import { builtinModules } from 'node:module'

const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
])

export type SpecKind =
  | { kind: 'relative' }
  | { kind: 'bare'; packageName: string }
  | { kind: 'other' }

export function classifySpecifier(spec: string): SpecKind {
  if (spec.startsWith('.') || spec.startsWith('/')) {
    return { kind: 'relative' }
  }
  if (
    BUILTINS.has(spec) ||
    spec.includes('://') ||
    spec.startsWith('data:') ||
    spec.startsWith('node:')
  ) {
    return { kind: 'other' }
  }
  const packageName = spec.startsWith('@')
    ? spec.split('/').slice(0, 2).join('/')
    : (spec.split('/')[0] ?? '')
  return packageName ? { kind: 'bare', packageName } : { kind: 'other' }
}
