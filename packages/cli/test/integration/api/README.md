# Integration Tests with Local Depscan Server

This directory contains integration tests that run against a local depscan server.

## Setup

### 1. Start Local Depscan API Server

In a separate terminal window:

```bash
cd /Users/jdalton/projects/depscan/workspaces/api-v0
pnpm test  # Starts API server on port 8866
```

The API server will start on `http://localhost:8866`.

**Note:** The depscan API server (port 8866) is different from the Next.js web server (port 3000).

### 2. Set Environment Variables (Optional)

If your local server runs on a non-standard port:

```bash
export SOCKET_CLI_API_BASE_URL=http://localhost:8080
```

If you need authentication:

```bash
export SOCKET_TEST_API_TOKEN=your-test-token
```

### 3. Run Integration Tests

```bash
cd /Users/jdalton/projects/socket-cli

# Run all integration tests
pnpm test:unit test/integration/

# Run specific test file
pnpm test:unit test/integration/patches-api.test.mts

# Run with verbose output
pnpm test:unit test/integration/patches-api.test.mts --reporter=verbose
```

## How It Works

The `local-server.mts` helper automatically:

1. Checks if `SOCKET_CLI_API_BASE_URL` is set
2. Falls back to checking default local URLs:
   - `http://localhost:8866` (depscan API server default)
   - `http://127.0.0.1:8866`
3. Pings the `/health` endpoint to verify server is running
4. Configures the Socket SDK to use the detected local server

If no local server is detected, tests are automatically skipped with a helpful message.

## Writing Integration Tests

### Basic Pattern

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  setupLocalServer,
  cleanupLocalServer,
} from '../helpers/local-server.mts'
import { setupSdk } from '../../src/utils/socket/sdk.mts'

describe('My Integration Test', () => {
  let originalUrl: string | undefined
  let localServerUrl: string | undefined

  beforeEach(async () => {
    originalUrl = await setupLocalServer()
    localServerUrl = process.env['SOCKET_CLI_API_BASE_URL']
  })

  afterEach(() => {
    cleanupLocalServer(originalUrl)
  })

  it('should test something', async () => {
    if (!localServerUrl) {
      console.log('⊘ Skipping test: local server not running')
      return
    }

    const sdkResult = await setupSdk({
      apiToken: process.env['SOCKET_TEST_API_TOKEN'] || 'test-token',
      apiBaseUrl: localServerUrl,
    })

    if (!sdkResult.ok) {
      throw new Error(`Failed to setup SDK: ${sdkResult.message}`)
    }

    const sdk = sdkResult.data

    // Your test code here
    const response = await sdk.get('/some/endpoint')
    expect(response).toBeDefined()
  })
})
```

### Custom Server URLs

If you need to check additional URLs:

```typescript
beforeEach(async () => {
  originalUrl = await setupLocalServer([
    'http://localhost:9000',
    'http://custom-host:3000',
  ])
  localServerUrl = process.env['SOCKET_CLI_API_BASE_URL']
})
```

## Debugging

### Check if API Server is Running

```bash
curl http://localhost:8866/health
```

### View SDK Configuration

Add debug logging to your test:

```typescript
it('should debug SDK config', async () => {
  console.log('API Base URL:', process.env['SOCKET_CLI_API_BASE_URL'])
  console.log('API Token:', process.env['SOCKET_TEST_API_TOKEN'])
})
```

### Force Specific URL

```bash
SOCKET_CLI_API_BASE_URL=http://localhost:8080 pnpm test:unit test/integration/
```

## Tips

- **Always run depscan server first** before running integration tests
- **Tests auto-skip** if server isn't detected - this is expected behavior
- **Use verbose output** (`--reporter=verbose`) to see skip messages
- **Set API token** via environment if tests require authentication
- **Check health endpoint** (`/health`) to verify server is reachable

## Troubleshooting

### Tests Are Being Skipped

This is normal if the local API server isn't running. Start the depscan API server first:

```bash
cd /Users/jdalton/projects/depscan/workspaces/api-v0
pnpm test
```

### Connection Refused

Make sure:
1. Depscan API server is running on port 8866
2. You're testing the **API server** (port 8866), not the web server (port 3000)
3. Server is listening on expected port (check console output)
4. No firewall blocking localhost connections

### Authentication Errors

Set your test API token:

```bash
export SOCKET_TEST_API_TOKEN=sktsec_test_xxxxx
```

Or pass it inline:

```bash
SOCKET_TEST_API_TOKEN=sktsec_test_xxxxx pnpm test:unit test/integration/
```
