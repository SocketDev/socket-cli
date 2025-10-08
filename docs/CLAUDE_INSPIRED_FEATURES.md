# Claude CLI-Inspired Features

This document describes the new features added to Socket CLI inspired by modern CLI experiences like Claude CLI.

## ✨ New Features

### 1. Natural Language Command Interface (`socket ai`)

Use natural language to describe what you want to do, and the AI will translate it to the appropriate Socket CLI command.

```bash
# Examples
socket ai "scan this project for vulnerabilities"
socket ai "fix all critical issues"
socket ai "show me production vulnerabilities"
socket ai "is express safe to use"
socket ai "optimize my dependencies"

# Execute directly with -e flag
socket ai "scan for vulnerabilities" -e
```

The AI understands various intents:
- Scanning and security checks
- Fixing vulnerabilities
- Package optimization
- Repository management
- Configuration

### 2. Interactive Fix Mode

Guided vulnerability remediation with intelligent grouping and safe auto-fix options.

```bash
# Start interactive fix mode
socket fix interactive

# Auto-apply safe fixes only
socket fix interactive --auto

# Preview without applying
socket fix interactive --dry-run

# Filter by severity
socket fix interactive --severity=high
```

Features:
- Groups vulnerabilities by severity, package, or type
- Shows breaking change warnings
- Identifies dependent packages
- Safe auto-fix for non-breaking updates
- Detailed explanations for each fix

### 3. Project Context Awareness

Automatically detects your project setup and provides tailored suggestions.

```bash
# Detects:
- Package manager (npm/yarn/pnpm)
- Framework (React, Vue, Angular, Next.js, etc)
- Monorepo structure
- Lock file presence
```

Provides contextual help:
- Suggests pnpm --recursive for pnpm monorepos
- Recommends --prod flag for production builds
- Warns about missing lock files
- Framework-specific security recommendations

### 4. Rich Progress Indicators

Beautiful terminal UI for long-running operations.

```typescript
// Multi-progress bars for parallel operations
const progress = new MultiProgress()
progress.addTask('scan-1', 'Scanning package.json', 100)
progress.addTask('scan-2', 'Analyzing dependencies', 200)

// Spinners with dynamic messages
const spinner = new Spinner('Analyzing project...')
spinner.update('Found 150 dependencies')
spinner.succeed('Analysis complete')

// File progress tracking
const fileProgress = new FileProgress(files, 'Scanning')
```

### 5. Intelligent Offline Caching

Work offline with cached data and smart TTL management.

```bash
# Force offline mode
SOCKET_OFFLINE=1 socket scan view

# Use cache with automatic refresh
socket scan create  # Caches results automatically

# Clear cache
socket cache clear

# Warm cache for common operations
socket cache warm
```

Features:
- TTL-based cache expiration
- Stale-while-revalidate pattern
- Namespace-based organization
- Automatic fallback to cache on network errors
- Cache statistics and management

## 🎯 Usage Examples

### Natural Language Workflow

```bash
# Ask what you want in plain English
socket ai "check if my production dependencies are safe"
# → Translates to: socket scan create . --prod

# Get help understanding commands
socket ai "what does scan reach do"
# → Shows: socket scan reach --help
```

### Interactive Security Fix

```bash
# Start interactive mode
socket fix interactive

# For each vulnerability:
# [y] Apply fix
# [n] Skip
# [d] Show details
# [a] Apply all safe fixes
# [q] Quit

# The tool shows:
# - Severity indicators (🔴 critical, 🟠 high, 🟡 medium)
# - Breaking change warnings
# - Affected dependent packages
# - Suggested version updates
```

### Context-Aware Suggestions

When you run commands, Socket CLI now:
1. Detects your project type automatically
2. Shows relevant suggestions
3. Warns about configuration issues
4. Provides framework-specific advice

Example output:
```
✓ Detected pnpm project using next (monorepo)

💡 Suggestions based on your project:
   • Use `socket pnpm --recursive` to scan all workspaces
   • Consider using --prod to exclude dev dependencies from production scans

📦 Detected 5 workspace(s):
   • packages/core
   • packages/ui
   • apps/web
   ... and 2 more
```

## 🚀 Performance Improvements

### Caching Strategy

- **Hot paths cached**: Common API calls cached for 1 hour
- **Offline fallback**: Use stale cache when network fails
- **Smart invalidation**: Refresh on explicit user action
- **Background warming**: Pre-fetch common data

### Progress Tracking

- **Non-blocking**: Progress updates don't slow operations
- **Parallel tracking**: Monitor multiple operations simultaneously
- **Smart throttling**: Update frequency adjusted to terminal capabilities

## 🔧 Configuration

### Environment Variables

```bash
# Enable offline mode
export SOCKET_OFFLINE=1

# Show cache hits (verbose mode)
export SOCKET_VERBOSE=1

# Debug natural language parsing
export DEBUG=socket:ai
```

### Cache Management

```bash
# View cache statistics
socket cache stats

# Clear specific namespace
socket cache clear --namespace=scans

# Clear everything
socket cache clear --all
```

## 🎨 Design Philosophy

These features follow key principles:

1. **Progressive Enhancement**: Features enhance but don't replace core functionality
2. **Offline First**: Always work, even without internet
3. **Context Aware**: Understand and adapt to the user's project
4. **Human Friendly**: Natural language and clear visual feedback
5. **Fast by Default**: Cache aggressively, compute minimally

## 🔜 Future Enhancements

Potential additions based on this foundation:

1. **Command Chaining**: `socket scan && socket fix --auto && socket test`
2. **Watch Mode**: `socket watch` - Auto-scan on file changes
3. **Smart Diffing**: Show only what changed between scans
4. **Team Profiles**: Shared configuration and policies
5. **Integration Hooks**: Pre/post command scripts

## 📝 Notes

- The AI command interface uses pattern matching, not actual AI (for now)
- Cache is stored in `~/.socket/_cacache`
- Progress indicators automatically disable for non-TTY outputs
- All features respect `--json` flag for automation