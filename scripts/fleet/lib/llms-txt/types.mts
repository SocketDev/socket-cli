/**
 * @file Shared types for the llms.txt generator. Defines the slot model,
 *   section structure, and rendered document shape. Pure data — no I/O or
 *   side effects.
 */

/**
 * Named prose slot that the AI fill pass targets.
 */
export interface ProseSlot {
  /**
   * Stable slot id used in JSON exchange and regen matching.
   */
  id: string
  /**
   * Maximum character budget for the generated text.
   */
  charBudget: number
  /**
   * Source text the AI uses to ground its answer (no hallucination).
   */
  source: string
}

/**
 * A link entry in an llms.txt section.
 */
export interface LlmsLink {
  /**
   * Display name for the link.
   */
  name: string
  /**
   * Relative URL (never absolute).
   */
  url: string
  /**
   * Optional short description — prose slot text or deterministic fallback.
   */
  note: string | undefined
}

/**
 * One H2 section in the rendered document.
 */
export interface LlmsSection {
  /**
   * Section heading text (e.g. "Docs", "API").
   */
  title: string
  /**
   * Ordered link list. Empty sections are omitted from output.
   */
  links: LlmsLink[]
}

/**
 * Structured facts extracted deterministically from the repo.
 */
export interface RepoFacts {
  /**
   * Human-readable repo name (from config repoName → basename).
   */
  repoName: string
  /**
   * Package version string from package.json, or undefined.
   */
  version: string | undefined
  /**
   * Node.js engine floor (e.g. ">=24"), or undefined.
   */
  nodeFloor: string | undefined
  /**
   * Package license identifier, or undefined.
   */
  license: string | undefined
  /**
   * Detected layout: "monorepo" | "single-package".
   */
  layout: 'monorepo' | 'single-package'
  /**
   * README first-paragraph text (used as AI source for summary slot).
   */
  readmeLead: string | undefined
}

/**
 * AI slot fill response — raw JSON parsed from the model.
 */
export interface SlotFillResponse {
  slots: Record<string, string>
}

/**
 * Parsed structural skeleton used for freshness comparison.
 */
export interface LlmsStructure {
  /**
   * H1 title line.
   */
  h1: string
  /**
   * Section titles in order.
   */
  sectionTitles: string[]
  /**
   * Per-section ordered link pairs [name, url].
   */
  sectionLinks: Record<string, Array<[string, string]>>
}
