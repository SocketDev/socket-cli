# JVM manifest-script compatibility tests

These exercise the bundled build-tool scripts — the Gradle init script
(`socket-facts.init.gradle`), the sbt plugin (`socket-facts.plugin.scala`), the
Maven extension (`maven-extension/`), and each ecosystem's lightweight
workspace-enumeration sibling (`socket-workspaces.init.gradle`,
`socket-workspaces.plugin.scala`, `CoanaWorkspacesLifecycleParticipant`) —
against a matrix of build-tool versions, asserting they still emit the
expected line-protocol records.

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

## Stub dependencies

All three fixtures declare their dependencies as stub artifacts — empty jars plus
generated poms — that `make-stub-repo.sh` writes into a file-based Maven repo at
test time. The fixtures only need the *shape* of a dependency graph (a prod dep, a
test dep, a transitive), never the code, so a stub is behaviourally identical here
and can never age into a CVE alert or a version bump. The generated repos are
gitignored; nothing binary is committed.

Each build tool still fetches its own closure — Maven's plugins, sbt's
scala-library, the Gradle distribution — from the network, so these fixtures are
not "fully offline"; they simply declare no third-party dependencies of their own.
Gradle is the exception: it also passes `--offline` and resolves everything it
needs for the smoke test from the stub repo.

## Caches

No suite reads or writes the developer's own caches. Maven gets its local
repository from `-Dmaven.repo.local`, Gradle its user home from `-g`, and sbt its
Ivy home from `-Dsbt.ivy.home` plus `COURSIER_CACHE`, all under one root that
`compat-cache.sh` resolves:

```
${SOCKET_COMPAT_CACHE:-${TMPDIR:-/tmp}/socket-manifest-compat}
```

That root is stable, so each tool's own closure is downloaded once and reused; the
first run after clearing it pays for the download. The *stub* artifacts are evicted
from it before every run, so a run can never pass on a stale copy of the thing
under test. Set `SOCKET_COMPAT_CACHE` to a fresh `mktemp -d` for a completely cold
run.
