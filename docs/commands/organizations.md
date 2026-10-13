# Organizations

## Organization commands

| Command                               | Purpose                                         | Example                               |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------- |
| `socket organization list`            | List organizations available to the credential. | `socket organization list`            |
| `socket organization quota`           | Read organization API quota.                    | `socket organization quota`           |
| `socket organization policy`          | Show available organization policy commands.    | `socket organization policy --help`   |
| `socket organization policy license`  | Read license policy.                            | `socket organization policy license`  |
| `socket organization policy security` | Read security policy.                           | `socket organization policy security` |

`license` and `security` are also registered as root commands. They need the
matching `license-policy:read` or `security-policy:read` API permission.

## Organization dependencies

`socket organization dependencies` lists dependency records already known to
the authenticated organization. It does not scan your current directory and
does not accept a package name or organization slug. Use `--limit` and
`--offset` to request another page.

Read the [organization dependency inventory guide](../organization-dependencies.md)
for pagination and output details.

## Names and aliases

The root command `dependencies` and alias `deps` both list the same inventory.
The root alias `org` routes to `organization`. Hidden aliases include
`organisation`, `organisations`, `organizations`, and `orgs`. Within the group,
`organization deps`, `organization license`, and `organization security` route
to their canonical subcommands.
