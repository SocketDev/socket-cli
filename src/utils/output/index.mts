/** @fileoverview Centralized output formatting module for Socket CLI */

// Re-export all output utilities from a single location
// This provides a cleaner API and reduces import complexity

export { outputResult } from '../output.mts'
export { simpleOutput } from '../simple-output.mts'
// Note: These functions may not exist yet in output-formatting.mts
// This is a proposed organization - implement as needed
export { colorOrMarkdown } from '../color-or-markdown.mts'
export {
  markdownTable,
  markdownList,
  markdownCode
} from '../markdown.mts'

// Output type constants
export const OUTPUT_TYPES = {
  JSON: 'json',
  MARKDOWN: 'markdown',
  TABLE: 'table',
  TEXT: 'text'
} as const

export type OutputType = typeof OUTPUT_TYPES[keyof typeof OUTPUT_TYPES]

// Common output helpers
export function isJsonOutput(flags: any): boolean {
  return flags.json === true
}

export function isMarkdownOutput(flags: any): boolean {
  return flags.markdown === true
}

export function isQuietMode(flags: any): boolean {
  return flags.quiet === true || flags.silent === true
}

export function isVerboseMode(flags: any): boolean {
  return flags.verbose === true
}

// Determine output type from flags
export function getOutputType(flags: any): OutputType {
  if (isJsonOutput(flags)) {
    return OUTPUT_TYPES.JSON
  }
  if (isMarkdownOutput(flags)) {
    return OUTPUT_TYPES.MARKDOWN
  }
  return OUTPUT_TYPES.TEXT
}

// Standard output formatting options
export interface OutputOptions {
  color?: boolean
  indent?: number
  quiet?: boolean
  type?: OutputType
  verbose?: boolean
}

// Format output based on options
export function formatOutput(data: any, options: OutputOptions = {}): string {
  const { indent = 2, type = OUTPUT_TYPES.TEXT } = options

  switch (type) {
    case OUTPUT_TYPES.JSON:
      return JSON.stringify(data, null, indent)
    case OUTPUT_TYPES.MARKDOWN:
      // TODO: Implement markdown formatting
      return JSON.stringify(data, null, indent)
    case OUTPUT_TYPES.TABLE:
      // TODO: Implement table formatting
      return JSON.stringify(data, null, indent)
    default:
      // TODO: Implement text formatting
      return String(data)
  }
}