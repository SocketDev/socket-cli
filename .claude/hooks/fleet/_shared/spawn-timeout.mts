// Timeout (ms) for a LOCAL process spawn — git, `gh auth`, actionlint, etc.
// Windows process creation is markedly slower than POSIX: a `.cmd`/`.bat` shim
// launches through cmd.exe and there is no cheap fork, and parallel CI load
// amplifies it. A timeout that is comfortable on POSIX can therefore KILL a
// slow-but-alive process on win32 — and for a PreToolUse guard that spawns
// `git` to decide whether to fire, a killed probe reads as empty output and the
// guard SILENTLY FAILS OPEN (the gh-token-hygiene storage check did exactly
// that under windows CI load). Give win32 headroom; POSIX keeps the base.
//
// Use this ONLY for local process-spawn timeouts. Do NOT wrap a NETWORK timeout
// (an httpJson / `gh api` call): those must stay bounded so a blackout can't
// hang the caller, and scaling a network budget by platform is simply wrong.
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'

// A win32 process spawn runs single-digit-x slower than POSIX under CI load; 6x
// turns the fleet's standard 5s git probe into 30s on win32 while POSIX stays
// tight. One knob, tunable in a single place as the windows runners change.
const WIN32_SPAWN_TIMEOUT_MULTIPLIER = 6

export function spawnTimeoutMs(baseMs: number): number {
  return WIN32 ? baseMs * WIN32_SPAWN_TIMEOUT_MULTIPLIER : baseMs
}
