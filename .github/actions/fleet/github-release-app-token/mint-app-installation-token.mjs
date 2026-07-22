/*
 * @file Mint a short-lived GitHub App installation token. Dep-0 (node: builtins
 * only) so it runs in CI before any install, and shipped as plain .mjs (no TS
 * type-stripping) so it never depends on the runner's Node version. Co-located
 * inside each app-token composite action and invoked via
 * `node "${{ github.action_path }}/mint-app-installation-token.mjs"`, so it
 * travels with the action when a member consumes it cross-repo
 * (`uses: ./.github/actions/fleet/<x>`) — the action's
 * own directory is always fetched, unlike a `scripts/` path that would resolve
 * against the consumer's checkout. RS256 JWT (iss = the app Client ID) -> the
 * org installation -> an installation token scoped by the PERMISSIONS env. The
 * token is masked, then handed back via $GITHUB_OUTPUT. Least-privilege is the
 * fleet check's contract, not GitHub's: zizmor's github-app audit recognizes
 * create-github-app-token's `permission-*` inputs, not this minter, so
 * scripts/fleet/check/app-tokens-are-scoped.mts is the sole enforcement that
 * every action passes a scoped (non-blank) PERMISSIONS.
 *
 * Env:
 *   CLIENT_ID       (required) the GitHub App Client ID
 *   APP_PRIVATE_KEY (required) the app private key (PEM)
 *   OWNER           (required) org/owner to mint the installation token for
 *   PERMISSIONS     (optional) JSON object, e.g. {"contents":"write"}; an empty
 *                              object is rejected (would mint blanket perms)
 *   REPOSITORIES    (optional) newline/comma repo NAMES to scope the token to
 *   GITHUB_OUTPUT   (required) set by the runner; token is written here.
 */

import crypto from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { request } from 'node:https'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

function die(message) {
  process.stderr.write(`[mint-app-token] ${message}\n`)
  process.exit(1)
}

function env(name) {
  const value = process.env[name]
  if (!value) {
    die(
      `required env ${name} is not set. ` +
        `Where: the app-token composite action's env block. ` +
        `Fix: pass ${name} via the action's env (CLIENT_ID/OWNER from inputs, ` +
        `APP_PRIVATE_KEY from the secret).`,
    )
  }
  return value
}

function gh(method, path, jwt, body) {
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${jwt}`,
    'user-agent': 'socket-fleet-app-token',
    'x-github-api-version': '2022-11-28',
  }
  if (body !== undefined) {
    headers['content-length'] = String(Buffer.byteLength(body))
    headers['content-type'] = 'application/json'
  }
  return new Promise((resolve, reject) => {
    const req = request(
      { headers, host: 'api.github.com', method, path, port: 443 },
      res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            status: res.statusCode ?? 0,
          }),
        )
      },
    )
    req.setTimeout(15_000, () =>
      req.destroy(new Error(`${method} ${path} timed out`)),
    )
    req.on('error', reject)
    if (body !== undefined) {
      req.write(body)
    }
    req.end()
  })
}

// Parse a PERMISSIONS string (a JSON object) into the access-token request, or
// undefined when blank. Throws on malformed or empty-object input — an empty
// object would mint a blanket-permission token, the opposite of least-privilege.
// Pure (the raw string is the argument) + exported so it is unit-testable.
export function parsePermissions(rawInput) {
  const raw = rawInput?.trim()
  if (!raw) {
    return undefined
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      `PERMISSIONS is not valid JSON. Where: the action's env. ` +
        `Saw: ${raw}. Fix: pass a JSON object like {"contents":"write"}.`,
    )
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length === 0
  ) {
    throw new Error(
      `PERMISSIONS must be a non-empty JSON object. Where: the action's env. ` +
        `Saw: ${raw}. Fix: pass e.g. {"contents":"write"}; an empty object would ` +
        `mint a blanket-permission token.`,
    )
  }
  return parsed
}

// Split a REPOSITORIES string (newline/comma repo NAMES) into the access-token
// request's `repositories` array, or undefined when blank. Pure (the raw string
// is the argument) + exported so it is unit-testable.
export function parseRepositories(rawInput) {
  const raw = rawInput?.trim()
  if (!raw) {
    return undefined
  }
  const names = raw
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean)
  return names.length ? names : undefined
}

async function main() {
  const clientId = env('CLIENT_ID')
  const privateKey = env('APP_PRIVATE_KEY')
  const owner = env('OWNER')
  const permissions = parsePermissions(process.env['PERMISSIONS'])
  const repositories = parseRepositories(process.env['REPOSITORIES'])
  const now = Math.floor(Date.now() / 1000)
  const head = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
  ).toString('base64url')
  const claims = Buffer.from(
    JSON.stringify({ exp: now + 540, iat: now - 60, iss: clientId }),
  ).toString('base64url')
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${head}.${claims}`)
    .sign(privateKey, 'base64url')
  const jwt = `${head}.${claims}.${signature}`

  const inst = await gh(
    'GET',
    `/orgs/${encodeURIComponent(owner)}/installation`,
    jwt,
  )
  if (inst.status !== 200) {
    die(
      `installation lookup failed: HTTP ${inst.status}. ` +
        `Where: GET /orgs/${owner}/installation. Saw: ${inst.body}. ` +
        `Fix: confirm the app (CLIENT_ID) is installed on ${owner}.`,
    )
  }
  const installation = JSON.parse(inst.body)
  const installationId = installation.id
  if (typeof installationId !== 'number') {
    die(`installation lookup returned no id. Saw: ${inst.body}.`)
  }

  const tokenBody = {}
  if (permissions !== undefined) {
    tokenBody.permissions = permissions
  }
  if (repositories !== undefined) {
    tokenBody.repositories = repositories
  }
  const minted = await gh(
    'POST',
    `/app/installations/${installationId}/access_tokens`,
    jwt,
    JSON.stringify(tokenBody),
  )
  if (minted.status !== 201) {
    die(
      `token mint failed: HTTP ${minted.status}. ` +
        `Where: POST /app/installations/${installationId}/access_tokens. ` +
        `Saw: ${minted.body}. Fix: the requested permissions/repositories must be ` +
        `a subset of what the app's installation on ${owner} grants (a 422 means ` +
        `the install lacks a requested scope).`,
    )
  }
  const token = JSON.parse(minted.body).token
  if (!token) {
    die(`token mint returned no token. Saw: ${minted.body}.`)
  }

  process.stdout.write(`::add-mask::${token}\n`)
  appendFileSync(env('GITHUB_OUTPUT'), `token=${token}\n`)

  // Expose the app slug (from the installation lookup) so the caller can build
  // the `<slug>[bot]` committer identity. An installation token cannot call
  // `gh api /user` (403 — it has no user), so the workflow needs the slug to do
  // a by-name `gh api /users/<slug>[bot]` lookup instead.
  const appSlug = installation.app_slug
  if (typeof appSlug === 'string' && appSlug) {
    appendFileSync(env('GITHUB_OUTPUT'), `slug=${appSlug}\n`)
  }
}

// Guard the entry IIFE so importing the module (the unit tests import the pure
// parse fns) does NOT run main(). Run only when invoked directly as the script.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void (async () => {
    try {
      await main()
    } catch (e) {
      // oxlint-disable-next-line socket/prefer-error-message, socket/prefer-error-message-helper -- dep-0: this .mjs uses only node: builtins and runs in CI BEFORE `pnpm install`, so it cannot import errorMessage() from the external @socketsecurity/lib.
      die(e instanceof Error ? e.message : String(e))
    }
  })()
}
