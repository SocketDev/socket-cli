import { babel } from '@rollup/plugin-babel'

export function seaWorkerTypeScript() {
  return babel({
    babelHelpers: 'bundled',
    babelrc: false,
    configFile: false,
    extensions: ['.mts'],
    presets: ['@babel/preset-typescript'],
  })
}
