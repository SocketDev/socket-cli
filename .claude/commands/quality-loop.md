# quality-loop

Run comprehensive quality scan and automatic issue fixing loop for socket-cli.

## What it does

Executes an iterative quality improvement cycle:

1. Updates dependencies
2. Cleans up repository (removes junk files)
3. Validates code structure
4. Runs specialized quality scans
5. Fixes ALL issues found
6. Commits fixes
7. Repeats until zero issues or 5 iterations

## Usage

```bash
/quality-loop
```

## Scan types

- **critical** - Crashes, security, data corruption, auth handling
- **logic** - Algorithm errors, edge cases, validation bugs
- **cache** - Config/token caching correctness
- **workflow** - Build scripts, CI/CD, cross-platform compatibility
- **security** - GitHub Actions security, credential handling
- **documentation** - Command examples, flag accuracy, API docs

## Process

The skill will:
- Ask which scans to run (default: all)
- Run dependency updates
- Clean junk files with confirmation
- Execute selected scans sequentially
- Aggregate and deduplicate findings
- Fix issues and commit changes
- Repeat until clean or max iterations

## Exit conditions

- ✅ Success: Zero issues found
- ⏹️ Stop: After 5 iterations (prevent infinite loops)

## Notes

- Commits fixes with proper git messages
- Skips no issues (fixes architectural problems too)
- Runs tests after each iteration
- Reports progress and statistics

Use this command to maintain high code quality standards across socket-cli.
