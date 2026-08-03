/**
 * @file Hand-written types for the markdownlint custom-rule contract, so the
 *   fleet rules need no direct dependency on the `markdownlint` package (the
 *   runtime engine ships inside markdownlint-cli2, which loads these rules;
 *   pnpm strict isolation makes that transitive copy unresolvable for types).
 *   Mirrors the documented custom-rule API
 *   (https://github.com/DavidAnson/markdownlint/blob/main/doc/CustomRules.md);
 *   lock-step: extend these shapes if a rule starts using a new field.
 */

export interface MarkdownlintFixInfo {
  // Negative deleteCount deletes the whole line.
  deleteCount?: number | undefined
  editColumn?: number | undefined
  insertText?: string | undefined
  lineNumber?: number | undefined
}

export interface MarkdownlintOnErrorInfo {
  context?: string | undefined
  detail?: string | undefined
  fixInfo?: MarkdownlintFixInfo | undefined
  lineNumber: number
  range?: [number, number] | undefined
}

export type MarkdownlintOnError = (info: MarkdownlintOnErrorInfo) => void

export interface MarkdownlintRuleParams {
  config: Record<string, unknown>
  frontMatterLines: string[]
  lines: string[]
  // Path of the file under lint, relative to the working directory.
  name: string
  version: string
}

export interface MarkdownlintRule {
  asynchronous?: boolean | undefined
  description: string
  function: (
    params: MarkdownlintRuleParams,
    onError: MarkdownlintOnError,
  ) => void
  information?: URL | undefined
  names: string[]
  parser: 'markdownit' | 'micromark' | 'none'
  tags: string[]
}
