import { JSON, MARKDOWN, TEXT } from '../constants.mts'

import type { OutputKind } from '../types.mts'

export function getOutputKind(json: unknown, markdown: unknown): OutputKind {
  if (json) {
    return JSON
  }
  if (markdown) {
    return MARKDOWN
  }
  return TEXT
}
