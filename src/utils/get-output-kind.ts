import { OutputKind } from '../types'

export function getOutputKind(json: unknown, markdown: unknown): OutputKind {
  if (json) {
    return 'json'
  }
  if (markdown) {
    return 'markdown'
  }
  return 'text'
}
