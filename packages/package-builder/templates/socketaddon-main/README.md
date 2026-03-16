# @socketaddon/iocraft

Node.js bindings for [iocraft](https://github.com/ccbrown/iocraft) - a Rust-based terminal user interface (TUI) library.

## Installation

```bash
npm install @socketaddon/iocraft
```

The package will automatically install the correct native binary for your platform.

## Supported Platforms

- **macOS**: ARM64 (Apple Silicon), x64 (Intel)
- **Linux**: ARM64, x64 (both glibc and musl)
- **Windows**: ARM64, x64

## Usage

```javascript
import iocraft from '@socketaddon/iocraft'

// Create a text element
const textNode = iocraft.text('Hello from iocraft!')

// Create a view with the text element
const element = iocraft.view([textNode])

// Print the component to stdout
iocraft.printComponent(element)

// Or render to a string
const output = iocraft.renderToString(element)
console.log(output)
```

## How It Works

This package uses npm's `optionalDependencies` to install only the native binary matching your platform:

- Main package: `@socketaddon/iocraft` (platform detection and loading)
- Platform packages: `@socketaddon/iocraft-{platform}-{arch}` (native `.node` binaries)

When you `import` the main package, it automatically detects your platform and loads the correct native addon.

## Development

These packages are published from the [socket-cli](https://github.com/SocketDev/socket-cli) repository using template-based generation.

Native binaries are built in the [socket-btm](https://github.com/SocketDev/socket-btm) repository and downloaded during publish.

## License

MIT
