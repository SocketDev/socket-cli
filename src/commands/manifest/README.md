# Manifest

`socket manifest <subcommand>` generates declarative dependency manifests
(`pom.xml`, `requirements.txt`, etc.) for ecosystems whose canonical build
system does not ship one out of the box. The resulting files are consumed by
`socket scan create`'s server-side per-ecosystem parsers.

## Subcommands

Sections are sorted alphabetically by subcommand name.

## socket manifest auto

Auto-detect the build system in the target directory and run the matching
manifest generator. Useful when you do not want to spell out the language.

## socket manifest bazel [beta]

Generates Bazel JVM SBOM manifests (`maven_install.json`-shaped) by running
`bazel query` against discovered Maven repos in a Bazel workspace. Output is
consumed by `socket scan create` and closes the
inline-Maven-declaration gap that lockfile-only parsing misses.

> **Note**: This command generates Maven dependency manifests for Bazel JVM
> workspaces. It does not run reachability analysis.

### Usage

```bash
socket manifest bazel [options] [DIR=.]
```

### Options

- `--bazel <path>` — path to bazel/bazelisk binary; default `$(which bazelisk) || $(which bazel)`.
- `--bazel-rc <path>` — path to additional `.bazelrc` fragments forwarded to bazel.
- `--bazel-flags <str>` — flags forwarded to every bazel invocation (single quoted string).
- `--bazel-output-base <dir>` — Bazel `--output_base` for read-only-cache CI environments.
- `--out <dir>` — output directory; default `./.socket/bazel-manifests/`.
- `--dry-run`, `--verbose` — standard diagnostic flags.

> **Upload**: This subcommand only generates manifests. To generate and
> upload in one step, use `socket scan create --auto-manifest .` — it
> detects the workspace, runs the same extraction this subcommand performs,
> and uploads the result.

### Examples

```bash
# Generate maven manifests from the current Bazel workspace.
socket manifest bazel .

# Use bazelisk explicitly.
socket manifest bazel --bazel=/usr/local/bin/bazelisk .
```

### Requirements

- `bazel` or `bazelisk` on `PATH` (or pass `--bazel <path>`).
- Network access on cold cache. Bazel and `rules_jvm_external` own their own
  retry policy for transient Maven resolution failures — `socket manifest bazel`
  does not retry on top of them.
- Writable Bazel output base; pass `--bazel-output-base` for read-only-cache CI.

This is the user-visible entry point for Bazel JVM SBOM support; the [beta] label and "Bazel JVM SBOM support" wording must stay consistent across release notes and docs.

## socket manifest cdxgen

Wraps the upstream `cdxgen` CycloneDX BOM generator for repos that already
have a working cdxgen configuration.

## socket manifest conda [beta]

Converts a Conda `environment.yml` file to a Python `requirements.txt` so the
Socket scan pipeline can consume the resulting manifest.

## socket manifest gradle [beta]

Uses Gradle (via the project's `gradlew`) to emit a `pom.xml` per subproject,
then feeds those files into the Socket scan pipeline. Mirrors the kotlin and
scala flows.

## socket manifest kotlin [beta]

Uses Gradle to generate a manifest file (`pom.xml`) for a Kotlin project; the
underlying flow is identical to the gradle subcommand.

## socket manifest scala [beta]

Generates a manifest file (`pom.xml`) from Scala's `build.sbt` file.

## socket manifest setup

Starts an interactive configurator that writes default flag values for
`socket manifest` into a `socket.json` in the current directory.

## Dev

Run it like these examples:

```
# Scala:
npm run bs manifest scala -- --bin ~/apps/sbt/bin/sbt ~/socket/repos/scala/akka
# Gradle/Kotlin
npm run bs manifest yolo -- --cwd  ~/socket/repos/kotlin/kotlinx.coroutines
```

And upload with this:

```
npm exec socket scan create -- --repo=example-repo --branch=example-branch --tmp --cwd ~/repos/scala/akka example-org .
npm exec socket scan create -- --repo=example-repo --branch=example-branch --tmp --cwd ~/repos/kotlin/kotlinx.coroutines .
```

(The `cwd` option for `create` is necessary because we can't go to the dir and run `npm exec`).

## Prod

User flow look something like this:

```
socket manifest scala .
socket manifest kotlin .
socket manifest yolo

socket scan create --repo=example-repo --branch=example-branch --tmp example-org .
```
