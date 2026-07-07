/*
 * @file Canonical Socket automation-bot git identity — the single fleet source
 *   of truth for the name + email that author automated commits and PRs: the
 *   weekly dependency update, the get-green test-fix escalation, npm publishes,
 *   and signed release commits. Before this it was copy-pasted across
 *   socket-registry's setup-git-signing action, publish-npm-packages.mts, and
 *   check-trusted-packages.mts — with THREE divergent values (two name
 *   spellings, three emails), so automated commits attributed to inconsistent
 *   identities. Import from here so every automation surface credits one account.
 *
 *   Fleet-tier (cascaded under scripts/fleet/) so every repo's automation shares
 *   the same identity. Consumers that cannot import a .mts — a GitHub Actions
 *   YAML step, a shell script — read the same values with
 *   `node -p "require('./scripts/fleet/constants/bot-identity.mjs').SOCKET_BOT.email"`
 *   (or mirror them with a comment pointing back here). The .mts is the source.
 *
 *   The numeric-prefixed `users.noreply.github.com` email (the account's id +
 *   login) is what links a commit to the socket-bot GitHub account — its avatar
 *   and profile. A bare `socket-bot@users.noreply.github.com` does NOT link.
 */

export interface GitIdentity {
  readonly name: string
  readonly email: string
}

/**
 * The Socket automation bot. Use for every automated git author / committer and
 * PR identity across the fleet.
 */
export const SOCKET_BOT: GitIdentity = {
  email: '94589996+socket-bot@users.noreply.github.com',
  name: 'Socket Bot',
}

/**
 * `SOCKET_BOT` rendered as the `Name <email>` string git's `--author` flag and
 * a `Co-authored-by:` trailer expect.
 */
export const SOCKET_BOT_AUTHOR: string = `${SOCKET_BOT.name} <${SOCKET_BOT.email}>`
