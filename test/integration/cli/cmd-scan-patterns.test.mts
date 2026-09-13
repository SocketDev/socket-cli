import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { expect, it } from 'vitest'

import { getBinCliPath } from '../../../src/constants/paths.mts'
import { spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

it('runs published manifest patterns through the built CLI', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'socket-pattern-scan-'),
  )
  try {
    const manifest = path.join(directory, 'example.yaml')
    const encodedExample = Buffer.from('example-value').toString('base64')
    await writeFile(
      manifest,
      `kind: Secret\nmetadata:\n  name: example-secret\ndata:\n  example: ${encodedExample}\n`,
    )
    const { code, stdout } = await spawnSocketCli(binCliPath, [
      'scan',
      'manifests',
      manifest,
      '--json',
      '--no-banner',
    ])
    const result: unknown = JSON.parse(stdout)
    expect(result).toMatchObject({
      filesScanned: 1,
      findings: [
        {
          file: expect.stringContaining('example.yaml'),
          ruleId: 'gitleaks:kubernetes-secret-yaml',
          severity: 'high',
        },
      ],
      scanner: 'manifests',
      unsupportedRules: [],
    })
    expect(stdout).not.toContain(encodedExample)
    expect(code).toBe(1)
  } finally {
    await safeDelete(directory, { maxRetries: 0 })
  }
})

it('reports audit-only coverage without claiming findings', async () => {
  const { code, stdout } = await spawnSocketCli(binCliPath, [
    'scan',
    'workflows',
    '.github/workflows/ci.yml',
    '--json',
    '--no-banner',
  ])
  const result: unknown = JSON.parse(stdout)
  expect(result).toMatchObject({
    filesScanned: 1,
    findings: [],
    scanner: 'workflows',
  })
  expect(result).toHaveProperty('unsupportedRules')
  expect(code).toBe(0)
})
