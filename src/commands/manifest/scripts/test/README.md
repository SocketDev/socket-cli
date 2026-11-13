# Workspace-enumeration compatibility tests

These exercise the build-tool scripts `socket manifest setup --dynamic-sbom-inference`
still runs itself to list a build's projects without resolving dependencies:
`socket-workspaces.init.gradle`, `socket-workspaces.plugin.scala`, the Maven
extension's `CoanaWorkspacesLifecycleParticipant` and the dotnet tool's
`--workspaces`/`--members` modes. Coana generates the Socket facts themselves.

Each ecosystem has two suites: `smoke-test-workspaces.sh` asserts the project
records, `smoke-test-exclude-base.sh` scan-root-relative `--exclude-paths`.

## Run locally, on demand

There is no CI for this matrix: SocketDev's org action allowlist forbids
`actions/setup-java` and `sbt/setup-sbt`.

```sh
src/commands/manifest/scripts/test/run-compat.sh [dotnet|gradle|sbt|maven|all]
```

- Point `JDK8` / `JDK11` / `JDK17` / `JDK21` at JDK homes to use the right one
  per row; otherwise the current `java` is used. The sbt rows need the `sbt`
  launcher on `PATH`.
- Gradle and Maven distributions are expected unzipped under
  `${SOCKET_COMPAT_CACHE:-${TMPDIR:-/tmp}/socket-manifest-compat}`; the runner
  prints the archive URL for any that is missing.
- dotnet rows are SDK versions, each pinned with a `global.json`; install them
  side by side under `$SOCKET_COMPAT_CACHE/dotnet` with `dotnet-install.sh`, and
  build the tool first (`pnpm run build:dotnet-tool && pnpm build:dist:src`).
