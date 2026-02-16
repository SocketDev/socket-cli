# Socket CLI Command Architecture

Complete reference for all Socket CLI commands, subcommands, and their integrations.

## Command Hierarchy

### 77 Total Commands
- 40 Root commands (including parent commands)
- 37 Subcommands

## Root Commands (40)

### Core Commands (15)

| Command | Module | Integrates With | Subcommands |
|---------|--------|-----------------|-------------|
| analytics | `analytics/cmd-analytics.mts` | Socket Analytics Dashboard API | - |
| ask | `ask/cmd-ask.mts` | Socket AI Assistant API | - |
| audit-log | `audit-log/cmd-audit-log.mts` | Socket Audit Log API | - |
| ci | `ci/cmd-ci.mts` | CI/CD Integration (Socket API) | - |
| console | `console/cmd-console.mts` | Interactive TUI console | - |
| fix | `fix/cmd-fix.mts` | Socket Fix API (security patches) | - |
| json | `json/cmd-json.mts` | JSON output formatter wrapper | - |
| login | `login/cmd-login.mts` | Socket Authentication API | - |
| logout | `logout/cmd-logout.mts` | Local credential cleanup | - |
| oops | `oops/cmd-oops.mts` | Error reporting/feedback | - |
| optimize | `optimize/cmd-optimize.mts` | Socket Registry Overrides | - |
| patch | `patch/cmd-patch.mts` | @socketsecurity/socket-patch | - |
| threat-feed | `threat-feed/cmd-threat-feed.mts` | Socket Threat Intelligence API | - |
| whoami | `whoami/cmd-whoami.mts` | Socket User API | - |
| wrapper | `wrapper/cmd-wrapper.mts` | Package manager wrapper config | - |

### Config Commands (1 parent + 5 subcommands)

| Command | Module | Integrates With | Type |
|---------|--------|-----------------|------|
| **config** | `config/cmd-config.mts` | Parent command | Parent |
| ├─ config auto | `config/cmd-config-auto.mts` | Auto-configure from environment | Subcommand |
| ├─ config get | `config/cmd-config-get.mts` | Read ~/.socket/config | Subcommand |
| ├─ config list | `config/cmd-config-list.mts` | List configuration values | Subcommand |
| ├─ config set | `config/cmd-config-set.mts` | Write to ~/.socket/config | Subcommand |
| └─ config unset | `config/cmd-config-unset.mts` | Remove config values | Subcommand |

### Install Commands (2 parents + 2 subcommands)

| Command | Module | Integrates With | Type |
|---------|--------|-----------------|------|
| **install** | `install/cmd-install.mts` | System-wide CLI installation | Parent |
| └─ install completion | `install/cmd-install-completion.mts` | Shell completion (bash/zsh/fish) | Subcommand |
| **uninstall** | `uninstall/cmd-uninstall.mts` | Remove CLI from system | Parent |
| └─ uninstall completion | `uninstall/cmd-uninstall-completion.mts` | Remove shell completion | Subcommand |

### Manifest Commands (1 parent + 7 subcommands)

| Command | Module | Integrates With | Type |
|---------|--------|-----------------|------|
| **manifest** | `manifest/cmd-manifest.mts` | Parent command | Parent |
| ├─ manifest auto | `manifest/cmd-manifest-auto.mts` | Auto-detect manifests | Subcommand |
| ├─ manifest cdxgen | `manifest/cmd-manifest-cdxgen.mts` | @cyclonedx/cdxgen (SBOM) | Subcommand |
| ├─ manifest conda | `manifest/cmd-manifest-conda.mts` | conda.yml → requirements.txt | Subcommand |
| ├─ manifest gradle | `manifest/cmd-manifest-gradle.mts` | Gradle → pom.xml | Subcommand |
| ├─ manifest kotlin | `manifest/cmd-manifest-kotlin.mts` | Kotlin (Gradle) → pom.xml | Subcommand |
| ├─ manifest scala | `manifest/cmd-manifest-scala.mts` | Scala SBT → pom.xml | Subcommand |
| └─ manifest setup | `manifest/cmd-manifest-setup.mts` | Interactive manifest config | Subcommand |

### Organization Commands (1 parent + 6 subcommands, including nested)

| Command | Module | Integrates With | Type |
|---------|--------|-----------------|------|
| **organization** | `organization/cmd-organization.mts` | Socket Org API | Parent |
| ├─ organization dependencies | `organization/cmd-organization-dependencies.mts` | Socket Org Dependencies API | Subcommand |
| ├─ organization list | `organization/cmd-organization-list.mts` | Socket Org List API | Subcommand |
| ├─ **organization policy** | `organization/cmd-organization-policy.mts` | Parent for policy subcommands | Subcommand (Parent) |
| │  ├─ organization policy license | `organization/cmd-organization-policy-license.mts` | Socket License Policy API | Nested Subcommand |
| │  └─ organization policy security | `organization/cmd-organization-policy-security.mts` | Socket Security Policy API | Nested Subcommand |
| └─ organization quota | `organization/cmd-organization-quota.mts` | Socket Quota API | Subcommand |

### Package Commands (1 parent + 2 subcommands)

| Command | Module | Integrates With | Type |
|---------|--------|-----------------|------|
| **package** | `package/cmd-package.mts` | Parent command | Parent |
| ├─ package score | `package/cmd-package-score.mts` | Socket Package Score API (deep) | Subcommand |
| └─ package shallow | `package/cmd-package-shallow.mts` | Socket Package Score API (shallow) | Subcommand |

### Package Manager Wrappers (13)

All connect via Socket Firewall (sfw) except raw-npm and raw-npx which bypass Socket entirely.

| Command | Module | Integrates With | Subcommands |
|---------|--------|-----------------|-------------|
| bundler | `bundler/cmd-bundler.mts` | sfw → Bundler (Ruby) | - |
| cargo | `cargo/cmd-cargo.mts` | sfw → Cargo (Rust) | - |
| gem | `gem/cmd-gem.mts` | sfw → RubyGems | - |
| go | `go/cmd-go.mts` | sfw → Go modules | - |
| npm | `npm/cmd-npm.mts` | sfw → npm | - |
| npx | `npx/cmd-npx.mts` | sfw → npx | - |
| nuget | `nuget/cmd-nuget.mts` | sfw → NuGet (.NET) | - |
| pip | `pip/cmd-pip.mts` | sfw → pip/pip3 (Python) | - |
| pnpm | `pnpm/cmd-pnpm.mts` | sfw → pnpm | - |
| raw-npm | `raw-npm/cmd-raw-npm.mts` | Direct npm (no Socket) | - |
| raw-npx | `raw-npx/cmd-raw-npx.mts` | Direct npx (no Socket) | - |
| uv | `uv/cmd-uv.mts` | sfw → uv (Python) | - |
| yarn | `yarn/cmd-yarn.mts` | sfw → Yarn | - |

### Repository Commands (1 parent + 5 subcommands)

| Command | Module | Integrates With | Type |
|---------|--------|-----------------|------|
| **repository** | `repository/cmd-repository.mts` | Socket Repository API | Parent |
| ├─ repository create | `repository/cmd-repository-create.mts` | Socket Repository API (create) | Subcommand |
| ├─ repository del | `repository/cmd-repository-del.mts` | Socket Repository API (delete) | Subcommand |
| ├─ repository list | `repository/cmd-repository-list.mts` | Socket Repository API (list) | Subcommand |
| ├─ repository update | `repository/cmd-repository-update.mts` | Socket Repository API (update) | Subcommand |
| └─ repository view | `repository/cmd-repository-view.mts` | Socket Repository API (view) | Subcommand |

### Scan Commands (1 parent + 10 subcommands)

| Command | Module | Integrates With | Type |
|---------|--------|-----------------|------|
| **scan** | `scan/cmd-scan.mts` | Socket Scan API | Parent |
| ├─ scan create | `scan/cmd-scan-create.mts` | Socket Scan API (create) | Subcommand |
| ├─ scan del | `scan/cmd-scan-del.mts` | Socket Scan API (delete) | Subcommand |
| ├─ scan diff | `scan/cmd-scan-diff.mts` | Socket Scan API (diff) | Subcommand |
| ├─ scan github | `scan/cmd-scan-github.mts` | GitHub API + Socket Scan API | Subcommand |
| ├─ scan list | `scan/cmd-scan-list.mts` | Socket Scan API (list) | Subcommand |
| ├─ scan metadata | `scan/cmd-scan-metadata.mts` | Socket Scan API (metadata) | Subcommand |
| ├─ scan reach | `scan/cmd-scan-reach.mts` | @coana-tech/cli (reachability) | Subcommand |
| ├─ scan report | `scan/cmd-scan-report.mts` | Socket Scan API (report) | Subcommand |
| ├─ scan setup | `scan/cmd-scan-setup.mts` | Interactive scan config | Subcommand |
| └─ scan view | `scan/cmd-scan-view.mts` | Socket Scan API (view) | Subcommand |

## Command File Structure

Each command follows a consistent pattern:

```
src/commands/<command>/
├── cmd-<command>.mts           # Command definition (meow config)
├── handle-<command>.mts        # Business logic
├── output-<command>.mts        # Output formatting (JSON/markdown)
├── fetch-<command>.mts         # API calls (if applicable)
└── types.mts                   # TypeScript types
```

### Example: Package Score Command

```
src/commands/package/
├── cmd-package.mts                    # Parent command
├── cmd-package-score.mts              # Subcommand definition
├── handle-purl-deep-score.mts         # Business logic
├── output-purls-deep-score.mts        # Output formatting
├── fetch-purl-deep-score.mts          # Socket API calls
└── parse-package-specifiers.mts       # Package parsing utilities
```

## Integration Map

### Socket API Services

| Service | Commands Using It |
|---------|-------------------|
| Analytics API | analytics |
| Ask API | ask |
| Audit Log API | audit-log |
| Authentication API | login |
| Dependencies API | organization dependencies |
| Fix API | fix |
| Organization API | organization, organization list, organization quota |
| Package Score API | package score, package shallow |
| Policy API | organization policy license, organization policy security |
| Repository API | repository create/del/list/update/view |
| Scan API | scan create/del/diff/github/list/metadata/report/setup/view |
| Threat Intelligence API | threat-feed |
| User API | whoami |

### Third-Party Tools

| Tool | Commands Using It |
|------|-------------------|
| @coana-tech/cli | scan reach |
| @cyclonedx/cdxgen | manifest cdxgen |
| @socketsecurity/socket-patch | patch |
| Socket Firewall (sfw) | bundler, cargo, gem, go, npm, npx, nuget, pip, pnpm, uv, yarn |
| synp | (internal converter usage) |

### System Integrations

| Integration | Commands Using It |
|-------------|-------------------|
| Interactive TUI | console |
| File System (~/.socket/) | config get/set/unset/list/auto |
| GitHub API | scan github |
| Shell Completion | install completion, uninstall completion |

## Command Registration

Commands are exported from `src/commands.mts`:

```typescript
export const rootCommands = {
  analytics: cmdAnalytics,
  ask: cmdAsk,
  'audit-log': cmdAuditLog,
  // ... all root commands
}
```

Parent commands register subcommands using `meowWithSubcommands()`:

```typescript
import type { CliSubcommand } from '../../utils/cli/with-subcommands.mjs'

export const cmdScan: CliSubcommand = {
  description: 'Manage Socket scans',
  async run(argv, importMeta, { parentName }) {
    await meowWithSubcommands(
      {
        argv,
        name: `${parentName} scan`,
        importMeta,
        subcommands: {
          create: cmdScanCreate,
          del: cmdScanDel,
          diff: cmdScanDiff,
          // ... all subcommands
        },
      },
      {
        aliases: {
          // Optional aliases configuration
        },
      },
    )
  },
}
```

## Command Aliases

Several commands have aliases defined in `src/commands.mts`:

| Alias | Points To | Visibility |
|-------|-----------|------------|
| audit | audit-log | Visible |
| deps | dependencies | Visible |
| feed | threat-feed | Visible |
| org | organization | Visible |
| pkg | package | Visible |
| repo | repository | Visible |
| auditLog | audit-log | Hidden |
| auditLogs | audit-log | Hidden |
| audit-logs | audit-log | Hidden |
| orgs | organization | Hidden |
| organizations | organization | Hidden |
| organisation | organization | Hidden |
| organisations | organization | Hidden |
| pip3 | pip | Hidden |
| repos | repository | Hidden |
| repositories | repository | Hidden |

## Adding a New Command

### 1. Create Command Directory

```bash
mkdir -p src/commands/mycommand
```

### 2. Create Command Definition

**`src/commands/mycommand/cmd-mycommand.mts`:**
```typescript
import type { CliCommandConfig, CliCommandContext } from '../../utils/cli/with-subcommands.mjs'

export const CMD_NAME = 'mycommand'
const description = 'My command description'

export const cmdMyCommand = {
  description,
  hidden: false,
  run,
}

async function run(
  argv: string[],
  importMeta: ImportMeta,
  context: CliCommandContext,
): Promise<void> {
  // Implementation
}
```

### 3. Register Command

**`src/commands.mts`:**
```typescript
import { cmdMyCommand } from './commands/mycommand/cmd-mycommand.mts'

export const rootCommands = {
  // ... existing commands
  mycommand: cmdMyCommand,
}
```

### 4. Add E2E Test

**`test/e2e/binary-test-suite.e2e.test.mts`:**
```typescript
const commands = [
  // ... existing commands
  'mycommand',
]
```

### 5. Update This README

Add your command to the appropriate category above.

## Architecture Principles

1. **Separation of Concerns**: Command definition, business logic, output formatting, and API calls are separate
2. **Type Safety**: All commands use TypeScript with strict types
3. **Consistent Patterns**: All commands follow the same file structure and naming conventions
4. **Testability**: E2E tests for all commands, unit tests for handlers
5. **Modularity**: Subcommands are separate modules registered with parent commands
6. **Error Handling**: Custom `InputError` and `AuthError` types for consistent error reporting
7. **Output Flexibility**: Commands support JSON and markdown output formats via `--json` flag
