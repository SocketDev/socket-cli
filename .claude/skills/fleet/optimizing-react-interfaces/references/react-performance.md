# React Performance Routing

| Signal | Investigate first | Avoid |
| --- | --- | --- |
| A control feels slow | interaction trace and component render path | adding memoization before identifying the rerender source |
| A route loads slowly | client bundle, waterfall, and hydration work | splitting code that is already needed on first paint |
| A list stutters | item identity, virtualization threshold, and update scope | virtualizing small lists without measurement |
| A child rerenders unexpectedly | prop identity and state placement | spreading broad state or context through the tree |

## Source Map

- [Vercel React Best Practices](https://ui-skills.com/skills/vercel-labs/react-best-practices)
- [React Doctor](https://ui-skills.com/skills/millionco/react-doctor)

The sources are diagnostic inputs, not automatic rewrite rules. Keep measurements and the
before/after result in the change description when performance work is non-obvious.
