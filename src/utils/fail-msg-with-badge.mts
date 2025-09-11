import colors from 'yoctocolors-cjs'

export function failMsgWithBadge(
  badge: string,
  message: string | undefined,
): string {
  const prefix = colors.bgRedBright(
    colors.bold(colors.red(` ${badge}${message ? ': ' : ''}`)),
  )
  const postfix = message ? ` ${colors.bold(message)}` : ''
  return `${prefix}${postfix}`
}
