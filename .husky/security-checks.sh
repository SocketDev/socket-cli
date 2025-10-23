#!/bin/bash
# Socket Security Checks
# Prevents committing sensitive data and common mistakes.

set -e

# Colors for output.
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

# Allowed public API key (used in socket-lib and across all Socket repos).
# This is Socket's official public test API key - safe to commit.
# NOTE: This value is intentionally identical across all Socket repos.
ALLOWED_PUBLIC_KEY="sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api"

echo "${GREEN}Running Socket Security checks...${NC}"

# Get list of staged files.
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
  echo "${GREEN}✓ No files to check${NC}"
  exit 0
fi

ERRORS=0

# Check for .DS_Store files.
echo "Checking for .DS_Store files..."
if echo "$STAGED_FILES" | grep -q '\.DS_Store'; then
  echo "${RED}✗ ERROR: .DS_Store file detected!${NC}"
  echo "$STAGED_FILES" | grep '\.DS_Store'
  ERRORS=$((ERRORS + 1))
fi

# Check for log files.
echo "Checking for log files..."
if echo "$STAGED_FILES" | grep -E '\.log$' | grep -v 'test.*\.log'; then
  echo "${RED}✗ ERROR: Log file detected!${NC}"
  echo "$STAGED_FILES" | grep -E '\.log$' | grep -v 'test.*\.log'
  ERRORS=$((ERRORS + 1))
fi

# Check for .env files.
echo "Checking for .env files..."
if echo "$STAGED_FILES" | grep -E '^\.env(\.local)?$'; then
  echo "${RED}✗ ERROR: .env or .env.local file detected!${NC}"
  echo "$STAGED_FILES" | grep -E '^\.env(\.local)?$'
  echo "These files should never be committed. Use .env.example instead."
  ERRORS=$((ERRORS + 1))
fi

# Check for hardcoded user paths (generic detection).
echo "Checking for hardcoded personal paths..."
for file in $STAGED_FILES; do
  if [ -f "$file" ]; then
    # Skip test files and hook scripts.
    if echo "$file" | grep -qE '\.(test|spec)\.|/test/|/tests/|fixtures/|\.git-hooks/|\.husky/'; then
      continue
    fi

    # Check for common user path patterns.
    if grep -E '(/Users/[^/\s]+/|/home/[^/\s]+/|C:\\Users\\[^\\]+\\)' "$file" 2>/dev/null | grep -q .; then
      echo "${RED}✗ ERROR: Hardcoded personal path found in: $file${NC}"
      grep -n -E '(/Users/[^/\s]+/|/home/[^/\s]+/|C:\\Users\\[^\\]+\\)' "$file" | head -3
      echo "Replace with relative paths or environment variables."
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

# Check for Socket API keys.
echo "Checking for API keys..."
for file in $STAGED_FILES; do
  if [ -f "$file" ]; then
    if grep -E 'sktsec_[a-zA-Z0-9_-]+' "$file" 2>/dev/null | grep -v "$ALLOWED_PUBLIC_KEY" | grep -v 'your_api_key_here' | grep -v 'SOCKET_SECURITY_API_KEY=' | grep -v 'fake-token' | grep -v 'test-token' | grep -q .; then
      echo "${YELLOW}⚠ WARNING: Potential API key found in: $file${NC}"
      grep -n 'sktsec_' "$file" | grep -v "$ALLOWED_PUBLIC_KEY" | grep -v 'your_api_key_here' | grep -v 'fake-token' | grep -v 'test-token' | head -3
      echo "If this is a real API key, DO NOT COMMIT IT."
    fi
  fi
done

# Check for common secret patterns.
echo "Checking for potential secrets..."
for file in $STAGED_FILES; do
  if [ -f "$file" ]; then
    # Skip test files, example files, and hook scripts.
    if echo "$file" | grep -qE '\.(test|spec)\.(m?[jt]s|tsx?)$|\.example$|/test/|/tests/|fixtures/|\.git-hooks/|\.husky/'; then
      continue
    fi

    # Check for AWS keys.
    if grep -iE '(aws_access_key|aws_secret|AKIA[0-9A-Z]{16})' "$file" 2>/dev/null | grep -q .; then
      echo "${RED}✗ ERROR: Potential AWS credentials found in: $file${NC}"
      grep -n -iE '(aws_access_key|aws_secret|AKIA[0-9A-Z]{16})' "$file" | head -3
      ERRORS=$((ERRORS + 1))
    fi

    # Check for GitHub tokens.
    if grep -E 'gh[ps]_[a-zA-Z0-9]{36}' "$file" 2>/dev/null | grep -q .; then
      echo "${RED}✗ ERROR: Potential GitHub token found in: $file${NC}"
      grep -n -E 'gh[ps]_[a-zA-Z0-9]{36}' "$file" | head -3
      ERRORS=$((ERRORS + 1))
    fi

    # Check for private keys.
    if grep -E '-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----' "$file" 2>/dev/null | grep -q .; then
      echo "${RED}✗ ERROR: Private key found in: $file${NC}"
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "${RED}✗ Security check failed with $ERRORS error(s).${NC}"
  echo "Fix the issues above and try again."
  exit 1
fi

echo "${GREEN}✓ All security checks passed!${NC}"
exit 0
