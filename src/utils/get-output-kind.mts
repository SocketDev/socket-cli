import { OUTPUT_JSON, OUTPUT_MARKDOWN, OUTPUT_TEXT } from '../constants.mts'

import type { OutputKind } from '../types.mts'

export function getOutputKind(json: unknown, markdown: unknown): OutputKind {
  if (json) {
    return OUTPUT_JSON
  }
  if (markdown) {
    return OUTPUT_MARKDOWN
  }
  return OUTPUT_TEXT
}
