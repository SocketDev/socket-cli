# Dependency manifests

## `socket manifest`

Choose an ecosystem-specific subcommand:

| Command           | Purpose                                                             | Example                  |
| ----------------- | ------------------------------------------------------------------- | ------------------------ |
| `manifest auto`   | Detect ecosystems and generate supported manifests.                 | `socket manifest auto`   |
| `manifest bazel`  | Generate manifests from Bazel dependencies.                         | `socket manifest bazel`  |
| `manifest conda`  | Convert the pip section of `environment.yml` to `requirements.txt`. | `socket manifest conda`  |
| `manifest gradle` | Resolve Gradle dependencies to facts or POM files.                  | `socket manifest gradle` |
| `manifest kotlin` | Resolve Kotlin Gradle dependencies to facts or POM files.           | `socket manifest kotlin` |
| `manifest maven`  | Resolve Maven dependencies to facts.                                | `socket manifest maven`  |
| `manifest scala`  | Resolve sbt dependencies to facts or a POM.                         | `socket manifest scala`  |
| `manifest setup`  | Save local defaults for manifest generation.                        | `socket manifest setup`  |

Most subcommands accept a project directory and generator-specific options.
`manifest setup` writes `socket.json`. Generators can run project build tools.
Review the command help and repository `socket.json` before you run one. The
CLI refuses untrusted generator paths and options unless you pass
`--trust-socket-json`.

`manifest conda` converts only pip dependencies and is in beta. It does not
resolve Conda packages.

## `socket sbom`

Generate a CycloneDX manifest with bundled `sdxgen`:

```sh
socket sbom ./project --out sbom.json
```

Output goes to stdout unless `--out` names a file. Project build-tool execution
is opt-in with `--execute-tools`. Use `--recursive` to include workspace
projects.
