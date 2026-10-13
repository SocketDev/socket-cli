# Scans

## `socket scan`

Use scan subcommands to create and inspect scans:

| Command                 | Purpose                                                   | Example                                       |
| ----------------------- | --------------------------------------------------------- | --------------------------------------------- |
| `scan create`           | Upload supported manifests from a directory or files.     | `socket scan create`                          |
| `scan del <ID>`         | Delete a scan.                                            | `socket scan del <SCAN_ID>`                   |
| `scan diff <ID1> <ID2>` | Compare two scans. The first ID is treated as older.      | `socket scan diff <OLD_ID> <NEW_ID>`          |
| `scan github`           | Scan manifests from a GitHub repository.                  | `socket scan github`                          |
| `scan list`             | List scans, with optional repo or branch filters.         | `socket scan list --branch main`              |
| `scan metadata <ID>`    | Read scan metadata.                                       | `socket scan metadata <SCAN_ID>`              |
| `scan reach`            | Run reachability analysis without creating a Socket scan. | `socket scan reach`                           |
| `scan report <ID>`      | Download alerts for a scan.                               | `socket scan report <SCAN_ID> --fold=version` |
| `scan setup`            | Set local defaults for scan creation.                     | `socket scan setup`                           |
| `scan view <ID>`        | Read raw artifact results for a scan.                     | `socket scan view <SCAN_ID>`                  |

`scan create` uploads manifest data. It defaults to the current directory and
ignores files covered by `.gitignore`, `socket.yml`, and built-in rules. Use
`--make-default-branch` on the first scan when that scan should establish the
repository's default branch.

`scan github` reads repository files through the GitHub API. Its token needs
read access to repository contents. It cannot run local manifest generators.

`scan reach` writes `.socket.facts.json` by default. It uploads manifests so the
backend can build an SBOM for reachability analysis.

## `socket ci`

Scan the current project for CI and set a non-zero exit code when the scan does
not pass the organization policy:

```sh
socket ci
```

The command uses the token's default organization. Automatic manifest
generation is off by default; enable it with `--auto-manifest`. It can run
Gradle or sbt build tools. Review `socket.json` and pass `--trust-socket-json`
when you trust its binary or build options.
