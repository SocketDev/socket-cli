#!/usr/bin/env bash
set -euo pipefail

# Read the staged manifest and attributes so unstaged fixes cannot mask a bad commit.
git show :package.json |
  jq -je '.bin | (if type == "string" then [.] else values end)[] | ., "\u0000"' |
  git check-attr --cached -z --stdin eol |
  while IFS= read -r -d '' file && IFS= read -r -d '' attribute && IFS= read -r -d '' value; do
    if [[ "$value" != lf ]]; then
      echo "$file: expected $attribute=lf for its shebang, got $attribute=$value. Check .gitattributes." >&2
      exit 1
    fi
  done
