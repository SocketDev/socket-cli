# CLI architecture

The root package is `@socketsecurity/cli`. It builds one Node CLI distribution.

## Commands and implementations

`src/command/` owns CLI arguments, help, aliases, and dispatch. Rich implementations live under `src/core/`, so several commands can call the same implementation.

The local firewall implementation lives in `src/core/firewall/`. Optimize implementation modules live in `src/core/optimize/`. External source references live under `upstream/` and are declared in `.gitmodules`.

## Tooling

Build entrypoints live in `scripts/repo/cli-build/`. Shared build helpers live in `scripts/repo/build-infra/`. Product configurations live in `.config/repo/cli/`.

## Tests

Product unit tests live in `test/unit/`. Integration tests use `test/integration/`; real package-manager firewall tests have a dedicated `firewall/` directory. Repository tooling tests remain under `test/repo/`.
