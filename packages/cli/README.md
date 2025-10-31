# @socketsecurity/cli

[![Socket Badge](https://socket.dev/api/badge/npm/package/@socketsecurity/cli)](https://socket.dev/npm/package/@socketsecurity/cli)
[![npm version](https://img.shields.io/npm/v/@socketsecurity/cli.svg)](https://www.npmjs.com/package/@socketsecurity/cli)
[![CI](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/SocketDev/socket-cli/actions/workflows/ci.yml)

Full Socket CLI implementation for supply chain security analysis.

## Installation

```bash
npm install -g @socketsecurity/cli
```

Or use via the thin `socket` wrapper:

```bash
npm install -g socket
```

## Usage

```bash
socket --help
socket scan
socket npm install express
socket optimize
```

## Features

- **Security Scanning**: Analyze npm packages for supply chain risks
- **CI/CD Integration**: Block risky dependencies in your pipeline
- **Package Optimization**: Apply Socket registry overrides for safer alternatives
- **Organization Management**: Manage Socket.dev organizations and repositories
- **Wrapper Commands**: Secure alternatives to `npm`, `npx`, `pnpm`, `yarn`

## Documentation

Visit [https://docs.socket.dev/](https://docs.socket.dev/) for full documentation.

## License

MIT
