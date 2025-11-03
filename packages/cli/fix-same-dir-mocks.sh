#!/bin/bash

# Fix same-directory mocks in test files
# Pattern: vi.mock('./file.mts' -> vi.mock('path/to/src/subdir/file.mts'

# Fix in test/unit/utils/*/
for dir in test/unit/utils/*/; do
  if [ ! -d "$dir" ]; then continue; fi
  
  subdir=$(basename "$dir")
  echo "Processing utils/$subdir mocks..."
  
  find "$dir" -name "*.test.mts" -type f | while read -r testfile; do
    # Fix: vi.mock('./file.mts' -> vi.mock('../../../../../src/utils/subdir/file.mts'
    sed -i '' -E "s|vi\.mock\('./([^/]+\.mts)'|vi.mock('../../../../../src/utils/$subdir/\1'|g" "$testfile"
    sed -i '' -E "s|vi\.doMock\('./([^/]+\.mts)'|vi.doMock('../../../../../src/utils/$subdir/\1'|g" "$testfile"
  done
done

# Fix in test/unit/commands/*/
for dir in test/unit/commands/*/; do
  if [ ! -d "$dir" ]; then continue; fi
  
  subdir=$(basename "$dir")
  echo "Processing commands/$subdir mocks..."
  
  find "$dir" -name "*.test.mts" -type f | while read -r testfile; do
    # Fix: vi.mock('./file.mts' -> vi.mock('../../../../../src/commands/subdir/file.mts'
    sed -i '' -E "s|vi\.mock\('./([^/]+\.mts)'|vi.mock('../../../../../src/commands/$subdir/\1'|g" "$testfile"
    sed -i '' -E "s|vi\.doMock\('./([^/]+\.mts)'|vi.doMock('../../../../../src/commands/$subdir/\1'|g" "$testfile"
  done
done

# Fix in test/unit/shadow/*/
for dir in test/unit/shadow/*/; do
  if [ ! -d "$dir" ]; then continue; fi
  
  subdir=$(basename "$dir")
  echo "Processing shadow/$subdir mocks..."
  
  find "$dir" -name "*.test.mts" -type f | while read -r testfile; do
    # Fix: vi.mock('./file.mts' -> vi.mock('../../../../../src/shadow/subdir/file.mts'
    sed -i '' -E "s|vi\.mock\('./([^/]+\.mts)'|vi.mock('../../../../../src/shadow/$subdir/\1'|g" "$testfile"
    sed -i '' -E "s|vi\.doMock\('./([^/]+\.mts)'|vi.doMock('../../../../../src/shadow/$subdir/\1'|g" "$testfile"
  done
done

echo "Done!"
