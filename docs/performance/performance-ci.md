# CI/CD Performance Optimization

Comprehensive guide to socket-cli's CI/CD pipeline optimization strategy and performance characteristics.

## Workflow Architecture

```
CI Trigger (PR/Push)
  │
  ├─ socket-cli/.github/workflows/ci.yml
  │   └─ calls socket-registry/.github/workflows/ci.yml@<SHA>
  │       │
  │       ├─ 🧹 Lint Check (parallel)
  │       ├─ 🔍 Type Check (parallel)
  │       └─ 🧪 Test Matrix (parallel)
  │           ├─ Node 20 x Ubuntu
  │           ├─ Node 20 x macOS
  │           ├─ Node 20 x Windows
  │           ├─ Node 22 x Ubuntu
  │           ├─ Node 22 x macOS
  │           ├─ Node 22 x Windows
  │           ├─ Node 24 x Ubuntu
  │           ├─ Node 24 x macOS
  │           └─ Node 24 x Windows
```

## Reusable Workflow Strategy

Socket-cli uses a centralized reusable workflow from socket-registry:

```yaml
uses: SocketDev/socket-registry/.github/workflows/ci.yml@020ed8b2ef62abb750b083d7859ee3a221f88cf7 # main
```

**Benefits**:
- Single source of truth for CI configuration across Socket projects
- Centralized updates to CI logic benefit all projects
- Consistent behavior and optimization patterns
- Reduced maintenance burden per project

**Pinned SHA Requirements**:
- GitHub Actions security best practice
- Ensures reproducible builds
- Prevents supply chain attacks via tag manipulation
- Update using: `cd socket-registry && git rev-parse main`

## Matrix Testing Configuration

```yaml
node-versions: '[20, 22, 24]'
os-versions: '["ubuntu-latest", "macos-latest", "windows-latest"]'
fail-fast: false
max-parallel: 4
```

**Design Decisions**:
- `fail-fast: false` - All platform combinations must pass; no early exit
- Cross-platform testing ensures Windows + Unix compatibility
- Multiple Node versions validate compatibility range (18+)
- `max-parallel: 4` - Balance between speed and resource usage

## CI-Specific Optimizations

### 1. Early Bailout on Failures

```javascript
// vitest.config.mts
bail: process.env.CI ? 1 : 0
```

**Effect**: Exit immediately on first test failure in CI
**Benefit**: Faster feedback loop, saves compute time
**Local behavior**: Runs all tests for comprehensive debugging

### 2. CI-Specific Scripts

```json
{
  "lint-ci": "pnpm run lint",
  "test-ci": "run-s test:*",
  "type-ci": "pnpm run type"
}
```

**Why separate scripts**:
- No watch mode in CI (`--watch` flags removed)
- No interactive prompts or user input
- Consistent exit codes for CI integration
- Clear separation between dev and CI workflows
- Easy to add CI-specific flags (`--ci`, `--no-color`, etc.)

**Standard pattern**:
```
Development:  pnpm run lint        # May include --fix, --watch
CI:           pnpm run lint-ci     # Strict mode, no modifications
```

### 3. Test Parallelization

```javascript
// vitest.config.mts
pool: 'threads',
poolOptions: {
  threads: {
    singleThread: false,
    maxThreads: isCoverageEnabled ? 1 : 16,
    minThreads: isCoverageEnabled ? 1 : 4,
    isolate: false,
    useAtomics: true
  }
},
sequence: {
  concurrent: true
}
```

**Performance characteristics**:
- Multi-threaded execution (up to 16 threads)
- Worker isolation disabled for speed (`isolate: false`)
- Concurrent test execution within suites
- Atomic operations for thread synchronization

**Trade-offs**:
- Speed over full isolation
- Requires proper test cleanup (beforeEach/afterEach)
- Mocking frameworks (nock, vi.mock) work correctly

### 4. Build Caching Strategy

```yaml
test-setup-script: 'cd packages/cli && pnpm run build'
```

**Caching layers**:
1. pnpm store cache (dependencies)
2. Node modules cache
3. Build artifacts (dist/)

**Handled by setup-and-install action**:
- Automatic dependency caching by pnpm/action-setup
- Cache key based on pnpm-lock.yaml hash
- Separate caches per OS/Node version combination

### 5. Dependency Installation

```yaml
# Managed by SocketDev/socket-registry/.github/actions/setup-and-install
```

**Optimizations**:
- Frozen lockfile (`pnpm install --frozen-lockfile`)
- Shared pnpm store across workflow runs
- Parallel dependency fetching
- No postinstall scripts unless explicitly needed

## Performance Metrics

**Typical CI run times** (per platform):

```
Job                Duration    Notes
─────────────────────────────────────────────────────
Lint Check         1-2 min     Biome + ESLint
Type Check         1-2 min     TypeScript compilation
Test (Ubuntu)      3-5 min     Fastest platform
Test (macOS)       4-6 min     Medium performance
Test (Windows)     5-8 min     Slowest platform
─────────────────────────────────────────────────────
Total (parallel)   5-8 min     All checks running
Total (sequential) 20-30 min   If run serially
```

**Time saved with optimizations**:
- Parallel execution: ~15-20 min saved vs sequential
- Build caching: ~1-2 min saved per job
- Early bailout: ~2-4 min saved on test failures
- Dependency caching: ~30-60 sec saved per job

**Total optimization impact**: ~18-26 min saved per CI run

## When CI Runs

```yaml
on:
  push:
    branches: [main]
    tags: ['*']
    paths:
      - 'packages/cli/**'
      - 'pnpm-lock.yaml'
      - 'package.json'
      - '.github/workflows/ci.yml'
  pull_request:
    branches: [main]
    paths:
      - 'packages/cli/**'
      - 'pnpm-lock.yaml'
      - 'package.json'
      - '.github/workflows/ci.yml'
  workflow_dispatch:
```

**Trigger conditions**:
- Pull requests to main branch
- Pushes to main branch
- Tag creation (releases)
- Manual dispatch (workflow_dispatch)
- Only when relevant files change (path filtering)

**Path filtering benefits**:
- Skip CI for docs-only changes
- Reduce unnecessary builds
- Faster feedback on non-code changes

## Debugging CI Failures

### Reproduce Locally

```bash
# Set CI environment
export CI=1

# Run exact CI commands
cd packages/cli
pnpm run build
pnpm run check
pnpm run type
pnpm run test:unit
```

**Environment differences to consider**:
```bash
CI=1              # Enables CI-specific behavior
NODE_ENV=test     # May affect config loading
NO_COLOR=1        # Disables terminal colors
TERM=dumb         # Non-interactive terminal
```

### Common Issues

**Issue**: Tests pass locally, fail in CI
```
Causes:
  - Missing build step (pretest hook skipped in CI)
  - Environment variable differences
  - File path case sensitivity (macOS vs Linux)
  - Timing issues with concurrent tests

Solution:
  1. Run pnpm run build explicitly
  2. Check .env.test vs .env.local
  3. Use path.join() for cross-platform paths
  4. Add await or increase timeouts
```

**Issue**: Windows tests fail, Unix passes
```
Causes:
  - Hard-coded forward slashes in paths
  - Line ending differences (CRLF vs LF)
  - Case-sensitive imports
  - Shell script incompatibilities

Solution:
  1. Use path.join(), path.resolve()
  2. Configure Git: core.autocrlf=input
  3. Match exact casing in imports
  4. Use Node.js APIs instead of shell commands
```

**Issue**: Flaky test failures
```
Causes:
  - Race conditions in concurrent tests
  - Shared state between tests
  - External service dependencies
  - Filesystem timing issues

Solution:
  1. Add proper cleanup in afterEach
  2. Use unique temp directories per test
  3. Mock external dependencies (nock)
  4. Add fs.promises with await
```

### CI-Specific Debugging

**Enable debug output**:
```yaml
workflow_dispatch:
  inputs:
    debug: '1'
```

**Check specific Node/OS combination**:
```yaml
workflow_dispatch:
  inputs:
    node-versions: '[22]'
    os-versions: '["ubuntu-latest"]'
```

**Skip tests temporarily**:
```yaml
workflow_dispatch:
  inputs:
    skip-tests: true
```

### Environment Differences

```
Local Development          CI Environment
──────────────────────────────────────────────────
Interactive terminal       Non-interactive (TERM=dumb)
Color output enabled       Colors disabled (NO_COLOR=1)
Watch mode available       No watch mode
Build cache persistent     Fresh build each run
Node modules cached        Clean install
Git hooks active           No Git hooks
.env.local loaded          .env.test loaded
User-specific config       No user config
```

## Optimization Best Practices

### Test Organization

```javascript
// Good - Fast tests
describe('validation', () => {
  it('should validate input', () => {
    expect(validate('test')).toBe(true)
  })
})

// Avoid - Slow tests
describe('validation', { timeout: 60_000 }, () => {
  it('should validate with network call', async () => {
    const result = await fetchAndValidate('test')
    expect(result).toBe(true)
  })
})
```

**Guidelines**:
- Unit tests should be fast (<100ms each)
- Mock external dependencies (filesystem, network, APIs)
- Use fixtures instead of generating data
- Avoid unnecessary async operations
- Group slow tests separately (e2e, integration)

### Script Composition

```json
{
  "test": "run-s check test:*",
  "test:prepare": "pnpm build && del-cli 'test/**/node_modules'",
  "test:unit": "vitest run",
  "test:validate": "node scripts/validate-tests.mjs",
  "test:wrapper": "node scripts/test-wrapper.mjs",
  "test-ci": "run-s test:*"
}
```

**Pattern**: Break into atomic steps
- Each step can run independently
- Easy to debug individual failures
- Clear progress tracking
- Parallel execution possible (run-p vs run-s)

### Caching Strategy

**What to cache**:
- pnpm store (automatic via pnpm/action-setup)
- node_modules (automatic)
- Build artifacts (dist/)
- Type coverage results

**What NOT to cache**:
- Test results (must run fresh)
- Temporary files
- Log output
- Coverage reports

## Future Optimizations

**Potential improvements**:
- Sharded test execution (split tests across jobs)
- Incremental type checking (only changed files)
- Build output caching between jobs
- Dynamic matrix based on changed files
- Turborepo for monorepo task caching

**Blocked by**:
- Vitest sharding support maturity
- TypeScript incremental build complexity
- GitHub Actions artifact size limits
- Matrix job coordination overhead

## Related Documentation

- Build system: `docs/build-system-summary.md`
- Local testing: `docs/local-testing.md`
- Configuration: `docs/configuration-summary.md`
- Socket registry standards: `../socket-registry/CLAUDE.md`
