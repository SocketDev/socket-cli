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
- **Verdict:** blocks once so the reply and the dirt get handled; degrades
  to a non-blocking notice when `stop_hook_active` is set, so Stop guards
  never loop.
- **Bypass:** `Allow disowned-dirt bypass` — for the rare reply that must
  describe another actor's checkout (a review of a foreign machine, a
  post-mortem quote).

Companions: `dirty-worktree-stop-guard` blocks the dirty tree itself;
`dont-blame-nudge` catches blame aimed at the user or tooling. This guard
closes the remaining lane — blame aimed at a phantom sibling session.
