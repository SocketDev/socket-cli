/*
 * @file GitHub-safe mermaid analysis + rewrite. GitHub renders a mermaid
 *   block with floating control clusters INSIDE the diagram container —
 *   two buttons top-right and a six-button pan/zoom cluster mid-right —
 *   so content drawn near the right edge gets covered. Learned the hard
 *   way on a PR sequence diagram, three renders deep:
 *
 *   1. A `Note right of <rightmost participant>` hangs the whole note PAST the
 *      last lifeline — directly under the control cluster, where no margin can
 *      protect it. The safe shape is `Note over <first>,<last>`: the note spans
 *      the diagram and never overhangs.
 *   2. A `Note over <a>,<rightmost>` still overhangs when the text is wider than
 *      the span, the box centers and spills both sides, so the rewrite anchors
 *      at the FIRST participant — the span is maximal and the text always fits
 *      inside it.
 *   3. Margins must be generous: GitHub scales a wide SVG down to the container
 *      width, shrinking margins proportionally. 150 units cleared nothing at
 *      0.55x; 280 does. Sequence diagrams need `sequence.diagramMarginX >=
 *      280`; flowcharts need `flowchart.diagramPadding >= 70`. Pure functions,
 *      no IO — the mermaid-github-safe-nudge hook analyzes with them and the
 *      wheelhouse generator (scripts/repo/gen/ mermaid-github-safe.mts)
 *      rewrites with them.
 */

export const SEQUENCE_MARGIN_X = 280
export const SEQUENCE_MARGIN_Y = 50
export const FLOWCHART_PADDING = 70

const SEQUENCE_INIT = `%%{init: {"sequence": {"diagramMarginX": ${SEQUENCE_MARGIN_X}, "diagramMarginY": ${SEQUENCE_MARGIN_Y}}}}%%`
const FLOWCHART_INIT = `%%{init: {"flowchart": {"diagramPadding": ${FLOWCHART_PADDING}}}}%%`

export interface MermaidIssue {
  readonly kind: 'missing-margin' | 'note-right-overhang'
  readonly line: number
  readonly message: string
}

export interface MermaidAnalysis {
  readonly issues: readonly MermaidIssue[]
  readonly fixed: string
}

interface ParsedInit {
  readonly present: boolean
  readonly marginX?: number | undefined
  readonly padding?: number | undefined
}

function parseInit(source: string): ParsedInit {
  const m = /%%\{init:\s*(\{[\s\S]*?\})\s*\}%%/.exec(source)
  if (!m) {
    return { present: false }
  }
  try {
    const parsed = JSON.parse(m[1]!) as {
      sequence?: { diagramMarginX?: number | undefined } | undefined
      flowchart?: { diagramPadding?: number | undefined } | undefined
    }
    return {
      present: true,
      marginX: parsed.sequence?.diagramMarginX,
      padding: parsed.flowchart?.diagramPadding,
    }
  } catch {
    return { present: true }
  }
}

// require-regex-comment: `participant` or `actor` keyword, the id token,
// then an optional `as <label>` — mermaid's participant declaration line.
const PARTICIPANT_RE = /^\s*(?:actor|participant)\s+(\S+?)(?:\s+as\s+.+)?$/

/**
 * The declared participant ids of a sequence diagram, in left-to-right
 * order. The last one is the rightmost lifeline — the GitHub-overlay
 * danger zone.
 */
export function sequenceParticipants(source: string): string[] {
  const out: string[] = []
  const lines = source.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const m = PARTICIPANT_RE.exec(lines[i]!)
    if (m) {
      out.push(m[1]!)
    }
  }
  return out
}

/**
 * Analyze ONE mermaid source, the fence body, and produce the issues plus
 * the GitHub-safe rewrite. Unknown diagram kinds pass through untouched.
 */
export function analyzeMermaidSource(source: string): MermaidAnalysis {
  const issues: MermaidIssue[] = []
  let fixed = source
  const isSequence = /^\s*sequenceDiagram/m.test(source)
  const isFlowchart = /^\s*(?:flowchart|graph)\s/m.test(source)
  const init = parseInit(source)

  if (isSequence) {
    if (!init.present) {
      issues.push({
        kind: 'missing-margin',
        line: 1,
        message: `sequence diagram has no init directive — GitHub's floating controls overlay the right edge; add ${SEQUENCE_INIT}`,
      })
      fixed = `${SEQUENCE_INIT}\n${fixed}`
    } else if ((init.marginX ?? 0) < SEQUENCE_MARGIN_X) {
      issues.push({
        kind: 'missing-margin',
        line: 1,
        message: `sequence diagramMarginX ${init.marginX ?? 'unset'} < ${SEQUENCE_MARGIN_X} — GitHub scales wide SVGs down, shrinking margins with them`,
      })
      fixed = fixed.replace(/%%\{init:[\s\S]*?\}%%/, SEQUENCE_INIT)
    }
    const participants = sequenceParticipants(fixed)
    const last = participants[participants.length - 1]
    const first = participants[0]
    if (last && first && last !== first) {
      const noteRe = new RegExp(
        `^(\\s*)Note right of ${last.replace(/[-\\^$*+?.()|[\]{}]/g, String.raw`\$&`)}\\s*:`,
        'gm',
      )
      const lines = fixed.split('\n')
      for (let i = 0, { length } = lines; i < length; i += 1) {
        noteRe.lastIndex = 0
        if (noteRe.test(lines[i]!)) {
          issues.push({
            kind: 'note-right-overhang',
            line: i + 1,
            message: `Note right of ${last} (the rightmost participant) hangs past the last lifeline, under GitHub's pan/zoom controls — use Note over ${first},${last}`,
          })
        }
      }
      fixed = fixed.replace(noteRe, `$1Note over ${first},${last}:`)
    }
  } else if (isFlowchart) {
    if (!init.present) {
      issues.push({
        kind: 'missing-margin',
        line: 1,
        message: `flowchart has no init directive — add ${FLOWCHART_INIT} so GitHub's controls overlay padding, not content`,
      })
      fixed = `${FLOWCHART_INIT}\n${fixed}`
    } else if ((init.padding ?? 0) < FLOWCHART_PADDING) {
      issues.push({
        kind: 'missing-margin',
        line: 1,
        message: `flowchart diagramPadding ${init.padding ?? 'unset'} < ${FLOWCHART_PADDING}`,
      })
      fixed = fixed.replace(/%%\{init:[\s\S]*?\}%%/, FLOWCHART_INIT)
    }
  }

  return { issues, fixed }
}

/**
 * Analyze every ```mermaid fence in a markdown document. Returns the
 * issues (lines relative to the DOCUMENT) and the document with every
 * fence body rewritten GitHub-safe.
 */
export function analyzeMarkdownMermaid(doc: string): MermaidAnalysis {
  const issues: MermaidIssue[] = []
  // require-regex-comment: a ```mermaid fence — opening line, lazily
  // captured body, closing fence at line start.
  const fenceRe = /(```mermaid[ \t]*\n)([\s\S]*?)(^```)/gm
  let lineOffsetCache: number[] | undefined
  function lineOf(index: number): number {
    if (!lineOffsetCache) {
      lineOffsetCache = []
      for (let i = 0; i < doc.length; i += 1) {
        if (doc[i] === '\n') {
          lineOffsetCache.push(i)
        }
      }
    }
    let line = 1
    for (let i = 0, { length } = lineOffsetCache; i < length; i += 1) {
      if (lineOffsetCache[i]! < index) {
        line += 1
      } else {
        break
      }
    }
    return line
  }
  const fixed = doc.replace(
    fenceRe,
    (
      _whole: string,
      open: string,
      body: string,
      close: string,
      offset: number,
    ) => {
      const analysis = analyzeMermaidSource(body)
      const baseLine = lineOf(offset)
      for (let i = 0, { length } = analysis.issues; i < length; i += 1) {
        const issue = analysis.issues[i]!
        issues.push({ ...issue, line: baseLine + issue.line })
      }
      return `${open}${analysis.fixed}${close}`
    },
  )
  return { issues, fixed }
}
