#!/bin/bash

# Fix imports that start with /src/ or /test/ to use correct relative paths

# For test/unit/*.test.mts (root level tests)
for f in test/unit/*.test.mts; do
  [ ! -f "$f" ] && continue
  sed -i '' -E "s|from '/src/|from '../../src/|g" "$f"
  sed -i '' -E "s|import\('/src/|import('../../src/|g" "$f"
  sed -i '' -E "s|vi\.mock\('/src/|vi.mock('../../src/|g" "$f"
done

# For test/unit/commands/*/*.test.mts (2 levels deep)
for f in test/unit/commands/*/*.test.mts; do
  [ ! -f "$f" ] && continue
  sed -i '' -E "s|from '/src/|from '../../../../../src/|g" "$f"
  sed -i '' -E "s|import\('/src/|import('../../../../../src/|g" "$f"
  sed -i '' -E "s|vi\.mock\('/src/|vi.mock('../../../../../src/|g" "$f"
  sed -i '' -E "s|from '/test/unit/|from '../../../../../src/|g" "$f"
  sed -i '' -E "s|import\('/test/unit/|import('../../../../../src/|g" "$f"
  sed -i '' -E "s|vi\.mock\('/test/unit/|vi.mock('../../../../../src/|g" "$f"
done

# For test/unit/utils/*/*.test.mts (2 levels deep under utils)
for f in test/unit/utils/*/*.test.mts; do
  [ ! -f "$f" ] && continue
  sed -i '' -E "s|from '/src/|from '../../../../../src/|g" "$f"
  sed -i '' -E "s|import\('/src/|import('../../../../../src/|g" "$f"
  sed -i '' -E "s|vi\.mock\('/src/|vi.mock('../../../../../src/|g" "$f"
  sed -i '' -E "s|from '/test/unit/|from '../../../../../src/|g" "$f"
  sed -i '' -E "s|import\('/test/unit/|import('../../../../../src/|g" "$f"
  sed -i '' -E "s|vi\.mock\('/test/unit/|vi.mock('../../../../../src/|g" "$f"
done

# For test/unit/shadow/*/*.test.mts
for f in test/unit/shadow/*/*.test.mts; do
  [ ! -f "$f" ] && continue
  sed -i '' -E "s|from '/src/|from '../../../../src/|g" "$f"
  sed -i '' -E "s|import\('/src/|import('../../../../src/|g" "$f"
  sed -i '' -E "s|vi\.mock\('/src/|vi.mock('../../../../src/|g" "$f"
done

# For test/unit/polyfills/*.test.mts
for f in test/unit/polyfills/*.test.mts; do
  [ ! -f "$f" ] && continue
  sed -i '' -E "s|from '/src/|from '../../../src/|g" "$f"
  sed -i '' -E "s|import\('/src/|import('../../../src/|g" "$f"
  sed -i '' -E "s|vi\.mock\('/src/|vi.mock('../../../src/|g" "$f"
done

echo "Fixed absolute imports to relative"
