# Performance Testing

Comprehensive guide to socket-cli's test optimization strategies, including configuration, smart test selection, and memory management.

## Vitest Configuration

### Thread Pool

```typescript
pool: 'threads',
poolOptions: {
  threads: {
    maxThreads: isCoverageEnabled ? 1 : 16,
    minThreads: isCoverageEnabled ? 1 : 4,
    isolate: false,
    useAtomics: true,
  }
}
```

**Thread allocation**:
- **Development**: 4-16 threads for fast parallel execution
- **Coverage mode**: Single thread for accurate V8 coverage collection
- **Worker threads**: Leverage multi-core CPUs effectively

### `isolate: false` Tradeoff

**Decision matrix**:
```
isolate: true  → Full isolation, slower, breaks nock/module mocking
isolate: false → Shared worker context, faster, mocking works
```

**Why `isolate: false`**:
1. Significant performance improvement (faster test runs)
2. Nock HTTP mocking works correctly across all test files
3. Vi.mock() module mocking functions properly
4. Test state pollution prevented through proper beforeEach/afterEach
5. Tests designed to clean up after themselves

**Tests requiring isolation**:
- Use `{ pool: 'forks' }` in test file metadata
- Or use separate isolated config

### Timeouts

```typescript
testTimeout: 30_000  // 30 seconds
hookTimeout: 30_000  // 30 seconds
```

**Why 30 seconds**:
- CLI integration tests spawn processes
- Package manager operations (npm, pnpm, yarn)
- Network requests to Socket API
- SBOM generation with CDXgen
- File system operations in monorepo fixtures

**Timeout flow**:
```
Test starts → CLI spawns → Package manager runs → API calls → Assertions
  (instant)     (1-5s)         (5-15s)            (2-8s)      (instant)
                └─────────────── 30s maximum ─────────────────┘
```

### Coverage Configuration

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html', 'lcov', 'clover'],
  include: ['src/**/*.mts', 'src/**/*.ts'],
  exclude: [
    '**/*.config.*',
    '**/node_modules/**',
    'scripts/**',
    'test/**',
    'dist/**',
  ],
  all: true,
}
```

**Coverage modes**:
- **V8 provider**: Fast native coverage
- **Single thread**: Prevents race conditions
- **All files**: Reports uncovered code

## Smart Test Selection

### changed-test-mapper

Maps source file changes to affected test files:

```javascript
// Core files trigger full suite
CORE_FILES = [
  'src/helpers.ts',
  'src/strings.ts',
  'src/constants.ts',
  'src/lang.ts',
  'src/error.ts',
  'src/validate.ts',
]

// Specific mappings
src/package-url.ts → test/package-url.test.mts, test/integration.test.mts
src/result.ts      → test/result.test.mts
test/*.test.mts    → itself
```

**Decision tree**:
```
File changed?
  ├─ Core file     → Run all tests
  ├─ Config file   → Run all tests
  ├─ Test file     → Run that test
  ├─ Source file   → Run mapped tests
  └─ Data file     → Run integration tests
```

### Using `--staged` Flag

Run tests only for staged git changes:

```bash
# Lint and test staged files
pnpm check --staged
pnpm lint --staged --fix

# Stage specific changes, test them
git add src/package-url.ts
pnpm check --staged
```

**Flow**:
```
git add file.ts → --staged flag → getStagedFiles() → map to tests → run subset
```

### Using `--changed` Flag

Run tests for all uncommitted changes (default behavior):

```bash
# Lint and test changed files
pnpm check
pnpm check --changed  # explicit

# Fix changed files
pnpm fix
```

**Flow**:
```
Edit files → --changed flag → getChangedFiles() → map to tests → run subset
```

### Core Files Trigger Full Suite

When changed, these files affect entire codebase:

```javascript
CORE_FILES = [
  'src/constants.ts',    // Global constants
  'src/error.ts',        // Error handling
  'src/helpers.ts',      // Utility functions
  'src/lang.ts',         // Language utilities
  'src/objects.ts',      // Object utilities
  'src/strings.ts',      // String utilities
  'src/validate.ts',     // Validation logic
]

CONFIG_PATTERNS = [
  '.config/**',          // Build/lint configs
  'scripts/utils/**',    // Script utilities
  'tsconfig*.json',      // TypeScript config
  'eslint.config.*',     // ESLint config
]
```

**Example**:
```bash
# Edit core file
vi src/helpers.ts

# Triggers full suite
pnpm check
# ℹ Running all tests (core file changes)
```

## Test Execution Strategies

### Development Workflow

**Fast iteration**:
```bash
# Stage changes, run affected tests
git add src/package-url.ts
pnpm check --staged

# Fix issues in staged files
pnpm lint --staged --fix
git add .

# Run full check before commit
pnpm check
```

**Decision matrix**:
```
Quick fix?
  ├─ Yes → pnpm check --staged    (fast, targeted)
  └─ No  → pnpm check              (thorough, all affected)

Before commit?
  └─ Always → pnpm check           (no flags, full safety)
```

### CI Execution

**Always runs full suite**:
```javascript
if (process.env.CI === 'true') {
  return { tests: 'all', reason: 'CI environment' }
}
```

**CI flow**:
```
PR opened → CI detects → Runs all tests → Reports coverage → Status check
```

### Concurrent Execution

```typescript
sequence: {
  concurrent: true  // Run tests concurrently within suites
}
```

**Parallelization**:
```
Suite A: test1, test2, test3  → Thread pool
Suite B: test4, test5         → Thread pool  } Parallel
Suite C: test6, test7, test8  → Thread pool
```

**Benefits**:
- Better thread utilization
- Faster suite completion
- Efficient multi-core usage

### Early Bailout

```typescript
bail: process.env.CI ? 1 : 0
```

**Bailout strategy**:
```
CI environment:
  test1 ✓ → test2 ✓ → test3 ✗ → STOP (fast feedback)

Local development:
  test1 ✓ → test2 ✗ → test3 ✗ → Complete (see all failures)
```

## Memory Management

### Memory Limits

```javascript
NODE_OPTIONS:
  `--max-old-space-size=${process.env.CI ? 8192 : 4096} --max-semi-space-size=512`
```

**Memory allocation**:
```
Local:  4GB old space + 512MB semi space = ~4.5GB total
CI:     8GB old space + 512MB semi space = ~8.5GB total
```

**Why these limits**:
- CLI spawns subprocesses (npm, pnpm, yarn)
- RegExp-heavy tests (parsing, validation)
- SBOM generation loads large dependency trees
- Concurrent test execution multiplies memory

### Memory Flow

```
Test suite starts
  ├─ Vitest allocates workers (16 threads max)
  ├─ Each test spawns CLI process
  │   ├─ CLI spawns package manager
  │   ├─ Package manager loads dependency graph
  │   └─ CLI processes results
  ├─ V8 GC runs (semi-space helps with short-lived objects)
  └─ Workers cleaned up
```

### Worker Error Filtering

```javascript
// Filter out worker termination noise
if (result.stderr) {
  const filtered = result.stderr
    .split('\n')
    .filter(line => !line.includes('Worker unexpectedly exited'))
    .join('\n')
}
```

**Why filter**:
- Worker pool terminates normally after tests
- "Unexpectedly exited" is expected behavior
- Reduces noise in test output
- Focuses on actual errors

### Semi-Space Sizing

```
--max-semi-space-size=512
```

**Purpose**:
- Young generation GC optimization
- Better performance for short-lived objects
- CLI tests create many temporary objects:
  - Parsed command arguments
  - Spawned process metadata
  - RegExp match results
  - Temporary file paths

**GC flow**:
```
Object created → Semi-space → Survives? → Old space
                   (512MB)        No  → GC collects (fast)
                                  Yes → Promoted (kept)
```

## Isolated Tests

### When to Use Isolated Config

Use fork pool when tests:
- Mutate global state unsafely
- Require true process isolation
- Cannot share worker context
- Need independent module cache

**Example scenarios**:
```javascript
// Needs isolation: mutates process.env extensively
describe('environment tests', { pool: 'forks' }, () => {
  it('modifies NODE_ENV', () => {
    process.env.NODE_ENV = 'production'
    // Test logic
  })
})

// Does NOT need isolation: clean beforeEach/afterEach
describe('CLI tests', () => {
  beforeEach(() => {
    mockFs()
  })
  afterEach(() => {
    restoreFs()
  })
})
```

### Fork Pool vs Thread Pool

**Performance tradeoff**:
```
Thread Pool (default):
  ├─ Shared memory space
  ├─ Fast worker creation
  ├─ Efficient for most tests
  └─ 10-30s typical suite time

Fork Pool (isolated):
  ├─ Separate process per worker
  ├─ Slower worker creation
  ├─ True isolation guarantee
  └─ 2-5x slower than threads
```

**Configuration comparison**:
```typescript
// Standard config (fast)
pool: 'threads',
poolOptions: {
  threads: {
    isolate: false,
    maxThreads: 16,
  }
}

// Isolated config (safe)
pool: 'forks',
poolOptions: {
  forks: {
    singleFork: true,
    isolate: true,
  }
}
```

### Migration Strategy

```
Evaluate test:
  ├─ Modifies globals? → Use { pool: 'forks' } metadata
  ├─ Cleans up properly? → Keep in thread pool
  └─ Unsure? → Test both, compare results
```

## Best Practices

### Quick Reference

```bash
# Development
pnpm check --staged           # Fast feedback on staged changes
pnpm check                    # Run affected tests
pnpm lint --staged --fix      # Fix staged files

# Before commit
pnpm check                    # Full check on changed files
pnpm test                     # Full test suite

# Coverage
pnpm run cover                # Generate coverage report

# Specific tests
pnpm test test/result.test.mts           # Single test file
pnpm test 'test/**/*-url*.test.mts'      # Glob pattern
```

### Optimization Checklist

Test performance optimization:
- ✓ Use `--staged` for quick iteration
- ✓ Clean up resources in afterEach
- ✓ Avoid unnecessary isolation
- ✓ Use concurrent execution
- ✓ Filter worker error noise
- ✓ Monitor memory usage
- ✓ Profile slow tests

### Common Pitfalls

**Memory leaks**:
```javascript
// Bad: resource leak
it('spawns CLI', async () => {
  const child = spawn('socket', ['--help'])
  // Test logic
  // Missing: child.kill()
})

// Good: cleanup
it('spawns CLI', async () => {
  const child = spawn('socket', ['--help'])
  try {
    // Test logic
  } finally {
    child.kill()
  }
})
```

**False isolation needs**:
```javascript
// Bad: unnecessary isolation
describe('parser tests', { pool: 'forks' }, () => {
  it('parses URL', () => {
    // Pure function, no state mutation
  })
})

// Good: thread pool sufficient
describe('parser tests', () => {
  it('parses URL', () => {
    // Pure function, safe in threads
  })
})
```

**Timeout confusion**:
```bash
# Test times out, don't blindly increase
testTimeout: 60_000  # Bad reflex

# Instead: investigate why slow
# - Unnecessary waits?
# - Network timeout issues?
# - Process not terminating?
```

## Performance Monitoring

### Tracking Metrics

Monitor test suite health:
```
Metric              Target    Alert
Suite time          < 45s     > 60s
Memory peak         < 4GB     > 5GB
Thread utilization  > 60%     < 40%
Timeout failures    0         > 2
```

### Profiling Tests

```bash
# Time specific test
time pnpm test test/slow.test.mts

# Profile memory
NODE_OPTIONS="--max-old-space-size=4096 --heap-prof" pnpm test

# Vitest reporter
pnpm test --reporter=verbose
```

### Continuous Improvement

```
Measure → Identify bottlenecks → Optimize → Verify
  ↑                                            ↓
  └──────────────── Monitor ←─────────────────┘
```
