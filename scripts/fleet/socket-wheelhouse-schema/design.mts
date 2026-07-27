/*
 * @file Design block of the socket-wheelhouse config: per-repo UI/asset design
 *   budgets (a repo opts in only if it ships UI assets). `contrast` is the WCAG
 *   color-contrast budget: each file names selector/background pairs a lint gate
 *   verifies clear a minimum ratio.
 */

import { Type } from '@sinclair/typebox'

export const ContrastCheckSchema = Type.Object(
  {
    selector: Type.String({
      description:
        'CSS selector (regex-escaped) whose foreground color is checked.',
    }),
    bg: Type.String({
      description: 'Background color (hex) the foreground is measured against.',
    }),
    minRatio: Type.Optional(
      Type.Number({
        description: 'Minimum contrast ratio. Defaults to 4.5 (WCAG AA).',
      }),
    ),
    label: Type.Optional(
      Type.String({ description: 'Human-readable label for the check.' }),
    ),
  },
  {
    additionalProperties: false,
    description: 'One foreground/background contrast pair to verify.',
  },
)

export const ContrastFileSchema = Type.Object(
  {
    path: Type.String({
      description: 'Repo-relative path to the file whose colors are checked.',
    }),
    checks: Type.Array(ContrastCheckSchema, {
      description: 'The contrast pairs to verify in this file.',
    }),
  },
  {
    additionalProperties: false,
    description: 'A file and the set of contrast pairs to verify within it.',
  },
)

export const ContrastSchema = Type.Object(
  {
    files: Type.Array(ContrastFileSchema, {
      description: 'Files with contrast pairs to verify.',
    }),
  },
  {
    additionalProperties: false,
    description: 'WCAG color-contrast budget for the repo.',
  },
)

export const DesignSchema = Type.Object(
  {
    contrast: Type.Optional(ContrastSchema),
  },
  {
    additionalProperties: false,
    description:
      'Per-repo design budgets (opt-in; only repos shipping UI assets set this).',
  },
)
