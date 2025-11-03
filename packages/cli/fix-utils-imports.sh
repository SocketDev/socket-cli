#!/bin/bash

# Fix imports in nested test/unit/utils subdirectories  
# For files like test/unit/utils/ecosystem/*.test.mts
# Change ../../../../src/[file].mts -> ../../../../../src/utils/ecosystem/[file].mts

for dir in test/unit/utils/*/; do
  if [ ! -d "$dir" ]; then continue; fi
  
  subdir=$(basename "$dir")
  echo "Processing utils/$subdir..."
  
  find "$dir" -name "*.test.mts" -type f | while read -r testfile; do
    # Fix: ../../../../src/[file].mts -> ../../../../../src/utils/[subdir]/[file].mts
    sed -i '' -E "s|from '../../../../src/([^/]+\.mts)'|from '../../../../../src/utils/$subdir/\1'|g" "$testfile"
    sed -i '' -E "s|import\('../../../../src/([^/]+\.mts)'\)|import('../../../../../src/utils/$subdir/\1')|g" "$testfile"
    sed -i '' -E "s|vi\.mock\('../../../../src/([^/]+\.mts)'|vi.mock('../../../../../src/utils/$subdir/\1'|g" "$testfile"
  done
done

echo "Done!"
