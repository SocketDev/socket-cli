#!/bin/bash

# Fix imports in test/unit/commands subdirectories
# Pattern: ../../../../src/[file].mts -> ../../../../../src/commands/[subdir]/[file].mts

for dir in test/unit/commands/*/; do
  subdir=$(basename "$dir")
  echo "Processing $subdir..."
  
  # Find all test files in this subdirectory
  find "$dir" -name "*.test.mts" -type f | while read -r testfile; do
    # Fix static imports: from '../../../../src/[file].mts'
    # Extract just the filename and replace with full path
    sed -i '' -E "s|from '../../../../src/([^/]+\.mts)'|from '../../../../../src/commands/$subdir/\1'|g" "$testfile"
    
    # Fix dynamic imports: await import('../../../../src/[file].mts')
    sed -i '' -E "s|import\('../../../../src/([^/]+\.mts)'\)|import('../../../../../src/commands/$subdir/\1')|g" "$testfile"
    
    # Fix vi.mock imports: vi.mock('../../../../src/[file].mts'
    sed -i '' -E "s|vi\.mock\('../../../../src/([^/]+\.mts)'|vi.mock('../../../../../src/commands/$subdir/\1'|g" "$testfile"
  done
done

echo "Done!"
