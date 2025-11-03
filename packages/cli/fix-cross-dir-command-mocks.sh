#!/bin/bash
# Fix cross-directory mocks in command tests.
# Pattern: ../otherdir/file.mts -> ../../../../../src/commands/otherdir/file.mts

for testfile in test/unit/commands/*/*.test.mts; do
  if [ ! -f "$testfile" ]; then continue; fi
  
  # Fix: ../(other-command-dir)/file.mts -> ../../../../../src/commands/(other-command-dir)/file.mts
  sed -i '' -E "s|vi\.mock\('\.\./([a-z-]+)/([^']+)'\)|vi.mock('../../../../../src/commands/\1/\2')|g" "$testfile"
  
  # Fix dynamic imports too
  sed -i '' -E "s|import\('\.\./([a-z-]+)/([^']+)'\)|import('../../../../../src/commands/\1/\2')|g" "$testfile"
  
  # Fix static imports
  sed -i '' -E "s|from '\.\./([a-z-]+)/([^']+)'|from '../../../../../src/commands/\1/\2'|g" "$testfile"
done

echo "Done fixing cross-directory command mocks!"
