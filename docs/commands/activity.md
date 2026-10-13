# Activity and threat data

## `socket analytics`

Read organization or repository analytics. The scope defaults to the
organization, and the time window defaults to 30 days. Supported windows are 7,
30, and 90 days.

```sh
socket analytics org 30
socket analytics repo example-repo 7
```

## `socket audit-log`

Read an organization's audit events. This command requires an Enterprise plan.
Use `--org` to select the organization and `--page` or `--per-page` to paginate.

```sh
socket audit-log --page 1 --per-page 30
```

The root alias `audit` is visible. Hidden aliases include `audit-logs`,
`auditLog`, and `auditLogs`.

## `socket threat-feed`

Read the beta threat feed for the selected organization. Filter by ecosystem,
threat type, package, or version. It requires Socket API access.

```sh
socket threat-feed --per-page 30
```

The root alias `feed` routes to this command.
