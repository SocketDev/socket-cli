# disowned-dirt-guard

Stop hook, blocking. Every agent works in its own git worktree, so dirty /
uncommitted / WIP paths in the primary checkout always belong to the session
that is stopping — there is no rival session to hand them to. A turn-end
reply that attributes that state to a "parallel session", "another session",
or a "sibling session" is disowning its own work: the paths never land, and
the excuse survives review because it sounds plausible. The reply gets
rewritten and the dirt gets committed (logical commits, surgical staging) —
or the reply names the concrete blocker instead of a rival session.

- **Trigger:** Stop — scans the last assistant turn's text (code fences
  stripped) for a session-attribution phrase and dirt vocabulary inside one
  sentence window, in either order.
- **Verdict:** blocks so the reply and the dirt get handled, on every
  turn-end including a retry driven by another Stop guard. The demand is
  text-only. The guard reads the reply and never inspects git, so
  rewording the attribution always satisfies it in the same turn, and it can
  never deadlock against a guard that wants the files committed. Whispering
  during a retry is what let the excuse ship: a reply being rewritten for
  `dirty-worktree-stop-guard` is under the most pressure to blame a phantom
  sibling, and that is precisely when `stop_hook_active` is set.
- **Bypass:** `Allow disowned-dirt bypass` — for the rare reply that must
  describe another actor's checkout (a review of a foreign machine, a
  post-mortem quote).

Companions: `dirty-worktree-stop-guard` blocks the dirty tree itself;
`dont-blame-nudge` catches blame aimed at the user or tooling. This guard
closes the remaining lane — blame aimed at a phantom sibling session.
