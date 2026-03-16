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

## API Documentation

This package provides Node.js bindings to the native [iocraft](https://github.com/ccbrown/iocraft) library. The API is similar to the official iocraft API with these differences:

- **Import**: Use `import iocraft from '@socketaddon/iocraft'` instead of Rust imports
- **Function names**: Use camelCase (`printComponent`, `renderToString`) instead of snake_case
- **Property names**: Node properties use snake_case (e.g., `flex_direction`, `padding_left`) to match the native API

For comprehensive API documentation, see the [official iocraft documentation](https://github.com/ccbrown/iocraft#readme).

## License

MIT
