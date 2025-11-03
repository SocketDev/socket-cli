#!/bin/bash

# Fix imports missing intermediate 'utils' directory
patterns=(
  "s|/purl/|/utils/purl/|g"
  "s|/pnpm/|/utils/pnpm/|g"
  "s|/socket/|/utils/socket/|g"
  "s|/terminal/|/utils/terminal/|g"
  "s|/fs/|/utils/fs/|g"
  "s|/coana/|/utils/coana/|g"
  "s|/ecosystem/|/utils/ecosystem/|g"
  "s|/error/|/utils/error/|g"
  "s|/data/|/utils/data/|g"
  "s|/cli/|/utils/cli/|g"
  "s|/git/|/utils/git/|g"
  "s|/npm/|/utils/npm/|g"
  "s|/yarn/|/utils/yarn/|g"
  "s|/arborist/|/shadow/npm/arborist/|g"
  "s|/bin\.mts|/shadow/npm/bin.mts|g"
  "s|/install\.mts|/shadow/npm/install.mts|g"
  "s|/paths\.mts'|/shadow/npm/paths.mts'|g"
  "s|/resolve-binary\.|/utils/dlx/resolve-binary.|g"
  "s|/polyfills/|/polyfills/|g"
)

for f in test/unit/**/*.test.mts; do
  [ ! -f "$f" ] && continue
  for pattern in "${patterns[@]}"; do
    sed -i '' -E "$pattern" "$f"
  done
done

echo "Fixed missing intermediate directories"
