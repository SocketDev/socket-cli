# Testing Yoga Layout (Taffy-based)

This document explains the testing strategy for verifying Yoga API compatibility using Taffy as the underlying layout engine.

## Table of Contents

- [Overview](#overview)
- [Test Suite Structure](#test-suite-structure)
- [Running Tests](#running-tests)
- [Test Approach](#test-approach)
- [Expected Failures](#expected-failures)
- [Adding New Tests](#adding-new-tests)
- [Benchmarking](#benchmarking)
- [References](#references)

## Overview

We validate Yoga API compatibility by running Yoga's official test suite against our Taffy-based implementation. This approach mirrors Socket's testing strategy for other projects:

- **Acorn**: Tests against ECMAScript test262 suite via submodule
- **Babel transforms**: Tests against Babel's unit tests via submodule

### Why This Approach?

1. **Authoritative**: Uses Yoga's official tests (same tests Facebook uses)
2. **Comprehensive**: ~950 tests covering all layout scenarios
3. **Continuous validation**: Ensures compatibility as we add features
4. **Regression detection**: Catches breaking changes immediately

## Test Suite Structure

### Yoga Test Submodule

We use Yoga v3.1.0's JavaScript test suite as a submodule:

```
.yoga-tests/                          # Git submodule
├── .git/                              # Submodule metadata
├── javascript/
│   ├── package.json                   # Yoga package.json
│   ├── src/
│   │   ├── index.ts                   # Yoga entry point
│   │   ├── wrapAssembly.ts            # WASM wrapper
│   │   └── generated/
│   │       └── YGEnums.ts             # Enum definitions
│   └── tests/
│       ├── generated/                 # Generated from HTML fixtures
│       │   ├── YGAbsolutePositionTest.test.ts
│       │   ├── YGAlignContentTest.test.ts
│       │   ├── YGAlignItemsTest.test.ts
│       │   ├── YGAlignSelfTest.test.ts
│       │   ├── YGAspectRatioTest.test.ts
│       │   ├── YGBorderTest.test.ts
│       │   ├── YGDimensionTest.test.ts
│       │   ├── YGDisplayTest.test.ts
│       │   ├── YGFlexDirectionTest.test.ts
│       │   ├── YGFlexTest.test.ts
│       │   ├── YGFlexWrapTest.test.ts
│       │   ├── YGGapTest.test.ts
│       │   ├── YGJustifyContentTest.test.ts
│       │   ├── YGMarginTest.test.ts
│       │   ├── YGMinMaxDimensionTest.test.ts
│       │   ├── YGPaddingTest.test.ts
│       │   ├── YGPercentageTest.test.ts
│       │   ├── YGRoundingTest.test.ts
│       │   ├── YGSizeOverflowTest.test.ts
│       │   └── YGStaticPositionTest.test.ts
│       ├── YGAlignBaselineTest.test.ts
│       ├── YGComputedBorderTest.test.ts
│       ├── YGComputedMarginTest.test.ts
│       ├── YGComputedPaddingTest.test.ts
│       ├── YGDirtiedTest.test.ts
│       ├── YGErrataTest.test.ts
│       ├── YGFlexBasisAuto.test.ts
│       ├── YGHasNewLayout.test.ts
│       ├── YGMeasureCacheTest.test.ts
│       ├── YGMeasureTest.test.ts
│       └── Benchmarks/
│           └── YGBenchmark.test.ts
```

**Submodule Details**:
- **Repository**: https://github.com/facebook/yoga
- **Version**: v3.1.0 (tag)
- **Cloned to**: `.yoga-tests/`
- **Test count**: ~950 tests total

### Our Test Runner

```
tests/
├── yoga-compat.test.mjs              # Main test runner
├── adapters/
│   ├── yoga-to-taffy.mjs              # Import adapter for our implementation
│   └── test-helpers.mjs               # Common test utilities
└── snapshots/                         # Test snapshots (expected vs actual)
    ├── flex.snap
    ├── padding.snap
    └── ...
```

## Running Tests

### Prerequisites

```bash
# Install dependencies
pnpm install

# Build WASM module
node scripts/build.mjs
```

### Basic Test Commands

```bash
# Run all Yoga compatibility tests
npm test

# Run specific test file
npm test -- --grep "YGFlexTest"

# Run with verbose output
npm test -- --reporter=verbose

# Update snapshots
npm test -- --update-snapshots
```

### Test Categories

```bash
# Flex properties only
npm test -- --grep "Flex"

# Padding and margin
npm test -- --grep "Padding|Margin"

# Alignment tests
npm test -- --grep "Align"

# Exclude known failures
npm test -- --grep "Flex" --invert --grep "Position|Border|Measure"
```

## Test Approach

### 1. Import Adaptation

Yoga tests import from `'yoga-layout'`. We use import remapping to substitute our implementation:

```javascript
// tests/adapters/yoga-to-taffy.mjs
import Yoga from '../../src/index.mjs'

// Initialize WASM
await Yoga.init()

// Re-export with same interface
export default Yoga
export * from '../../src/enums.mjs'
```

### 2. Test Execution Pattern

Each test follows this pattern:

```javascript
test('flex_basis_flex_grow_column', () => {
  const config = Yoga.Config.create()
  let root

  try {
    // Create node tree
    root = Yoga.Node.create(config)
    root.setWidth(100)
    root.setHeight(100)

    const child = Yoga.Node.create(config)
    child.setFlexGrow(1)
    child.setFlexBasis(50)
    root.insertChild(child, 0)

    // Calculate layout
    root.calculateLayout(undefined, undefined, Direction.LTR)

    // Assert computed values
    expect(root.getComputedWidth()).toBe(100)
    expect(root.getComputedHeight()).toBe(100)
    expect(child.getComputedTop()).toBe(0)
    expect(child.getComputedHeight()).toBe(100)
  } finally {
    // Cleanup
    root?.freeRecursive()
    config?.free()
  }
})
```

### 3. Comparison Strategy

We compare our implementation's output against expected values from Yoga:

1. **Exact match**: Computed layout values should match within floating-point epsilon (0.001)
2. **Snapshot testing**: Store expected layouts and compare against actual
3. **Visual diffing**: Generate HTML visualizations for debugging

### 4. Handling Floating Point

Layout calculations involve floating-point arithmetic. We use epsilon comparison:

```javascript
function expectClose(actual, expected, epsilon = 0.001) {
  expect(Math.abs(actual - expected)).toBeLessThan(epsilon)
}
```

## Expected Failures

### Known Unsupported Features

Some tests will fail due to Taffy limitations. We track these as expected failures:

#### 1. Border Tests (`YGBorderTest`)

**Reason**: Taffy v0.6 doesn't include border in layout calculations.

**Test Count**: ~50 tests

**Status**: ❌ Expected failures

**Workaround**: Convert border to padding in application code.

**Example**:
```javascript
test.skip('border_flex_child', () => {
  // Skipped: Taffy doesn't support border
})
```

#### 2. Absolute Position Tests (`YGAbsolutePositionTest`)

**Reason**: Absolute positioning not implemented in current wrapper.

**Test Count**: ~80 tests

**Status**: ❌ Expected failures

**Future**: Could be implemented by mapping to Taffy's position support.

**Example**:
```javascript
test.skip('absolute_layout_width_height_start_top', () => {
  // Skipped: Absolute positioning not supported
})
```

#### 3. Measure Function Tests (`YGMeasureTest`)

**Reason**: Taffy doesn't provide measure function extension points.

**Test Count**: ~30 tests

**Status**: ⚠️ Partial failures

**Workaround**: Pre-calculate sizes and set explicitly.

**Example**:
```javascript
test.skip('measure_flex_child', () => {
  // Skipped: Measure functions not integrated with layout
})
```

#### 4. Aspect Ratio Tests (`YGAspectRatioTest`)

**Reason**: Not yet implemented in wrapper.

**Test Count**: ~40 tests

**Status**: 🚧 Planned

**Example**:
```javascript
test.skip('aspect_ratio_flex_grow', () => {
  // Skipped: Aspect ratio not implemented
})
```

#### 5. Gap Tests (`YGGapTest`)

**Reason**: Not yet implemented in wrapper.

**Test Count**: ~25 tests

**Status**: 🚧 Planned

**Example**:
```javascript
test.skip('gap_column', () => {
  // Skipped: Gap not implemented
})
```

### Expected Pass Rate

| Category | Total Tests | Expected Passes | Pass Rate |
|----------|-------------|-----------------|-----------|
| Flex properties | ~200 | ~195 | 97.5% |
| Alignment | ~150 | ~145 | 96.7% |
| Sizing | ~180 | ~175 | 97.2% |
| Spacing (padding/margin) | ~140 | ~140 | 100% |
| Border | ~50 | ~0 | 0% (unsupported) |
| Position | ~80 | ~0 | 0% (unsupported) |
| Measure | ~30 | ~5 | 16.7% (partial) |
| Aspect Ratio | ~40 | ~0 | 0% (not implemented) |
| Gap | ~25 | ~0 | 0% (not implemented) |
| Other | ~55 | ~50 | 90.9% |
| **Total** | **~950** | **~710** | **74.7%** |

## Adding New Tests

### 1. Add Test to Our Suite

Create a new test file in `tests/`:

```javascript
// tests/custom-layout.test.mjs
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import Yoga from '../src/index.mjs'

await Yoga.init()

test('custom layout scenario', () => {
  const root = Yoga.Node.create()
  root.setFlexDirection(Yoga.FlexDirection.Row)
  // ... test implementation
})
```

### 2. Add Snapshot Test

Generate expected layout snapshot:

```javascript
test('flex layout snapshot', () => {
  const layout = computeLayout(root)
  expect(layout).toMatchSnapshot()
})
```

### 3. Visual Testing

Generate HTML visualization for manual verification:

```javascript
function generateHTML(node, depth = 0) {
  const layout = node.getComputedLayout()
  return `
    <div style="
      position: absolute;
      left: ${layout.left}px;
      top: ${layout.top}px;
      width: ${layout.width}px;
      height: ${layout.height}px;
      border: 1px solid black;
    ">
      ${Array.from({ length: node.getChildCount() })
        .map((_, i) => generateHTML(node.getChild(i), depth + 1))
        .join('')}
    </div>
  `
}
```

## Benchmarking

### Layout Performance

Benchmark layout calculation performance:

```javascript
// tests/benchmarks/layout-perf.mjs
import { performance } from 'node:perf_hooks'
import Yoga from '../../src/index.mjs'

await Yoga.init()

function benchmarkLayout(nodeCount) {
  const root = createComplexTree(nodeCount)

  const start = performance.now()
  root.calculateLayout(1000, 1000, Yoga.DIRECTION_LTR)
  const end = performance.now()

  return end - start
}

// Run benchmark
console.log('Layout performance (1000 nodes):', benchmarkLayout(1000), 'ms')
```

### Comparing with Yoga

Compare our performance against official Yoga:

```bash
# Benchmark our implementation
npm run benchmark

# Compare against Yoga C++
cd .yoga-tests/javascript
npm run benchmark
```

### Expected Performance

Taffy is designed for high performance:
- **Pure Rust**: No FFI overhead
- **SIMD**: 20-30% performance boost on modern CPUs
- **Efficient algorithm**: O(n) layout calculation

Target performance: Within 10% of Yoga C++ for common layouts.

## Debugging Failed Tests

### 1. Visual Debugging

Generate HTML visualization:

```bash
npm run test:visual -- YGFlexTest
```

Opens browser with side-by-side comparison:
- Left: Expected layout (Yoga C++)
- Right: Actual layout (our implementation)

### 2. Verbose Output

Run test with detailed logging:

```bash
DEBUG=yoga:* npm test -- --reporter=verbose
```

### 3. Single Test Isolation

Run single test in isolation:

```javascript
test.only('specific_flex_scenario', () => {
  // ... test implementation
})
```

### 4. Layout Diffing

Compare computed layouts:

```javascript
function diffLayouts(expected, actual) {
  console.log('Expected:', JSON.stringify(expected, null, 2))
  console.log('Actual:', JSON.stringify(actual, null, 2))
  console.log('Diff:', {
    left: actual.left - expected.left,
    top: actual.top - expected.top,
    width: actual.width - expected.width,
    height: actual.height - expected.height,
  })
}
```

## Continuous Integration

### GitHub Actions

Run tests in CI:

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive  # Clone .yoga-tests/

      - name: Setup Rust
        uses: actions-rust-lang/setup-rust-toolchain@v1
        with:
          toolchain: stable
          target: wasm32-unknown-unknown

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: pnpm install

      - name: Build WASM
        run: node scripts/build.mjs

      - name: Run tests
        run: npm test
```

### Coverage Reporting

Generate coverage report:

```bash
npm run test:coverage
```

## References

### Test Resources

- **Yoga Test Suite**: https://github.com/facebook/yoga/tree/main/javascript/tests
- **Yoga Test Generator**: https://github.com/facebook/yoga/tree/main/gentest
- **W3C Flexbox Tests**: https://github.com/web-platform-tests/wpt/tree/master/css/css-flexbox

### Related Testing Approaches

- **Acorn test262 integration**: `../ultrathink/acorn/tests/`
- **Socket CLI test patterns**: `../../packages/cli/test/`
- **Vitest documentation**: https://vitest.dev/

### Tools

- **Vitest**: https://vitest.dev/ (fast test runner)
- **Node.js Test Runner**: https://nodejs.org/api/test.html (built-in alternative)
- **Snapshot Testing**: https://vitest.dev/guide/snapshot.html

## Contributing

### Adding Test Coverage

1. Identify untested Yoga API surface
2. Check if Taffy supports the feature
3. Write test following existing patterns
4. Run test and verify expected behavior
5. Add expected failure annotation if unsupported

### Fixing Failing Tests

1. Identify root cause (our bug vs Taffy limitation)
2. If our bug: Fix in Rust or adapter layer
3. If Taffy limitation: Document and mark as expected failure
4. Add regression test to prevent reoccurrence

### Test Guidelines

- **One assertion per test**: Makes failures easier to diagnose
- **Descriptive names**: Follow Yoga's naming convention
- **Cleanup resources**: Always call `freeRecursive()` in finally block
- **Epsilon comparison**: Use `expectClose()` for floating-point
- **Document skipped tests**: Explain why test is skipped with reference
