import { OUTPUT_KIND_JSON, OUTPUT_KIND_MARKDOWN, OUTPUT_KIND_TEXT } from '../constants.mts'
import type { OutputKind } from '../types.mts'

export function getOutputKind(json: unknown, markdown: unknown): OutputKind {
  if (json) {
    return OUTPUT_KIND_JSON
  }
  if (markdown) {
    return OUTPUT_KIND_MARKDOWN
  }
  return OUTPUT_KIND_TEXT
}
