import type { OutputKind } from '../types.mts'

export function getOutputKind(json: unknown, markdown: unknown): OutputKind {
  if (json) {
    return 'json'
  }
  if (markdown) {
    return 'markdown'
  }
  return 'text'
}
