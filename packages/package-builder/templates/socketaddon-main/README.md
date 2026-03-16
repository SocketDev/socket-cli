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

// Print the component to stdout (camelCase or snake_case - both work!)
iocraft.printComponent(element)

// Or render to a string
const output = iocraft.renderToString(element)
console.log(output)
```

## API Documentation

This package provides Node.js bindings to the [iocraft](https://github.com/ccbrown/iocraft) Rust library. Both camelCase and snake_case naming conventions are supported:

- **Import**: Use `import iocraft from '@socketaddon/iocraft'` instead of Rust imports
- **Functions**: Use either camelCase (`printComponent`, `renderToString`) or snake_case (`print_component`, `render_to_string`)
- **Properties**: Use either camelCase (`flexDirection`, `paddingLeft`) or snake_case (`flex_direction`, `padding_left`)

For comprehensive API documentation, see the [official iocraft documentation](https://github.com/ccbrown/iocraft#readme).
