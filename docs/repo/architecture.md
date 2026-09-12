# CLI architecture

The root package is `@socketsecurity/cli`. It builds one Node CLI distribution.

## Commands and implementations

`src/command/` owns CLI arguments, help, aliases, and dispatch. Rich implementations live under `src/core/`, so several commands can call the same implementation.

The firewall, optimize, and MCP implementations live in `src/core/firewall/`, `src/core/optimize/`, and `src/core/mcp/`. The binary integration for Socket Patch lives in `src/core/patch/`.

`src/core/sdxgen/` loads the bundled manifest generator when requested. The build compiles pinned TypeScript from `upstream/sdxgen/`. Its JavaScript, Acorn WebAssembly parser, and Gradle script ship under `dist/sdxgen/` in the same published package. Project tool execution requires `--execute-tools`.

External source references live under `upstream/` and are declared in `.gitmodules`.

## Tooling

Build entrypoints live in `scripts/repo/cli-build/`. Shared build helpers live in `scripts/repo/build-infra/`. Product configurations live in `.config/repo/cli/`.

## Tests

Product unit tests live in `test/unit/`. Integration tests use `test/integration/`; real package-manager firewall tests have a dedicated `firewall/` directory. Repository tooling tests remain under `test/repo/`.
