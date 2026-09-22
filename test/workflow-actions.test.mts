import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  checkWorkflowActions,
  disallowedActionReferences,
} from '../scripts/ci/check-actions.mts'

const directories: string[] = []

function actionFixture(reference: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'workflow-actions-test-'))
  directories.push(root)
  const github = path.join(root, '.github')
  const workflows = path.join(github, 'workflows')
  const actions = path.join(github, 'actions', 'repo')
  mkdirSync(workflows, { recursive: true })
  mkdirSync(actions, { recursive: true })
  const workflow = path.join(workflows, 'build.yml')
  writeFileSync(
    workflow,
    `jobs:\n  build:\n    steps:\n      - uses: ${JSON.stringify(reference)}\n`,
  )
  return { actions, github, root, workflow }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('workflow action policy', () => {
  it('rejects external actions and reusable workflows', () => {
    expect(
      disallowedActionReferences(
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
      disallowedActionReferences(
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

  it.each([
    './scripts/actions/tool',
    './.github/actions/fleet/tool',
    './.github/actions/repo',
    './.github/actions/repo/tool/',
    './.github/actions/repo/../external',
    './.github/actions/repo/./tool',
    './.github/actions/repo/tool/../../external',
    './.github/actions/repo//tool',
    './.github/actions/repo/tool\\external',
    './.github/actions/repo/%2e%2e/external',
    './.github/actions/repo/tool@revision',
  ])(
    'rejects a local action outside the permitted path syntax: %s',
    reference => {
      const fixture = actionFixture(reference)
      expect(checkWorkflowActions(fixture.github)).toEqual([
        `${fixture.workflow}: ${reference}`,
      ])
    },
  )

  it('accepts nested repository action directories and inspects their definitions', () => {
    const fixture = actionFixture('./.github/actions/repo/build/tool')
    const directory = path.join(fixture.actions, 'build', 'tool')
    mkdirSync(directory, { recursive: true })
    const action = path.join(directory, 'action.yml')
    writeFileSync(
      action,
      'runs:\n  using: composite\n  steps:\n    - run: echo ready\n',
    )
    expect(checkWorkflowActions(fixture.github)).toEqual([])
    writeFileSync(
      action,
      'runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v6\n',
    )
    expect(checkWorkflowActions(fixture.github)).toEqual([
      `${action}: actions/checkout@v6`,
    ])
  })

  it('rejects a linked action directory without following it', () => {
    const fixture = actionFixture('./.github/actions/repo/linked')
    const outside = path.join(fixture.root, 'external-action')
    mkdirSync(outside)
    writeFileSync(
      path.join(outside, 'action.yml'),
      'runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v6\n',
    )
    const linked = path.join(fixture.actions, 'linked')
    symlinkSync(outside, linked, 'dir')
    const findings = checkWorkflowActions(fixture.github)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain(linked)
  })

  it('rejects linked action files and broken links', () => {
    const fixture = actionFixture('./.github/actions/repo/linked')
    const directory = path.join(fixture.actions, 'linked')
    mkdirSync(directory)
    const linked = path.join(directory, 'action.yml')
    symlinkSync(path.join(fixture.root, 'absent-action.yml'), linked)
    const findings = checkWorkflowActions(fixture.github)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain(linked)
  })

  it('rejects a linked scan root', () => {
    const fixture = actionFixture('./.github/actions/repo/tool')
    const linked = path.join(fixture.root, 'linked-github')
    symlinkSync(fixture.github, linked, 'dir')
    const findings = checkWorkflowActions(linked)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain(linked)
  })

  it('enforces the policy for every repository workflow and local action', () => {
    expect(checkWorkflowActions('.github')).toEqual([])
  })
})
