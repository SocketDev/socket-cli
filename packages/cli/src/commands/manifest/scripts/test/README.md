# JVM manifest-script compatibility tests

These exercise the bundled build-tool scripts — the Gradle init script
(`socket-facts.init.gradle`), the sbt plugin (`socket-facts.plugin.scala`), and
the Maven extension (`maven-extension/`) — against a matrix of build-tool
versions, asserting they still emit the expected line-protocol records.

## Run locally, on demand

There is **no CI for this matrix**: SocketDev's org action allowlist forbids
`actions/setup-java` and `sbt/setup-sbt`, so the build-tool matrix has no GitHub
Actions home. Run it locally whenever you change one of the scripts or the
Maven extension:

```sh
src/commands/manifest/scripts/test/run-compat.sh [gradle|sbt|maven|all]
```

The matrix needs several JDKs. Point `JDK8` / `JDK11` / `JDK17` / `JDK21` at JDK
homes to use the right one per row; otherwise the current `java` is used. The
sbt rows also need the `sbt` launcher on `PATH`.

The runner downloads the build-tool distributions and invokes the per-ecosystem
`smoke-test.sh`. The unit-level assembler/sidecar behavior is covered separately
by the `*.test.mts` unit tests.
