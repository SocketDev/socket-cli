import { optimize } from 'svgo'

/** Preserve terminal layout and paint with a conservative plugin list. */
export function optimizeSvg(svg: string): string {
  return optimize(svg, {
    multipass: false,
    plugins: [
      'removeDoctype',
      'removeXMLProcInst',
      'removeComments',
      'removeMetadata',
      {
        name: 'convertColors',
        params: { currentColor: false, rgb2hex: false },
      },
    ],
  }).data
}
