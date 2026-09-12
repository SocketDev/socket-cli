# Socket CLI build guide

The repository builds one npm package: `@socketsecurity/cli`, on the 2.x prerelease line.

## Build

Use the Node version in `.node-version` and the package-manager range in `package.json`.

```sh
pnpm install
pnpm run build
pnpm run s --help
```

The build writes the Node CLI and command wrappers to `dist/`. The root manifest supplies the package identity and version.

## Source layout

- `src/command/` provides argument parsing, help, aliases, and dispatch.
- `src/core/` contains implementations shared by command entries.
- `scripts/repo/cli-build/` builds and tests the CLI.
- `scripts/repo/build-infra/` contains build helpers.
- `.config/repo/cli/` contains product build and test configurations.

## Verification

```sh
pnpm run type:cli
pnpm run test:unit --all
pnpm run test:integration
pnpm run check:cli-package
```

Product unit tests live in `test/unit/`. Integration tests live in `test/integration/`. Repository tooling tests live in `test/repo/`.

`pnpm run cover:cli` measures product coverage. Firewall coverage includes its core implementation and CA command.

## Build cache

`pnpm run clean:cache` removes this repository's CLI cache. `pnpm run build --force` rebuilds the CLI.

## Distribution

The root manifest defines the package files and executable names. The `socket-npm`, `socket-npx`, `socket-pnpm`, and `socket-yarn` wrappers select the command mode before loading the CLI.

Publishing uses the fleet publishing workflow. Local builds do not publish a package or create a release.
