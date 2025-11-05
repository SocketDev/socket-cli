# test utilities

Test environment helpers for Socket SDK tests.

## quick reference

```typescript
import { setupTestClient } from './utils/environment.mts'

const getClient = setupTestClient('test-token', { retries: 0 })
```

## full documentation

See **[docs/dev/testing.md](../../docs/dev/testing.md)** for:
- Complete API reference
- Usage patterns and examples
- Best practices
- Helper selection guide
- Coverage mode behavior
- Public testing utilities (fixtures, mocks, type guards)

## available utilities

From `test/utils/environment.mts`:
- `setupTestClient()` - Combined nock + client setup (recommended)
- `setupTestEnvironment()` - Just nock setup
- `createTestClient()` - Just client creation
- `isCoverageMode` - Coverage detection flag

From other `test/utils/*` files:
- `assertions.mts` - Custom test assertions
- `constants.mts` - Test constants
- `error-test-helpers.mts` - Error testing utilities
- `fixtures.mts` - Mock data fixtures
- `local-server-helpers.mts` - HTTP server testing
- `mock-helpers.mts` - Response builders
