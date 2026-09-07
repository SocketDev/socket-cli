# STAYS .sh, NOT .mts. It UNSETS variables in the caller's environment, so the
# hook chain must SOURCE it — a node child process can only mutate its own env,
# which dies with it. It also has to run before the first spawn it protects,
# which is earlier than node is reliably on PATH (see resolve-node.sh).
#
# Sanitize placeholder Socket API credentials. Some shell setups export
# `SOCKET_API_TOKEN=literal-value` (or a similar placeholder from onboarding
# docs), which makes Socket Firewall's sfw pnpm-shim return 401 on every
# invocation and block the hook chain before any check runs. A real Socket API
# key is a `sktsec_…` token; anything that doesn't start with `sktsec_` is
# treated as a placeholder and unset for this hook's subprocesses.
#
# Sourced by the fleet commit-msg + pre-commit hooks so the loop lives in ONE
# place. Set SANITIZE_TOKEN_LABEL to a hook name before sourcing to log each
# unset (pre-commit does; commit-msg stays silent).
for var in SOCKET_API_TOKEN SOCKET_API_KEY; do
  eval "val=\${$var}"
  if [ -n "$val" ] && ! printf '%s' "$val" | grep -q '^sktsec_'; then
    if [ -n "${SANITIZE_TOKEN_LABEL:-}" ]; then
      echo "[$SANITIZE_TOKEN_LABEL] unsetting placeholder $var (was: '$val') so pnpm/sfw doesn't 401."
    fi
    unset "$var"
  fi
done
