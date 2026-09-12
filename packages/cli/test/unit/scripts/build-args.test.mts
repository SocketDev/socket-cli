import process from 'node:process'

import { afterEach, expect, it } from 'vitest'

import { parseArgs } from '../../../../../scripts/repo/build-steps/cli.mts'

const originalArgv = process.argv

afterEach(() => {
  process.argv = originalArgv
})

it.each([
  {
    args: ['--target', 'linux-x64'],
    expected: { target: 'linux-x64', buildArgs: [] },
  },
  {
    args: ['--targets', ' linux-x64, darwin-arm64 '],
    expected: { targets: ['linux-x64', 'darwin-arm64'], buildArgs: [] },
  },
  {
    args: ['--platform', 'linux', '--arch=x64'],
    expected: { target: 'linux-x64', platform: 'linux', arch: 'x64' },
  },
  {
    args: ['--target'],
    expected: { target: undefined, buildArgs: ['--target'] },
  },
  {
    args: ['--parallel', '--force', '-h', '--custom'],
    expected: {
      parallel: true,
      force: true,
      help: true,
      buildArgs: ['--custom'],
    },
  },
])('retains build arguments $args', ({ args, expected }) => {
  process.argv = [process.execPath, 'example-build.mts', ...args]
  expect(parseArgs()).toMatchObject(expected)
})
