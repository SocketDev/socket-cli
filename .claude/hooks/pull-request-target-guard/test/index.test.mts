// node --test specs for the pull-request-target-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end(JSON.stringify(payload))
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

test('non-workflow files pass through', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/src/foo.ts',
      new_string:
        'on: pull_request_target\nactions/checkout\npnpm install\n',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
})

test('non-Edit/Write tools pass through', async () => {
  const result = await runHook({
    tool_input: { command: 'echo pull_request_target' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('safe: pull_request_target without fork checkout', async () => {
  // pull_request_target trigger, but checkout pulls the BASE (default).
  const yaml = `name: PR check
on: pull_request_target
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: pnpm test
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/pr.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('safe: fork checkout without pull_request_target', async () => {
  // Same checkout shape but trigger is pull_request — no secrets in
  // scope, so executing fork code is fine.
  const yaml = `name: PR check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: pnpm install
      - run: pnpm test
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/pr.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('safe: pull_request_target + fork checkout but no execute step', async () => {
  // Workflow checks out the fork but only inspects metadata (e.g.
  // posts a comment). No execute. Zizmor's `dangerous-triggers`
  // would still flag the shape, but this hook is satisfied.
  const yaml = `name: comment
on: pull_request_target
jobs:
  comment:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({...})
`
  const result = await runHook({
    tool_input: {
      file_path: '/x/.github/workflows/comment.yml',
      new_string: yaml,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('BLOCKS: pull_request_target + fork checkout + pnpm install', async () => {
  const yaml = `name: PR check
on: pull_request_target
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: pnpm install
      - run: pnpm test
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/pr.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /pull_request_target/)
  assert.match(result.stderr, /package-manager install/)
})

test('BLOCKS: pull_request_target + fork checkout + npm i', async () => {
  const yaml = `on: pull_request_target
jobs:
  j:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.ref }}
      - run: npm i
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/x.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('BLOCKS: pull_request_target + fork checkout + build', async () => {
  const yaml = `on: pull_request_target
jobs:
  j:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: pnpm run build
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/x.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /node build/)
})

test('BLOCKS: pull_request_target + fork checkout + cargo build', async () => {
  const yaml = `on: pull_request_target
jobs:
  j:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: cargo build --release
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/x.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('BLOCKS: pull_request_target + fork checkout + pip install', async () => {
  const yaml = `on: pull_request_target
jobs:
  j:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: pip install -r requirements.txt
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/x.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('BLOCKS: pull_request_target + fork checkout + make', async () => {
  const yaml = `on: pull_request_target
jobs:
  j:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: make all
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/x.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('safe: pnpm install --ignore-scripts is allowed', async () => {
  // --ignore-scripts neutralizes the install-script vector. The
  // hook treats install-with-ignore-scripts as safe; a build step
  // on a subsequent line would still trip.
  const yaml = `on: pull_request_target
jobs:
  j:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: pnpm install --ignore-scripts
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/x.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('BLOCKS: pnpm install --ignore-scripts + then pnpm build (build still fork code)', async () => {
  const yaml = `on: pull_request_target
jobs:
  j:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: pnpm install --ignore-scripts
      - run: pnpm build
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/x.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('BLOCKS: array trigger form on: [pull_request, pull_request_target]', async () => {
  const yaml = `on: [pull_request, pull_request_target]
jobs:
  j:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: pnpm install
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/x.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('BLOCKS: pull_request_target with types in block-mapping form', async () => {
  const yaml = `on:
  pull_request_target:
    types: [opened, synchronize]
jobs:
  j:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: pnpm install
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/x.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('BLOCKS: shell-piped curl install', async () => {
  const yaml = `on: pull_request_target
jobs:
  j:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: bash -c "$(curl -sL https://example.com/install.sh)"
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/x.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('error message names all three risk components', async () => {
  const yaml = `on: pull_request_target
jobs:
  j:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: pnpm install
`
  const result = await runHook({
    tool_input: { file_path: '/x/.github/workflows/x.yml', new_string: yaml },
    tool_name: 'Write',
  })
  assert.match(result.stderr, /pull_request_target/)
  assert.match(result.stderr, /head\./)
  assert.match(result.stderr, /package-manager install/)
  assert.match(result.stderr, /Safer patterns/)
  assert.match(result.stderr, /labeled/)
})
