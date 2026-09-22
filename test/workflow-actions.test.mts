import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  checkWorkflowActions,
  externalActionReferences,
} from '../scripts/ci/check-actions.mts'

describe('workflow action policy', () => {
  it('rejects external actions and reusable workflows', () => {
    expect(
      externalActionReferences(
        parse(`
jobs:
  reused:
    uses: example/build/.github/workflows/build.yml@v1
  build:
    steps:
      - uses: actions/checkout@v6
      - uses: docker://alpine:latest
`),
      ),
    ).toEqual([
      'example/build/.github/workflows/build.yml@v1',
      'actions/checkout@v6',
      'docker://alpine:latest',
    ])
  })

  it('accepts local actions and shell steps', () => {
    expect(
      externalActionReferences(
        parse(`
runs:
  using: composite
  steps:
    - uses: ./.github/actions/repo/upload-artifact
    - run: echo ready
`),
      ),
    ).toEqual([])
  })

  it('enforces the policy for every repository workflow and local action', () => {
    expect(checkWorkflowActions('.github')).toEqual([])
  })
})
