# Socket CLI 2.x prerelease command index

Use this index to find a command guide. Run `socket <command> --help` for the
current options.

## Authentication

| Command  | Purpose                                        | Guide                                        |
| -------- | ---------------------------------------------- | -------------------------------------------- |
| `login`  | Authenticate with Socket.                      | [Authentication](commands/authentication.md) |
| `logout` | Clear saved Socket credentials.                | [Authentication](commands/authentication.md) |
| `whoami` | Show whether Socket credentials are available. | [Authentication](commands/authentication.md) |

## Configuration

| Command     | Purpose                                          | Guide                                      |
| ----------- | ------------------------------------------------ | ------------------------------------------ |
| `config`    | Read and change local CLI settings.              | [Configuration](commands/configuration.md) |
| `json`      | Show the `socket.json` file used in a directory. | [Configuration](commands/configuration.md) |
| `install`   | Install shell completion.                        | [Configuration](commands/configuration.md) |
| `uninstall` | Remove shell completion.                         | [Configuration](commands/configuration.md) |
| `wrapper`   | Enable or disable the npm and pnpm exec wrapper. | [Configuration](commands/configuration.md) |

## Health and fixes

| Command    | Purpose                                                  | Guide                                  |
| ---------- | -------------------------------------------------------- | -------------------------------------- |
| `doctor`   | Enforce dependency health rules and report setup issues. | [Health and fixes](commands/health.md) |
| `fix`      | Find and apply dependency vulnerability fixes.           | [Health and fixes](commands/health.md) |
| `optimize` | Add Socket Registry overrides and update dependencies.   | [Health and fixes](commands/health.md) |
| `ask`      | Turn a natural-language request into a CLI action.       | [Health and fixes](commands/health.md) |

## Scans

| Command | Purpose                                                 | Guide                      |
| ------- | ------------------------------------------------------- | -------------------------- |
| `ci`    | Scan a project and set the CI exit status from policy.  | [Scans](commands/scans.md) |
| `scan`  | Create, list, inspect, compare, or report Socket scans. | [Scans](commands/scans.md) |

## Manifests

| Command    | Purpose                                           | Guide                              |
| ---------- | ------------------------------------------------- | ---------------------------------- |
| `manifest` | Generate ecosystem-specific dependency manifests. | [Manifests](commands/manifests.md) |
| `sbom`     | Generate a CycloneDX SBOM with bundled `sdxgen`.  | [Manifests](commands/manifests.md) |

## Packages

| Command   | Purpose                                     | Guide                            |
| --------- | ------------------------------------------- | -------------------------------- |
| `package` | Look up package scores and package details. | [Packages](commands/packages.md) |

## Organizations

| Command        | Purpose                                             | Guide                                      |
| -------------- | --------------------------------------------------- | ------------------------------------------ |
| `organization` | List organizations, quota, and policy.              | [Organizations](commands/organizations.md) |
| `dependencies` | Search dependency records known to an organization. | [Organizations](commands/organizations.md) |
| `license`      | Read an organization's license policy.              | [Organizations](commands/organizations.md) |
| `security`     | Read an organization's security policy.             | [Organizations](commands/organizations.md) |

## Repositories

| Command      | Purpose                                                        | Guide                                    |
| ------------ | -------------------------------------------------------------- | ---------------------------------------- |
| `repository` | Create, view, list, update, or delete registered repositories. | [Repositories](commands/repositories.md) |

## Activity and threat data

| Command       | Purpose                                    | Guide                            |
| ------------- | ------------------------------------------ | -------------------------------- |
| `analytics`   | Read organization or repository analytics. | [Activity](commands/activity.md) |
| `audit-log`   | Read an organization's audit log.          | [Activity](commands/activity.md) |
| `threat-feed` | Read an organization's threat feed.        | [Activity](commands/activity.md) |

## Package managers

| Command   | Purpose                                  | Guide                                    |
| --------- | ---------------------------------------- | ---------------------------------------- |
| `bundler` | Run Bundler through Socket Firewall.     | [Package managers](commands/managers.md) |
| `cargo`   | Run Cargo through Socket Firewall.       | [Package managers](commands/managers.md) |
| `gem`     | Run RubyGems through Socket Firewall.    | [Package managers](commands/managers.md) |
| `go`      | Run Go through Socket Firewall.          | [Package managers](commands/managers.md) |
| `npm`     | Run npm through Socket Firewall.         | [Package managers](commands/managers.md) |
| `npx`     | Run `npx` through Socket Firewall.       | [Package managers](commands/managers.md) |
| `nuget`   | Run NuGet through Socket Firewall.       | [Package managers](commands/managers.md) |
| `pip`     | Run pip through Socket Firewall.         | [Package managers](commands/managers.md) |
| `pnpm`    | Run pnpm through Socket Firewall.        | [Package managers](commands/managers.md) |
| `uv`      | Run uv through Socket Firewall.          | [Package managers](commands/managers.md) |
| `yarn`    | Run Yarn through Socket Firewall.        | [Package managers](commands/managers.md) |
| `sfw`     | Run Socket Firewall directly.            | [Package managers](commands/managers.md) |
| `raw-npm` | Run npm without Socket install gating.   | [Package managers](commands/managers.md) |
| `raw-npx` | Run `npx` without Socket install gating. | [Package managers](commands/managers.md) |

## Other tools

| Command | Purpose                                                       | Guide                                  |
| ------- | ------------------------------------------------------------- | -------------------------------------- |
| `patch` | Manage local CVE patch records or delegate to `socket-patch`. | [Patch](commands/patch.md)             |
| `mcp`   | Run the Socket MCP server over stdio or HTTP.                 | [MCP](commands/mcp.md)                 |
| `pycli` | Pass options to the Socket Python CLI.                        | [Python CLI](commands/pycli.md)        |
| `oops`  | Trigger an intentional error for development and testing.     | [Development](commands/development.md) |

## Aliases

These names route to the listed command. Hidden aliases remain accepted for
compatibility.

| Alias                                                           | Command                        |
| --------------------------------------------------------------- | ------------------------------ |
| `audit`, `audit-logs`, `auditLog`, `auditLogs`                  | `audit-log`                    |
| `deps`                                                          | `dependencies`                 |
| `feed`                                                          | `threat-feed`                  |
| `firewall`                                                      | `sfw`                          |
| `org`, `organisation`, `organisations`, `organizations`, `orgs` | `organization`                 |
| `pip3`                                                          | `pip`                          |
| `pkg`                                                           | `package`                      |
| `repo`, `repos`, `repositories`                                 | `repository`                   |
| `organization deps`                                             | `organization dependencies`    |
| `organization license`                                          | `organization policy license`  |
| `organization security`                                         | `organization policy security` |
| `package deep`                                                  | `package score`                |
| `manifest yolo`                                                 | `manifest auto`                |
| `scan meta`                                                     | `scan metadata`                |
| `scan reachability`                                             | `scan reach`                   |

Root command registration lives in [`src/commands.mts`](../src/commands.mts).
