# CLI architecture

The root package is `@socketsecurity/cli`. It builds one Node CLI distribution.

## Commands and implementations

`src/command/` owns CLI arguments, help, aliases, and dispatch. Rich implementations live under `src/core/`, so several commands can call the same implementation.

The firewall, optimize, and MCP implementations live in `src/core/firewall/`, `src/core/optimize/`, and `src/core/mcp/`. The binary integration for Socket Patch lives in `src/core/patch/`.

`src/core/sdxgen/` calls the installed sdxgen API. The build bundles its JavaScript and copies its Acorn and Gradle runtime assets. Project tool execution requires `--execute-tools`.

`src/core/scanner-patterns/` runs executable rules from `@socketsecurity/scan-patterns`. The result identifies rules that this scanner cannot execute.

External source references live under `upstream/` and are declared in `.gitmodules`.

## Tooling

Build entrypoints live in `scripts/repo/cli-build/`. Shared build helpers live in `scripts/repo/build-infra/`. Product configurations live in `.config/repo/cli/`.

## Tests

Product unit tests live in `test/unit/`. Integration tests use `test/integration/`; real package-manager firewall tests have a dedicated `firewall/` directory. Repository tooling tests remain under `test/repo/`.
