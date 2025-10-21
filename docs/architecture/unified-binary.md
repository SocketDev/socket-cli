# Unified Binary Architecture for SEA/Yao Packages

## Overview

Socket CLI provides multiple command-line tools (`socket`, `socket-npm`, `socket-npx`, etc.), but Node.js SEA and similar packaging tools like Yao only support creating a single executable from one entry point. This document explains how we solve this limitation using a unified binary architecture.

## The Challenge

Our package.json defines 5 different binaries:
```json
{
  "bin": {
    "socket": "bin/cli.js",          // Main CLI
    "socket-npm": "bin/npm-cli.js",  // npm wrapper
    "socket-npx": "bin/npx-cli.js",  // npx wrapper
    "socket-pnpm": "bin/pnpm-cli.js", // pnpm wrapper
    "socket-yarn": "bin/yarn-cli.js" // yarn wrapper
  }
}
```

SEA (Single Executable Application) limitation:
- Can only create ONE executable binary
- Cannot package multiple entry points
- Same limitation exists in Yao, pkg, nexe, etc.

## The Solution: Command Detection

We use a single unified binary that detects how it was invoked and routes to the appropriate behavior.

### How It Works

1. **Single Binary**: Build one executable named `socket`
2. **Symlinks/Copies**: Create symlinks (Unix) or copies (Windows) for other commands:
   - `socket-npm` → `socket`
   - `socket-npx` → `socket`
   - `socket-pnpm` → `socket`
   - `socket-yarn` → `socket`

3. **Command Detection**: The binary detects its invocation name:
   ```javascript
   const INVOKED_AS = path.basename(process.argv0)
   const COMMAND_MAP = {
     'socket': 'cli.js',
     'socket-npm': 'npm-cli.js',
     'socket-npx': 'npx-cli.js',
     // ...
   }
   ```

4. **Routing**: Based on the detected name, it spawns the appropriate CLI tool

## Implementation

### Bootstrap Code (`src/sea/bootstrap-unified.mts`)

The unified bootstrap:
1. Detects how it was invoked
2. Downloads the Socket CLI package if needed (first run)
3. Routes to the correct entry point based on invocation name
4. Spawns the appropriate command

### Build Process

```bash
# Build the unified SEA binary
node scripts/build-unified-sea.mjs

# This creates:
# dist/sea/socket        (main binary)
# dist/sea/socket-npm    (symlink/copy)
# dist/sea/socket-npx    (symlink/copy)
# dist/sea/socket-pnpm   (symlink/copy)
# dist/sea/socket-yarn   (symlink/copy)
```

### Platform Differences

**Unix/macOS:**
- Uses symlinks (lightweight, single binary on disk)
- All symlinks point to the same `socket` binary
- File system reports different `argv[0]` based on symlink name

**Windows:**
- Uses file copies (symlinks require admin privileges)
- Each `.exe` is a full copy but same internal logic
- Process name detection works the same way

## Distribution

When distributing the SEA package:

### Option 1: Distribute All Files
```
socket-cli-v1.0.0-darwin-x64.tar.gz
├── socket
├── socket-npm -> socket
├── socket-npx -> socket
├── socket-pnpm -> socket
└── socket-yarn -> socket
```

### Option 2: Single Binary + Install Script
```
socket-cli-v1.0.0-darwin-x64.tar.gz
├── socket
└── install.sh  # Creates symlinks during installation
```

### Option 3: Package Manager Integration
```bash
# npm package could create symlinks in postinstall
npm install -g @socketsecurity/cli-binary
```

## Testing

Test that command routing works:

```bash
# Test main CLI
./socket --version

# Test npm wrapper (should intercept npm commands)
./socket-npm install express

# Test npx wrapper
./socket-npx create-react-app

# Test pnpm wrapper
./socket-pnpm install

# Test yarn wrapper
./socket-yarn add lodash
```

## Benefits

1. **Single Binary**: Only one large binary to build and distribute
2. **Smaller Size**: Symlinks add no disk space
3. **Consistent Updates**: Update one binary, all commands updated
4. **Cross-Platform**: Works on Windows, macOS, Linux
5. **User Transparent**: Users interact with expected command names

## Compatibility with Yao

This approach works identically with Yao or other Node.js packagers:

```javascript
// yao.config.js
module.exports = {
  entry: 'src/sea/bootstrap-unified.js',
  output: 'socket',
  // ... other config
}
```

Then create symlinks/copies for the other commands after Yao builds the binary.

## Future Enhancements

### Subcommand Detection
Could also support subcommand style:
```bash
socket cli ...   # Main CLI
socket npm ...   # npm wrapper
socket npx ...   # npx wrapper
```

### Multi-Binary Builds
For environments where symlinks aren't viable, could build separate binaries:
```javascript
// Build each binary with environment variable
process.env.SOCKET_BINARY_MODE = 'npm'
// Then in bootstrap, check this instead of argv[0]
```

### Smart Installer
Create an installer that:
1. Detects the platform
2. Creates appropriate symlinks or copies
3. Adds to PATH
4. Handles updates

## Troubleshooting

### Issue: Command not routing correctly

Check the detected binary name:
```bash
SOCKET_DEBUG=1 ./socket-npm --version
# Should show: Detected command: socket-npm
```

### Issue: Symlinks not working on Windows

Windows requires admin privileges for symlinks. The build script automatically falls back to file copies on Windows.

### Issue: Binary too large

Since we're shipping one binary for all commands, size matters:
- Use tree-shaking in build
- Minimize bootstrap code
- Consider lazy-loading command-specific code

## Conclusion

This unified binary architecture allows us to maintain the expected multi-command interface while working within the constraints of single-executable packaging tools like SEA and Yao. It provides a clean, maintainable solution that works across all platforms.