# @socketsecurity/cli-with-sentry

Socket CLI with integrated Sentry telemetry for enhanced error reporting and monitoring.

## Overview

This package provides the same functionality as `@socketsecurity/cli` with additional Sentry integration for:
- Automatic error tracking and reporting
- Performance monitoring
- User feedback collection
- Release tracking

## Installation

```bash
npm install -g @socketsecurity/cli-with-sentry
```

## Usage

Use exactly the same as the standard Socket CLI:

```bash
socket scan
socket npm install express
socket optimize
```

## Telemetry

This package includes Sentry telemetry to help improve Socket CLI. The following data is collected:

- Error messages and stack traces
- Performance metrics
- CLI command usage (anonymized)
- Node.js and OS version information

**No sensitive data** (API tokens, file contents, package names) is collected.

## Differences from @socketsecurity/cli

The only difference is the inclusion of Sentry SDK and automatic error reporting. All CLI functionality remains identical.

## Documentation

See main Socket CLI documentation: https://docs.socket.dev/

## License

MIT
