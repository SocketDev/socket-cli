import colors from 'yoctocolors-cjs'

export function failMsgWithBadge(badge: string, msg: string): string {
  return `${colors.bgRed(colors.bold(colors.white(` ${badge}: `)))} ${colors.bold(msg)}`
}
