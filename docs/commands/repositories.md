# Repositories

## `socket repository`

Manage repository records for an organization:

| Command                    | Purpose                                                   | Example                                                                |
| -------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `repository create <REPO>` | Register a repository.                                    | `socket repository create example-repo`                                |
| `repository view <REPO>`   | Show one registered repository.                           | `socket repository view example-repo`                                  |
| `repository list`          | List registered repositories with pagination and filters. | `socket repository list --page 1`                                      |
| `repository update <REPO>` | Change repository metadata.                               | `socket repository update example-repo --homepage https://example.com` |
| `repository del <NAME>`    | Delete a repository record.                               | `socket repository del example-repo`                                   |

View and list read repository records. Create, update, and delete change Socket
organization data and require API access. Create and update can set the default
branch, URL, description, and visibility. Create defaults visibility to private.

The root alias `repo` and hidden aliases `repos` and `repositories` route to
`repository`.
