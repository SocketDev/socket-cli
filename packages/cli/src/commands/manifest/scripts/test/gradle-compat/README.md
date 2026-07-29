# Gradle-version compatibility smoke test

`socket-facts.init.gradle` must run across a very wide Gradle range. It uses several
reflective shims so it degrades gracefully on Gradle older than its modern target:

- `socketProp` (hasProperty/property) instead of `Project.findProperty` (Gradle 2.13+)
- a reflective `isResolvable` probe instead of `Configuration.isCanBeResolved` (Gradle 3.3+)
- a `try`/`catch` fallback to the `Spec`-taking `getFirstLevelModuleDependencies(Spec)` when the
  no-arg overload is absent (Gradle 3.3+)

Those fallback branches never execute on modern Gradle, so without a test on *old* Gradle they
could silently rot. This smoke test exercises them.

## What it does
`smoke-test.sh <path-to-gradle>` generates a tiny **local** Maven repo (`make-localrepo.sh` — two
transitive-free artifacts, a prod `demo.lib:foo` and a test `demo.test:bar`), runs the init script's
`socketFacts` task against `project/` **fully offline**, and asserts the emitted RECORDS (the script's
only output — the TS assembler that turns records into `.socket.facts.json` is covered by
`nx test utils`): exactly the two expected dependency nodes, `foo` in a prod root, `bar` only in
non-prod roots, and an on-disk jar `file` record for each under `-Psocket.withFiles`.

A local repo (not Maven Central) is essential: Gradle 1.x/2.x can't negotiate modern Maven Central's
TLS, so only an offline local repo makes the old-version matrix entries testable at all.

## Running locally
```bash
curl -fsSL https://services.gradle.org/distributions/gradle-2.14.1-bin.zip -o g.zip && unzip -q g.zip
JAVA_HOME=<jdk8> ./smoke-test.sh "$PWD/gradle-2.14.1/bin/gradle"
```
CI runs it (and the SBT equivalent) across a label-gated matrix in
`.github/workflows/manifest-scripts-compat.yml` — add the `manifest-scripts` label to a PR to run it.
