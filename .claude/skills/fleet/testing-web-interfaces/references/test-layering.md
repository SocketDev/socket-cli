# Test Layering

| Risk | Preferred proof |
| --- | --- |
| Pure rendering, state transitions, and component contracts | Vitest |
| Navigation, real focus behavior, browser APIs, and responsive layout | Playwright or the repository’s established browser layer |
| Pixel-level drift from a locked design | rendered PNG inspection alongside behavior tests |

## Source Map

- [Vitest](https://ui-skills.com/skills/antfu/vitest)
- [Playwright CLI](https://ui-skills.com/skills/microsoft/playwright-cli)

Use the fleet’s established Vitest and Chromium-rendering commands; this skill intentionally
does not introduce a second test harness or package-manager policy.
