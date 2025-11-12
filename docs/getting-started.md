# Getting Started

**Quick start guide** — Get started with Socket CLI development in 10 minutes.

---

## 📋 Prerequisites

```
Required:
 ✓ Node.js 20+ (LTS recommended)
 ✓ pnpm 9+
 ✓ Git
 ✓ Socket.dev API key

Optional (for binary builds):
 ✓ Python 3.11+ (for SEA builds)
 ✓ Docker (for cross-platform builds)
```

---

## 🚀 Quick Start

### 1. Clone & Setup

```bash
# Clone
git clone https://github.com/SocketDev/socket-cli.git
cd socket-cli

# Install & verify
pnpm install
pnpm test
```

**This is a monorepo** with multiple packages!

---

### 2. Monorepo Structure

```
socket-cli/
├── packages/
│   ├── cli/                  # Main CLI package (@socketsecurity/cli)
│   │   ├── src/
│   │   │   ├── commands/     # CLI commands (scan, install, etc.)
│   │   │   ├── utils/        # Utilities
│   │   │   └── index.mts     # Entry point
│   │   └── test/
│   │
│   ├── bootstrap/            # CLI bootstrapper
│   ├── cli-with-sentry/      # Sentry integration
│   ├── socket/               # Published npm package wrapper
│   ├── node-sea-builder/     # Single Executable Application builder
│   ├── node-smol-builder/    # Optimized Node.js binary builder
│   └── sbom-generator/       # SBOM generation utilities
│
├── scripts/                  # Build and dev scripts
├── docs/                     # Extensive documentation
│   ├── architecture/         # System architecture
│   ├── build/                # Build system docs
│   ├── development/          # Developer guides
│   ├── node-smol-builder/    # Binary optimization
│   └── ...
│
└── pnpm-workspace.yaml       # Monorepo configuration
```

---

### 3. Essential Commands

```bash
# Development
pnpm run dev                  # Watch mode (all packages)
pnpm build                    # Build all packages

# Testing
pnpm test                     # Run all tests
pnpm test:unit                # Unit tests only
pnpm test:integration         # Integration tests
pnpm run cover:all            # Coverage for all packages

# Working with specific packages
pnpm --filter @socketsecurity/cli test    # Test CLI package only
pnpm --filter socket build                # Build socket package only

# Quality
pnpm run check                # Type check + lint all packages
pnpm run lint                 # Lint all packages
pnpm run fix                  # Auto-fix issues

# Binary builds (advanced)
pnpm run build:sea            # Build Single Executable Application
pnpm run build:smol           # Build optimized Node.js binary
```

---

## 🎯 Key Packages

### @socketsecurity/cli (packages/cli/)

**The main CLI implementation**

- All CLI commands (`socket scan`, `socket install`, etc.)
- Interactive console features
- Package manager integrations (npm, pnpm, yarn, bun)

### socket (packages/socket/)

**Published npm package**

- Wraps @socketsecurity/cli
- Handles installation and updates
- The package users actually `npm install -g socket`

### node-smol-builder (packages/node-smol-builder/)

**Optimized Node.js binary builder**

- Creates ~35MB Node.js binaries (vs 60MB+ standard)
- V8 Lite mode, ICU removal, SEA removal
- Custom patches for Windows, macOS, Linux

See [docs/node-smol-builder/](./node-smol-builder/) for details.

---

## 💡 Development Workflow

### Making Changes to CLI

```
1. Branch     → git checkout -b feature/my-change
2. Navigate   → cd packages/cli
3. Implement  → Edit src/commands/ or src/utils/
4. Test       → pnpm test (in packages/cli/)
5. Verify     → pnpm run fix && pnpm test (from root)
6. Commit     → Conventional commits
7. PR         → Submit pull request
```

### Adding New Commands

```typescript
// packages/cli/src/commands/my-command/index.mts
export async function handleMyCommand(argv, ctx) {
  // Command implementation
}

// packages/cli/src/commands/my-command/cli.mts
export const cliConfig = {
  command: 'my-command',
  description: 'Does something awesome',
  // ... command configuration
}
```

See [docs/development/](./development/) for detailed patterns.

---

## 🔑 API Key Setup

```bash
# .env file
SOCKET_SECURITY_API_KEY=your-api-key-here

# Or configure via CLI
socket config set apiKey your-api-key-here
```

Get your API key at [socket.dev/settings/api-keys](https://socket.dev/settings/api-keys)

---

## 📚 Key Concepts

### 1. Monorepo Workflow

Use pnpm workspaces for package management:

```bash
# Run command in specific package
pnpm --filter @socketsecurity/cli test

# Run command in all packages
pnpm -r test
```

### 2. Package Manager Integrations

CLI supports npm, pnpm, yarn, and bun:

```typescript
import { detectPackageManager } from '@socketsecurity/cli/utils/pm'

const pm = await detectPackageManager(cwd)
// 'npm' | 'pnpm' | 'yarn' | 'bun'
```

### 3. Interactive Console

Built with Ink (React for CLI):

```typescript
// packages/cli/src/commands/console/InteractiveConsoleApp.tsx
import { Text, Box } from 'ink'

export function InteractiveConsoleApp() {
  return (
    <Box>
      <Text>Interactive console</Text>
    </Box>
  )
}
```

### 4. Binary Distribution

The CLI can be distributed as:
- npm package (standard)
- Single Executable Application (SEA)
- Optimized Node.js binary (smol)

Each has different build processes. See [docs/build/](./build/).

---

## 🧪 Testing

### Unit Tests

```bash
# All unit tests
pnpm test:unit

# Specific package
pnpm --filter @socketsecurity/cli test:unit
```

### Integration Tests

```bash
# All integration tests (requires API key)
pnpm test:integration

# Specific test file
pnpm test test/integration/commands/scan.test.mts
```

### Coverage

```bash
# Coverage for all packages
pnpm run cover:all

# Coverage for CLI package only
pnpm --filter @socketsecurity/cli run test:unit:coverage
```

---

## 📖 Documentation Structure

Socket CLI has **extensive documentation**:

```
docs/
├── architecture/           # System design, bootstrap flow
├── build/                  # Build processes, WASM, patches
├── configuration/          # Config management
├── development/            # Setup, linking, platform support
├── node-smol-builder/      # Binary optimization details
├── sbom-generator/         # SBOM generation
├── testing/                # Test strategies
└── yoga-layout/            # Terminal layout engine
```

**Start with:**
1. [docs/development/getting-started.md](./development/getting-started.md) - Dev setup
2. [docs/architecture/](./architecture/) - How it all works
3. [docs/build/](./build/) - Build system deep dive

---

## 🆘 Getting Help

- **Issues:** [GitHub Issues](https://github.com/SocketDev/socket-cli/issues)
- **Discussions:** Ask in PR comments
- **Standards:** [CLAUDE.md](../CLAUDE.md) for conventions
- **Docs:** Extensive docs in [docs/](.)

---

## ✅ Checklist

- [ ] Installed dependencies (`pnpm install` from root)
- [ ] Tests passing (`pnpm test`)
- [ ] Set up API key
- [ ] Read [docs/development/getting-started.md](./development/getting-started.md)
- [ ] Understand monorepo structure
- [ ] Know pnpm workspace commands
- [ ] Understand commit format (conventional commits)
- [ ] Explored [docs/](.) for relevant guides
- [ ] Ready to contribute!

**Welcome to Socket CLI!** 🎉

---

## 🚀 Advanced Topics

Once you're comfortable with basics:

- **Binary Builds:** [docs/build/](./build/) - SEA and smol builds
- **Node Patches:** [docs/node-smol-builder/patches.md](./node-smol-builder/patches.md)
- **Performance:** [docs/node-smol-builder/performance.md](./node-smol-builder/performance.md)
- **WASM Integration:** [docs/build/wasm-integration.md](./build/wasm-integration.md)
- **NLP Features:** [docs/cli/nlp-context-optimization.md](./cli/nlp-context-optimization.md)
