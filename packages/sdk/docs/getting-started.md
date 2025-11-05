# Getting Started

**Quick start guide** — Start contributing to the Socket.dev SDK in 5 minutes.

---

## 📋 Prerequisites

```
Required:
 ✓ Node.js 20+ (LTS recommended)
 ✓ pnpm 9+
 ✓ Git
 ✓ Socket.dev API key (for integration tests)
```

---

## 🚀 Quick Start

### 1. Clone & Setup

```bash
# Clone
git clone https://github.com/SocketDev/socket-sdk-js.git
cd socket-sdk-js

# Install & verify
pnpm install
pnpm test
```

**Expected:** ✓ 95% test coverage, ✓ 100% type coverage

---

### 2. Project Structure

```
socket-sdk-js/
├── src/                  # Source code
│   ├── api/              # API client implementation
│   ├── types/            # TypeScript types
│   ├── utils/            # Helper utilities
│   └── index.ts          # Main SDK exports
│
├── test/                 # Tests
│   ├── unit/             # Unit tests
│   └── integration/      # Integration tests
│
├── scripts/              # Build scripts
└── docs/                 # Documentation
    ├── api-reference.md  # Complete API docs
    ├── usage-examples.md # Code samples
    ├── when-to-use-what.md
    ├── quota-management.md
    └── dev/              # Developer docs
        └── testing.md
```

---

### 3. Essential Commands

```bash
# Development
pnpm run dev         # Watch mode
pnpm build           # Build for production

# Testing
pnpm test            # Unit tests
pnpm test:integration # Integration tests (requires API key)
pnpm run cover       # With coverage

# Quality
pnpm run check       # Type check + lint
pnpm run fix         # Auto-fix issues
```

---

## 🔑 API Key Setup

For integration tests, set your Socket.dev API key:

```bash
# .env file
SOCKET_API_KEY=your-api-key-here

# Or export directly
export SOCKET_API_KEY=your-api-key-here
```

Get your API key at [socket.dev/settings/api-keys](https://socket.dev/settings/api-keys)

---

## 💡 Development Workflow

```
1. Branch     → git checkout -b feature/my-change
2. Implement  → Edit src/ files
3. Test       → pnpm test (unit + integration)
4. Verify     → pnpm run fix && pnpm test
5. Docs       → Update API docs if needed
6. Commit     → Conventional commits
7. PR         → Submit pull request
```

---

## 📚 Key Concepts

### 1. API Versioning

The SDK wraps the Socket.dev REST API v0:

```typescript
import { SocketSdk } from '@socketsecurity/sdk'

const sdk = new SocketSdk('your-api-key')
```

### 2. Rate Limiting

Be mindful of API quotas:
- Check rate limits before large operations
- Use quota management utilities

See [docs/quota-management.md](./quota-management.md)

### 3. Type Safety

Full TypeScript support for all API responses:

```typescript
import type { PackageMetadata } from '@socketsecurity/sdk'

const metadata: PackageMetadata = await sdk.getPackage('npm', 'lodash')
```

### 4. Error Handling

All API errors are properly typed:

```typescript
try {
  await sdk.getPackage('npm', 'nonexistent')
} catch (error) {
  if (error.statusCode === 404) {
    // Handle not found
  }
}
```

---

## 🧪 Testing

### Unit Tests

Test business logic without API calls:

```typescript
// test/unit/utils/parse-purl.test.ts
import { describe, it, expect } from 'vitest'
import { parsePurl } from '../../../src/utils/parse-purl'

describe('parsePurl', () => {
  it('parses npm purl', () => {
    expect(parsePurl('pkg:npm/lodash@4.17.21')).toEqual({
      ecosystem: 'npm',
      name: 'lodash',
      version: '4.17.21'
    })
  })
})
```

### Integration Tests

Test actual API calls (requires API key):

```typescript
// test/integration/package.test.ts
import { SocketSdk } from '../../src'

const sdk = new SocketSdk(process.env.SOCKET_API_KEY!)

it('fetches package metadata', async () => {
  const data = await sdk.getPackage('npm', 'lodash')
  expect(data.name).toBe('lodash')
})
```

---

## 📖 Additional Resources

- [API Reference](./api-reference.md) - Complete method docs
- [Usage Examples](./usage-examples.md) - Common patterns
- [When to Use What](./when-to-use-what.md) - Method selection guide
- [Quota Management](./quota-management.md) - Rate limiting
- [Testing Guide](./dev/testing.md) - Testing best practices
- [CLAUDE.md](../CLAUDE.md) - Development standards

---

## ✅ Checklist

- [ ] Installed dependencies (`pnpm install`)
- [ ] Set up API key (for integration tests)
- [ ] Tests passing (`pnpm test`)
- [ ] Read [API Reference](./api-reference.md)
- [ ] Understand rate limiting
- [ ] Know commit format (conventional commits)
- [ ] Ready to contribute!

**Welcome!** 🎉
