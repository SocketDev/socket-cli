/**
 * @file Unit tier for scripts/fleet/comment-voice.mts — rule-by-rule guard
 *   over the pure `lint()` function. Every rule exists because it was a live
 *   correction on a posted pnpm/rfcs#19 comment (2026-08-06), so each case
 *   pins the exact failure that prompted the rule plus the fixed form that
 *   must pass. The live-posted shapes at the bottom are characterization
 *   fixtures: they passed review on the PR and must keep passing here.
 *   Integration tier (runCli with injected IO) and e2e tier (real subprocess)
 *   live beside this file's dir.
 */
import { describe, expect, it } from 'vitest'

import { lint } from '../../../scripts/fleet/comment-voice.mts'

const rules = (body: string, thread = false) =>
  lint(body, { thread }).map(f => f.rule)

const errors = (body: string, thread = false) =>
  lint(body, { thread })
    .filter(f => f.level === 'ERROR')
    .map(f => f.rule)

describe('hyphens-only', () => {
  it('flags an em dash in prose', () => {
    expect(errors('👍 - resolved — at head.', true)).toContain('hyphens-only')
  })

  it('exempts em dashes inside suggestion fences', () => {
    const body = 'Fix:\n\n```suggestion\ntext — with the doc style\n```'
    expect(errors(body)).not.toContain('hyphens-only')
  })

  it('exempts em dashes inside quoted lines', () => {
    const body = '> their words — verbatim\n\n👍 - resolved.'
    expect(errors(body, true)).not.toContain('hyphens-only')
  })
})

describe('thumbs format', () => {
  it('flags 👍 followed by an em dash', () => {
    expect(errors('👍 — resolved.', true)).toContain('thumbs-format')
  })

  it('flags the redundant agreed', () => {
    expect(errors('👍 - agreed; looks good.', true)).toContain(
      'redundant-agreed',
    )
  })

  it('accepts the canonical form', () => {
    expect(errors('👍 - resolved at head.', true)).toEqual([])
  })
})

describe('banned phrases', () => {
  const cases: Array<[string, string]> = [
    ['👍 - keep it out of this RFC.', 'gatekeeping'],
    ['👍 - this is slipstream done right.', 'judgy'],
    ['👍 - our tooling is miserable here.', 'self-deprecation'],
    ['👍 - the ordinal should stay.', 'spec-speak'],
    ['👍 - an equivocating manifest fails.', 'vocab'],
    ['👍 - r2 supersedes r1.', 'vocab'],
    ['👍 - honestly this works.', 'hedge'],
  ]
  for (const [body, why] of cases) {
    it(`flags: ${why}`, () => {
      expect(errors(body, true)).toContain('banned-phrase')
    })
  }

  const patternVariants: Array<[string, string]> = [
    ['👍 - keep that out of the spec.', 'gatekeeping (pattern variant)'],
    ['👍 - you got it right here.', 'judgy (pattern variant)'],
    [
      '👍 - we made a hacky pass at this.',
      'self-deprecation (pattern variant)',
    ],
    ['👍 - ordinals are fine.', 'spec-speak (pattern variant)'],
    ['👍 - honesty aside, this works.', 'hedge (pattern variant)'],
  ]
  for (const [body, why] of patternVariants) {
    it(`flags the family, not the incident: ${why}`, () => {
      expect(errors(body, true)).toContain('banned-phrase')
    })
  }

  it('does not flag banned vocab inside inline code (field names)', () => {
    expect(
      errors('👍 - a per-entry `supersededBy` field fits.', true),
    ).not.toContain('banned-phrase')
  })
})

describe('question-leads', () => {
  it('flags a question buried after context', () => {
    const body = 'Some context first.\n\nBut what happens on retry?'
    expect(errors(body)).toContain('question-leads')
  })

  it('accepts question first, blank line, then context', () => {
    const body = 'What happens on retry?\n\nContext goes here.'
    expect(errors(body)).not.toContain('question-leads')
  })
})

describe('actionable', () => {
  it('flags prose with nothing to act on', () => {
    expect(errors('This section is interesting and well written.')).toContain(
      'actionable',
    )
  })

  it('accepts a suggestion block as the action', () => {
    const body = 'Small fix:\n\n```suggestion\nnew text\n```'
    expect(errors(body)).not.toContain('actionable')
  })

  it('accepts a 👍 log even after a leading quote', () => {
    const body =
      '> their earlier point\n\n👍 - this can come later without conflicting.'
    expect(errors(body, true)).not.toContain('actionable')
  })
})

describe('length and referents', () => {
  it('warns past three sentences without erroring', () => {
    const body = '👍 - one. Two here. Three here. Four here.'
    const findings = lint(body, { thread: true })
    expect(findings.find(f => f.rule === 'three-sentences')?.level).toBe('WARN')
    expect(findings.filter(f => f.level === 'ERROR')).toEqual([])
  })

  it('warns on "still open" standalone, allows it with --thread', () => {
    const body = '👍 - still open. Needs the guardrails.'
    expect(rules(body)).toContain('self-contained')
    expect(rules(body, true)).not.toContain('self-contained')
  })

  it('catches the referent regardless of case', () => {
    expect(rules('Still open at head. Needs the guardrails.')).toContain(
      'self-contained',
    )
  })

  it('catches the referent across a hard-wrapped line break', () => {
    expect(rules('👍 - still\ntrue at head.')).toContain('self-contained')
  })

  it('catches the family, not the incident: "remains unresolved"', () => {
    expect(rules('This one remains unresolved.')).toContain('self-contained')
  })

  it('flags other redundant agreement words after the 👍 prefix', () => {
    expect(errors('👍 - yes, matches my read.', true)).toContain(
      'redundant-agreed',
    )
  })
})

describe('live-posted fixtures keep passing', () => {
  it('quote-led thread reply (N11 shape)', () => {
    const body = [
      '> Maybe something similar could be added for this in the future.',
      '',
      '👍 - this can come later without conflicting with the design here. A shape',
      'suggestion for when it does: batch - POST the locked pairs, get back the',
      'selected revision, integrity, and fixes for each.',
    ].join('\n')
    expect(errors(body, true)).toEqual([])
  })

  it('question-led anchored comment (N7 shape)', () => {
    const body = [
      "What's a proxy in the middle supposed to do?",
      '',
      'Proxies, mirrors, and registry firewalls work out which package a request',
      'is for from the URL, and the digest route hides that on purpose.',
    ].join('\n')
    expect(errors(body)).toEqual([])
  })
})
