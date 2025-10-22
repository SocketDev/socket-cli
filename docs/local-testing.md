# Testing Against Local Depscan API Server

This guide explains how to test socket-cli against a local depscan API server.

## Quick Start

### 1. Start the Depscan API Server

In one terminal:

```bash
cd ../depscan/workspaces/api-v0
pnpm test
```

The API server will start on `http://localhost:8866`.

### 2. Configure Socket CLI

The `.env.local` file is already configured to use the local API server:

```bash
# In socket-cli directory
cat .env.local
```

Should show:
```bash
SOCKET_CLI_API_BASE_URL=http://localhost:8866
```

### 3. Run Socket CLI Commands

Use the `pnpm s` script which automatically loads `.env.local`:

```bash
# Check version
pnpm s --version

# Test patch discover
pnpm s patch discover

# Create a scan
pnpm s scan create .
```

## Alternative Methods

### Method 1: Export Environment Variable

```bash
export SOCKET_CLI_API_BASE_URL=http://localhost:8866
./bin/cli.js patch discover
```

### Method 2: Inline Environment Variable

```bash
SOCKET_CLI_API_BASE_URL=http://localhost:8866 ./bin/cli.js patch discover
```

### Method 3: Use Dev Script

```bash
./scripts/dev-local.sh patch discover
```

## Verify Configuration

Check that the CLI is using the local server:

```bash
# Should show http://localhost:8866
pnpm s patch discover --debug
```

## Testing the New Patches API

### Test Free Tier Organization

```bash
# Set up test API token for a free-tier org
export SOCKET_CLI_API_TOKEN=sktsec_test_free_xxxxx

# Run patch discover
pnpm s patch discover
```

Expected behavior:
- Shows patches with PURL objects
- Displays free CVE fixes
- Shows "Upgrade tier for X additional vulnerabilities" messaging
- Only shows latest patch per PURL

### Test Enterprise Tier Organization

```bash
# Set up test API token for an enterprise org
export SOCKET_CLI_API_TOKEN=sktsec_test_enterprise_xxxxx

# Run patch discover
pnpm s patch discover
```

Expected behavior:
- Shows patches with PURL objects
- Displays all CVE fixes (free + paid)
- Shows total vulnerability count
- Only shows latest patch per PURL

## Troubleshooting

### API Server Not Responding

Check if the server is running:

```bash
curl http://localhost:8866/health
```

Should return a 200 status.

### Wrong API Server Being Used

Verify environment variable:

```bash
echo $SOCKET_CLI_API_BASE_URL
```

If not set, make sure `.env.local` is configured correctly and you're using `pnpm s`.

### Authentication Errors

Make sure you have a valid API token:

```bash
# Check if token is set
echo $SOCKET_CLI_API_TOKEN

# Or use socket login
pnpm s login
```

### Port Already in Use

If port 8866 is already in use:

1. Stop the existing process on port 8866
2. Or change the port in depscan configuration
3. Update `SOCKET_CLI_API_BASE_URL` accordingly

## Development Workflow

### Typical Development Flow

```bash
# Terminal 1: Start depscan API server
cd ../depscan/workspaces/api-v0
pnpm test

# Terminal 2: Build and run socket-cli
cd $(pwd)
pnpm run build
pnpm s patch discover

# After making changes to depscan
# Restart depscan server, no need to rebuild socket-cli

# After making changes to socket-cli
pnpm run build
pnpm s patch discover
```

### Watch Mode for Socket CLI

Keep socket-cli auto-rebuilding as you make changes:

```bash
# Terminal 1: Depscan server
cd ../depscan/workspaces/api-v0
pnpm test

# Terminal 2: Socket CLI watch mode
cd $(pwd)
pnpm run dev  # Alias for build:watch

# Terminal 3: Test commands
pnpm s patch discover
```

## Integration Tests

Run integration tests against local server:

```bash
# Start depscan server first (terminal 1)
cd ../depscan/workspaces/api-v0
pnpm test

# Run integration tests (terminal 2)
cd $(pwd)
pnpm test:unit test/integration/patches-api.test.mts
```

Tests will auto-detect the local server and run, or skip if not available.

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `SOCKET_CLI_API_BASE_URL` | API server URL | `http://localhost:8866` |
| `SOCKET_CLI_API_TOKEN` | API authentication token | `sktsec_test_xxxxx` |
| `SOCKET_CLI_API_PROXY` | HTTP proxy URL | `http://proxy:8080` |
| `SOCKET_CLI_API_TIMEOUT` | Request timeout in ms | `30000` |

## Tips

1. **Always start depscan server first** before running socket-cli commands
2. **Use `pnpm s`** for commands to auto-load `.env.local`
3. **Check server logs** in depscan terminal if API calls fail
4. **Use `--debug` flag** for verbose output when troubleshooting
5. **Keep both projects at same level** for easier path references

## Need Help?

- Check depscan server logs in terminal 1
- Verify API endpoint in browser: `http://localhost:8866/health`
- Test API directly with curl before testing CLI
- Check `.env.local` is configured correctly
- Ensure both projects are on compatible versions
