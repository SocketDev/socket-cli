import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  checkSfwWrap,
  checkWorkflowSocket,
} from '../../../../src/commands/doctor/practice-checks.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

describe('practice checks', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'practice-checks-'))
  })

  afterEach(async () => {
    await safeDelete(dir)
  })

  function write(rel: string, content: string) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), content)
  }

  it('flags a bare npm install in package.json scripts', () => {
    write('package.json', JSON.stringify({ scripts: { setup: 'npm install' } }))
    const violations = checkSfwWrap(dir)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: 'package.json',
      practice: 'sfw',
    })
  })

  it('passes an sfw-wrapped install', () => {
    write(
      'package.json',
      JSON.stringify({ scripts: { setup: 'sfw npm install' } }),
    )
    expect(checkSfwWrap(dir)).toEqual([])
  })

  it('flags a bare pnpm install in a workflow with file and line', () => {
    write(
      '.github/workflows/ci.yml',
      ['jobs:', '  test:', '    steps:', '      - run: pnpm install'].join(
        '\n',
      ),
    )
    const violations = checkSfwWrap(dir)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: '.github/workflows/ci.yml',
      line: 4,
      practice: 'sfw',
    })
  })

  it('ignores comment lines and non-install commands', () => {
    write(
      '.github/workflows/ci.yml',
      [
        '# npm install is what we avoid here',
        'jobs:',
        '  test:',
        '    steps:',
        '      - run: pnpm test',
      ].join('\n'),
    )
    expect(checkSfwWrap(dir)).toEqual([])
  })

  it('flags a workflow set with no Socket anywhere', () => {
    write(
      '.github/workflows/ci.yml',
      'jobs:\n  test:\n    steps:\n      - run: pnpm test',
    )
    const violations = checkWorkflowSocket(dir)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.practice).toBe('workflows')
  })

  it('passes when any workflow carries Socket', () => {
    write(
      '.github/workflows/ci.yml',
      'jobs:\n  test:\n    steps:\n      - uses: SocketDev/action@v1',
    )
    expect(checkWorkflowSocket(dir)).toEqual([])
  })

  it('passes when a workflow step is sfw-wrapped', () => {
    write(
      '.github/workflows/ci.yml',
      'jobs:\n  test:\n    steps:\n      - run: sfw npm install',
    )
    expect(checkWorkflowSocket(dir)).toEqual([])
    expect(checkSfwWrap(dir)).toEqual([])
  })

  it('passes repos with no workflows at all', () => {
    expect(checkWorkflowSocket(dir)).toEqual([])
  })
})
