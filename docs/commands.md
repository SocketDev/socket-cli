# Socket CLI 2.x prerelease command index

Use this index to find a command guide. Run `socket <command> --help` for the
current options.

## Command inventory

Every registered route, including hidden commands and local routes, appears once. Use the linked guide for context; run `socket <command> --help` for current options.

| Command                        | Guide                               |
| ------------------------------ | ----------------------------------- |
| `analytics`                    | [Guide](commands/activity.md)       |
| `ask`                          | [Guide](commands/health.md)         |
| `audit-log`                    | [Guide](commands/activity.md)       |
| `bundler`                      | [Guide](commands/managers.md)       |
| `cargo`                        | [Guide](commands/managers.md)       |
| `ci`                           | [Guide](commands/scans.md)          |
| `config`                       | [Guide](commands/configuration.md)  |
| `config auto`                  | [Guide](commands/configuration.md)  |
| `config get`                   | [Guide](commands/configuration.md)  |
| `config list`                  | [Guide](commands/configuration.md)  |
| `config set`                   | [Guide](commands/configuration.md)  |
| `config unset`                 | [Guide](commands/configuration.md)  |
| `dependencies`                 | [Guide](commands/organizations.md)  |
| `doctor`                       | [Guide](commands/health.md)         |
| `fix`                          | [Guide](commands/health.md)         |
| `gem`                          | [Guide](commands/managers.md)       |
| `go`                           | [Guide](commands/managers.md)       |
| `install`                      | [Guide](commands/configuration.md)  |
| `install completion`           | [Guide](commands/configuration.md)  |
| `json`                         | [Guide](commands/configuration.md)  |
| `license`                      | [Guide](commands/organizations.md)  |
| `login`                        | [Guide](commands/authentication.md) |
| `logout`                       | [Guide](commands/authentication.md) |
| `manifest`                     | [Guide](commands/manifests.md)      |
| `manifest auto`                | [Guide](commands/manifests.md)      |
| `manifest bazel`               | [Guide](commands/manifests.md)      |
| `manifest conda`               | [Guide](commands/manifests.md)      |
| `manifest gradle`              | [Guide](commands/manifests.md)      |
| `manifest kotlin`              | [Guide](commands/manifests.md)      |
| `manifest maven`               | [Guide](commands/manifests.md)      |
| `manifest scala`               | [Guide](commands/manifests.md)      |
| `manifest setup`               | [Guide](commands/manifests.md)      |
| `mcp`                          | [Guide](commands/mcp.md)            |
| `npm`                          | [Guide](commands/managers.md)       |
| `npx`                          | [Guide](commands/managers.md)       |
| `nuget`                        | [Guide](commands/managers.md)       |
| `oops`                         | [Guide](commands/development.md)    |
| `optimize`                     | [Guide](commands/health.md)         |
| `organization`                 | [Guide](commands/organizations.md)  |
| `organization dependencies`    | [Guide](commands/organizations.md)  |
| `organization list`            | [Guide](commands/organizations.md)  |
| `organization policy`          | [Guide](commands/organizations.md)  |
| `organization policy license`  | [Guide](commands/organizations.md)  |
| `organization policy security` | [Guide](commands/organizations.md)  |
| `organization quota`           | [Guide](commands/organizations.md)  |
| `package`                      | [Guide](commands/packages.md)       |
| `package score`                | [Guide](commands/packages.md)       |
| `package shallow`              | [Guide](commands/packages.md)       |
| `patch`                        | [Guide](commands/patch.md)          |
| `patch list`                   | [Guide](commands/patch.md)          |
| `patch remove`                 | [Guide](commands/patch.md)          |
| `pip`                          | [Guide](commands/managers.md)       |
| `pnpm`                         | [Guide](commands/managers.md)       |
| `pycli`                        | [Guide](commands/pycli.md)          |
| `raw-npm`                      | [Guide](commands/managers.md)       |
| `raw-npx`                      | [Guide](commands/managers.md)       |
| `repository`                   | [Guide](commands/repositories.md)   |
| `repository create`            | [Guide](commands/repositories.md)   |
| `repository del`               | [Guide](commands/repositories.md)   |
| `repository list`              | [Guide](commands/repositories.md)   |
| `repository update`            | [Guide](commands/repositories.md)   |
| `repository view`              | [Guide](commands/repositories.md)   |
| `sbom`                         | [Guide](commands/manifests.md)      |
| `scan`                         | [Guide](commands/scans.md)          |
| `scan create`                  | [Guide](commands/scans.md)          |
| `scan del`                     | [Guide](commands/scans.md)          |
| `scan diff`                    | [Guide](commands/scans.md)          |
| `scan github`                  | [Guide](commands/scans.md)          |
| `scan list`                    | [Guide](commands/scans.md)          |
| `scan metadata`                | [Guide](commands/scans.md)          |
| `scan reach`                   | [Guide](commands/scans.md)          |
| `scan report`                  | [Guide](commands/scans.md)          |
| `scan setup`                   | [Guide](commands/scans.md)          |
| `scan view`                    | [Guide](commands/scans.md)          |
| `security`                     | [Guide](commands/organizations.md)  |
| `sfw`                          | [Guide](commands/managers.md)       |
| `sfw ca`                       | [Guide](commands/managers.md)       |
| `sfw ca init`                  | [Guide](commands/managers.md)       |
| `sfw ca path`                  | [Guide](commands/managers.md)       |
| `sfw ca trust`                 | [Guide](commands/managers.md)       |
| `threat-feed`                  | [Guide](commands/activity.md)       |
| `uninstall`                    | [Guide](commands/configuration.md)  |
| `uninstall completion`         | [Guide](commands/configuration.md)  |
| `uv`                           | [Guide](commands/managers.md)       |
| `whoami`                       | [Guide](commands/authentication.md) |
| `wrapper`                      | [Guide](commands/configuration.md)  |
| `yarn`                         | [Guide](commands/managers.md)       |

## Authentication

| Command  | Purpose                                        | Guide                                        |
| -------- | ---------------------------------------------- | -------------------------------------------- |
| `login`  | Authenticate with Socket.                      | [Authentication](commands/authentication.md) |
| `logout` | Clear saved Socket credentials.                | [Authentication](commands/authentication.md) |
| `whoami` | Show whether Socket credentials are available. | [Authentication](commands/authentication.md) |

## Configuration

| Command        | Purpose                                          | Guide                                      |
| -------------- | ------------------------------------------------ | ------------------------------------------ |
| `config`       | Read and change local CLI settings.              | [Configuration](commands/configuration.md) |
| `config auto`  | Discover and optionally save a setting.          | [Configuration](commands/configuration.md) |
| `config get`   | Read one local CLI setting.                      | [Configuration](commands/configuration.md) |
| `config list`  | List local CLI settings.                         | [Configuration](commands/configuration.md) |
| `config set`   | Save a local CLI setting.                        | [Configuration](commands/configuration.md) |
| `config unset` | Remove a local CLI setting.                      | [Configuration](commands/configuration.md) |
| `json`         | Show the `socket.json` file used in a directory. | [Configuration](commands/configuration.md) |
| `install`      | Install shell completion.                        | [Configuration](commands/configuration.md) |
| `uninstall`    | Remove shell completion.                         | [Configuration](commands/configuration.md) |
| `wrapper`      | Enable or disable the npm and pnpm exec wrapper. | [Configuration](commands/configuration.md) |

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

These names route to the listed command. Hidden aliases remain accepted for compatibility.

| Alias                   | Target                         |
| ----------------------- | ------------------------------ |
| `audit`                 | `audit-log`                    |
| `audit-logs`            | `audit-log`                    |
| `auditLog`              | `audit-log`                    |
| `auditLogs`             | `audit-log`                    |
| `deps`                  | `dependencies`                 |
| `feed`                  | `threat-feed`                  |
| `firewall`              | `sfw`                          |
| `manifest yolo`         | `manifest auto`                |
| `org`                   | `organization`                 |
| `organisation`          | `organization`                 |
| `organisations`         | `organization`                 |
| `organization deps`     | `organization dependencies`    |
| `organization license`  | `organization policy license`  |
| `organization security` | `organization policy security` |
| `organizations`         | `organization`                 |
| `orgs`                  | `organization`                 |
| `package deep`          | `package score`                |
| `pip3`                  | `pip`                          |
| `pkg`                   | `package`                      |
| `repo`                  | `repository`                   |
| `repos`                 | `repository`                   |
| `repositories`          | `repository`                   |
| `scan meta`             | `scan metadata`                |
| `scan reachability`     | `scan reach`                   |

Root command registration lives in [`src/commands.mts`](../src/commands.mts).
