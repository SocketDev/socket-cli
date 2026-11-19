import { execFileSync } from 'node:child_process'

// Inspect the index so a partially staged fix cannot hide a broken commit.
const { bin } = JSON.parse(
  execFileSync('git', ['show', ':package.json'], { encoding: 'utf8' }),
)
const files = typeof bin === 'string' ? [bin] : Object.values(bin)
const fields = execFileSync(
  'git',
  ['check-attr', '--cached', '-z', 'eol', '--', ...files],
  {
    encoding: 'utf8',
  },
).split('\0')

// With -z, Git emits a NUL-delimited path, attribute, and value for each result.
for (let i = 0; i < fields.length - 1; i += 3) {
  const file = fields[i]
  const eol = fields[i + 2]
  if (eol !== 'lf') {
    console.error(
      `${file}: expected eol=lf for its shebang, got eol=${eol}. Check .gitattributes.`,
    )
    process.exitCode = 1
  }
}
