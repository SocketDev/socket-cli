import colors from 'yoctocolors-cjs'

export function failMsgWithBadge(
  badge: string,
  msg: string | undefined
): string {
  return `${colors.bgRed(colors.bold(colors.white(` ${badge}${msg ? ': ' : ''}`)))}${msg ? ' ' + colors.bold(msg) : ''}`
}
