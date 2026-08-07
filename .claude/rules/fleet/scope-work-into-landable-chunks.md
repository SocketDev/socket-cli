# Scope work into landable chunks

Decompose a task so each piece can be **verified and committed on its own**, then
land each as it finishes. The unit of work is not "the task" — it is the smallest
change that leaves the tree green.

## The rule

- **Scope first, then edit.** Before a wide change, name the chunks. A chunk is
  landable when it has its own verification (a test, a check, a probe) and leaves
  the gate green without the chunks after it. If a piece cannot be verified alone,
  it is not a chunk — split it differently.
- **Land each chunk before starting the next.** Not "commit at the end". The pile
  of uncommitted edits is the exposure: a reset, a revert, or a peer agent's
  rebase takes all of it, and the bigger the pile the more there is to lose.
- **A mechanical sweep is chunked by BATCH, not by pass.** Run the codemod over a
  handful of files, verify, commit, repeat. A single pass over hundreds of sites
  verified only at the end is one indivisible bet: when the transform is subtly
  wrong, every file has to be unwound together.
- **Verify the transform on the first batch.** A codemod that over-matches does it
  on file 1 as readily as file 300. Reading the first batch's diff costs one
  minute and is the only thing that catches an over-match before it is everywhere.
- **A revert is a signal to shrink, not to retry wider.** If a sweep had to be
  reverted, the next attempt is smaller, not the same size with one more
  condition bolted on.

## Enforcement

- `uncommitted-sweep-nudge` (PostToolUse on Edit/Write) counts the files this
  session has edited since its last commit. Past the threshold it nudges to land
  what is already verifiable and scope the rest, naming the count.
- `land-as-you-go-nudge` is the push-queue twin: this one watches the
  **uncommitted** pile, that one the **unpushed** pile.
- `dirty-worktree-stop-guard` and `stop-means-commit-guard` catch the end state;
  this rule is about not arriving there with a hundred files in hand.

## Why

Two losses in one session, both from the same shape: work sitting uncommitted too
long. A peer agent's reset dropped four commits (recovered by exporting patches),
and a revert of a wide sweep moved the baseline mid-verification.

The sweeps that went wrong were all wide and verified at the end. Three
generations of one codemod over-matched — nested quotes, then a `${indent}`
interpolation counted as code, then backtick parity fooled by a backtick inside a
comment — and each mistake had already touched every file before anything failed.
Nineteen test files had to be restored to a known state. Batched, each would have
been a two-file diff read in a minute.

Related: `worktree-hygiene` (finish a change, then commit it),
`stop-means-finish-the-commit` (a pause means land what is in flight).
