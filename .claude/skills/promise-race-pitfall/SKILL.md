---
name: promise-race-pitfall
description: Reference for the `Promise.race` cross-iteration handler-leak bug. Loads on demand when writing or reviewing concurrency code that uses `Promise.race`, `Promise.any`, or hand-rolled concurrency limiters.
---

# Promise.race in loops — the handler-leak pitfall

**Never re-race the same pool of promises across loop iterations.** Each call to `Promise.race([A, B, …])` attaches fresh `.then` handlers to every arm. A promise that survives N iterations accumulates N handler sets. See [nodejs/node#17469](https://github.com/nodejs/node/issues/17469) and [`@watchable/unpromise`](https://github.com/watchable/unpromise).

## Patterns

- **Safe** — both arms created per call:

  ```ts
  const value = await Promise.race([
    fetchSomething(),
    new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000)),
  ])
  ```

- **Leaky** — `pool` survives across iterations, accumulating handlers:

  ```ts
  while (queue.length) {
    const winner = await Promise.race(pool)  // ← N handlers per arm by iteration N
    pool = pool.filter(p => p !== winner)
  }
  ```

  Same hazard for `Promise.any` and any long-lived arm such as an interrupt signal.

## The fix

Use a single-waiter "slot available" signal. Each task's `.then` resolves a one-shot `promiseWithResolvers` that the loop awaits, then replaces. No persistent pool, nothing to stack.

```ts
let signal = Promise.withResolvers<Task>()
function startTask(task: Task) {
  task.run().then(() => {
    const prev = signal
    signal = Promise.withResolvers<Task>()
    prev.resolve(task)
  })
}
while (queue.length) {
  // launch up to N tasks
  while (running < N && queue.length) startTask(queue.shift()!)
  const finished = await signal.promise
  running -= 1
}
```

The arm being awaited is *always fresh*; nothing accumulates handlers.

## Quick check

Before merging concurrency code, ask: *does any arm of a `Promise.race`/`Promise.any` outlive the call?* If yes, refactor to the single-waiter signal.
