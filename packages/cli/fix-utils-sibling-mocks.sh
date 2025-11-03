#!/bin/bash

# Fix sibling directory mocks in test/unit/utils subdirectories
# Pattern: vi.mock('../sibling/file.mts' -> vi.mock('../../../../../src/utils/sibling/file.mts'

# For files in test/unit/utils/*/
for testfile in test/unit/utils/*/*.test.mts; do
  if [ ! -f "$testfile" ]; then continue; fi
  
  # Fix: ../otherdir/file.mts -> ../../../../../src/utils/otherdir/file.mts
  sed -i '' -E "s|vi\.mock\('\.\./([a-z-]+)/([^']+)'\)|vi.mock('../../../../../src/utils/\1/\2')|g" "$testfile"
  
  # Fix: ../../constants/ -> ../../../../../src/constants/
  sed -i '' -E "s|vi\.mock\('\.\./\.\./constants/([^']+)'\)|vi.mock('../../../../../src/constants/\1')|g" "$testfile"
  
  # Fix: ../../meow.mts etc (root src files)
  sed -i '' -E "s|vi\.mock\('\.\./\.\./([^/]+\.mts)'\)|vi.mock('../../../../../src/\1')|g" "$testfile"
  
  # Fix dynamic imports too
  sed -i '' -E "s|await import\('\.\./([a-z-]+)/([^']+)'\)|await import('../../../../../src/utils/\1/\2')|g" "$testfile"
done

echo "Done!"
