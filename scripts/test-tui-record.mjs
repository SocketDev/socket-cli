#!/usr/bin/env node
/**
 * Record TUI test session and extract frames.
 */

import { spawn } from '@socketsecurity/registry/lib/spawn'
import { promises as fs } from 'node:fs'

const TUI_TEST_SCRIPT = `#!/usr/bin/env bash
# Automated TUI test with explicit timing.

# Start the TUI.
node scripts/load.mjs demo-final-tui &
TUI_PID=$!

# Wait for TUI to start.
sleep 2

# Type some text.
echo "dsdasdad" | xxd

# Expand with Ctrl+N (ASCII 14).
printf '\x0E'
sleep 1

# Type more text.
echo "adsasd"

# Submit with Enter.
printf '\n'
sleep 1

# Wait and exit.
sleep 1
kill $TUI_PID 2>/dev/null
`

async function main() {
  console.log('Creating test script...')
  await fs.writeFile('/tmp/tui-test-auto.sh', TUI_TEST_SCRIPT, { mode: 0o755 })

  console.log('Recording TUI session...')
  const { code, stdout, stderr } = await spawn('bash', ['-c', 'timeout 10s script -q /tmp/tui-test.log bash /tmp/tui-test-auto.sh'])

  console.log('Exit code:', code)
  if (stderr) console.error('Stderr:', stderr)

  console.log('\nRecorded output:')
  const content = await fs.readFile('/tmp/tui-test.log', 'utf8')
  console.log(content.slice(0, 500))
}

main().catch(console.error)
