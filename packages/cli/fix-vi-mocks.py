#!/usr/bin/env python3
"""
Fix vitest mock patterns in test files.
Converts vi.fn() calls in vi.mock() to use vi.hoisted() pattern.
"""

import re
import sys
from pathlib import Path

def fix_test_file(file_path):
    """Fix mock patterns in a single test file."""
    print(f"Processing: {file_path}")

    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content

    # Find all vi.mock calls that use vi.fn()
    # Pattern: vi.mock('path', () => ({ fnName: vi.fn() }))
    mock_pattern = r"vi\.mock\(['\"]([^'\"]+)['\"]\s*,\s*\(\)\s*=>\s*\(\{([^}]+)\}\)\)"

    mocks_to_hoist = []

    for match in re.finditer(mock_pattern, content):
        module_path = match.group(1)
        mock_body = match.group(2)

        # Find functions defined as vi.fn()
        fn_pattern = r'(\w+):\s*vi\.fn\(([^)]*)\)'

        for fn_match in re.finditer(fn_pattern, mock_body):
            fn_name = fn_match.group(1)
            fn_args = fn_match.group(2).strip()

            # Create mock variable name
            mock_var_name = f"mock{fn_name[0].upper()}{fn_name[1:]}"

            mocks_to_hoist.append({
                'fn_name': fn_name,
                'mock_var_name': mock_var_name,
                'fn_args': fn_args,
                'module_path': module_path
            })

    if not mocks_to_hoist:
        print(f"  No vi.fn() mocks found to convert in {file_path}")
        return False

    # Create hoisted mock declarations
    hoisted_declarations = []
    for mock in mocks_to_hoist:
        if mock['fn_args']:
            hoisted_declarations.append(
                f"const {mock['mock_var_name']} = vi.hoisted(() => vi.fn({mock['fn_args']}))"
            )
        else:
            hoisted_declarations.append(
                f"const {mock['mock_var_name']} = vi.hoisted(() => vi.fn())"
            )

    # Find the position of the first vi.mock() call
    first_mock_pos = content.find('vi.mock(')
    if first_mock_pos == -1:
        print(f"  No vi.mock() calls found")
        return False

    # Insert hoisted declarations before first vi.mock()
    hoisted_block = '\n'.join(hoisted_declarations) + '\n\n'
    content = content[:first_mock_pos] + hoisted_block + content[first_mock_pos:]

    # Replace vi.fn() in vi.mock() calls with hoisted mock references
    for mock in mocks_to_hoist:
        # Replace "fnName: vi.fn()" with "fnName: mockFnName"
        pattern = rf"({mock['fn_name']}):\s*vi\.fn\([^)]*\)"
        replacement = rf"\1: {mock['mock_var_name']}"
        content = re.sub(pattern, replacement, content)

    # Replace vi.mocked(fnName) with mockFnName
    for mock in mocks_to_hoist:
        pattern = rf"vi\.mocked\({mock['fn_name']}\)"
        content = re.sub(pattern, mock['mock_var_name'], content)

    # Replace fnName.mockXxx() with mockFnName.mockXxx()
    # But only when preceded by whitespace or ( to avoid replacing in imports
    for mock in mocks_to_hoist:
        # Pattern: word boundary or whitespace, then fnName.mock
        pattern = rf"(?<=\s){mock['fn_name']}\.mock"
        replacement = f"{mock['mock_var_name']}.mock"
        content = re.sub(pattern, replacement, content)

        # Also at start of line
        pattern = rf"^{mock['fn_name']}\.mock"
        replacement = f"{mock['mock_var_name']}.mock"
        content = re.sub(pattern, replacement, content, flags=re.MULTILINE)

    if content != original_content:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  ✓ Fixed {file_path}")
        return True
    else:
        print(f"  No changes made to {file_path}")
        return False

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 fix-vi-mocks.py <test-file-1> [test-file-2] ...")
        sys.exit(1)

    files = sys.argv[1:]
    fixed_count = 0

    for file_path in files:
        try:
            if fix_test_file(file_path):
                fixed_count += 1
        except Exception as e:
            print(f"  Error processing {file_path}: {e}")

    print(f"\nFixed {fixed_count} out of {len(files)} files")

if __name__ == '__main__':
    main()
