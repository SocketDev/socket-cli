// node --test specs for the no-token-in-dotenv-guard hook.

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

test('non-Edit/Write tools pass through', async () => {
  const result = await runHook({
    tool_input: { command: 'echo SOCKET_API_TOKEN=abc123' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('non-dotenv files pass through (even with token-like content)', async () => {
  for (const file_path of [
    '/x/docs/example.md',
    '/x/config/secrets.json',
    '/x/scripts/setup.sh',
  ]) {
    const result = await runHook({
      tool_input: {
        file_path,
        new_string: 'SOCKET_API_TOKEN=real-looking-token-value\n',
      },
      tool_name: 'Write',
    })
    assert.strictEqual(result.code, 0, file_path)
  }
})

test('blocks SOCKET_API_TOKEN in .env', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env',
      new_string: 'NODE_ENV=development\nSOCKET_API_TOKEN=sktsec_abc123def456\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /SOCKET_API_TOKEN/)
  assert.match(result.stderr, /OS keychain/)
})

test('blocks SOCKET_API_KEY (legacy) in .env.local', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env.local',
      new_string: 'SOCKET_API_KEY=sktsec_legacy_value\n',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
})

test('blocks ANTHROPIC_API_KEY in .env', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env',
      new_string: 'ANTHROPIC_API_KEY=sk-ant-real-key-value\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /ANTHROPIC_API_KEY/)
})

test('blocks OPENAI_API_KEY in .env', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env',
      new_string: 'OPENAI_API_KEY=sk-real-openai-value\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('blocks LINEAR_API_KEY in .env', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env',
      new_string: 'LINEAR_API_KEY=lin_api_real_value\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('blocks NOTION_TOKEN in .env', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env',
      new_string: 'NOTION_TOKEN=secret_real_value\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('blocks GITHUB_TOKEN in .env', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env',
      new_string: 'GITHUB_TOKEN=ghp_real_token_value\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('blocks generic *_API_TOKEN suffix in .env', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env',
      new_string: 'CUSTOM_VENDOR_API_TOKEN=real-value\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('allows empty token placeholder (scaffold)', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env',
      new_string: 'SOCKET_API_TOKEN=\nANTHROPIC_API_KEY=\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('allows <your-token> placeholder', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env',
      new_string: 'SOCKET_API_TOKEN=<your-token>\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('allows xxx / TODO / REPLACE_ME placeholders', async () => {
  for (const placeholder of ['xxx', 'XXX', 'TODO', 'REPLACE_ME', 'REPLACE-ME', 'your-key']) {
    const result = await runHook({
      tool_input: {
        file_path: '/x/proj/.env',
        new_string: `SOCKET_API_TOKEN=${placeholder}\n`,
      },
      tool_name: 'Write',
    })
    assert.strictEqual(result.code, 0, placeholder)
  }
})

test('allows ${VARNAME} substitution placeholder', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env',
      new_string: 'SOCKET_API_TOKEN=${SOCKET_TOKEN_FROM_KEYCHAIN}\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('allows comments and unrelated keys', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env',
      new_string: `# Configuration\nNODE_ENV=development\nPORT=3000\nDEBUG=true\nLOG_LEVEL=info\n`,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('handles export KEY=VALUE form', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.envrc',
      new_string: 'export SOCKET_API_TOKEN=real-value\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('handles quoted values', async () => {
  for (const quoted of ['"real-value"', "'real-value'"]) {
    const result = await runHook({
      tool_input: {
        file_path: '/x/proj/.env',
        new_string: `SOCKET_API_TOKEN=${quoted}\n`,
      },
      tool_name: 'Write',
    })
    assert.strictEqual(result.code, 2, quoted)
  }
})

test('multiple leaks in one file: all are surfaced', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/x/proj/.env',
      new_string:
        'SOCKET_API_TOKEN=real-1\nGITHUB_TOKEN=real-2\nANTHROPIC_API_KEY=real-3\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Line 1/)
  assert.match(result.stderr, /Line 2/)
  assert.match(result.stderr, /Line 3/)
})
