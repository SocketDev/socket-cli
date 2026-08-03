# rust-target-sweep-nudge

After a `cargo` Bash command in a checkout that carries a `target/` build dir, nudges the janitor: `node scripts/fleet/rust-target-sweep.mts . --fix`. Cargo build dirs are the quiet disk killers — a 2026-07-31 sweep recovered ~100 GB of stale ones from ~16 checkouts on a machine down to 127 MB free. Non-blocking by design, and the hook never sweeps itself: the sweep script's staleness window (7 days default) is the judge, so an actively rebuilt tree is left alone.
