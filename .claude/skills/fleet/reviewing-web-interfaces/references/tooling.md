# Impeccable Tooling

Impeccable 3.2.1 is a catalogued, opt-in development dependency. It is useful for its
deterministic UI anti-pattern detector and complementary audit/polish workflows.

## Install in a UI-owning Repo

```json
{
  "devDependencies": {
    "impeccable": "catalog:"
  }
}
```

Then run the repository's normal install and invoke the local executable with `pnpm exec`.
Do not run `npx impeccable install`: that writes provider-specific skill and hook payloads
outside the wheelhouse’s canonical template flow.

## Sources

- [Impeccable documentation](https://impeccable.style/docs/)
- [Impeccable package](https://www.npmjs.com/package/impeccable)
