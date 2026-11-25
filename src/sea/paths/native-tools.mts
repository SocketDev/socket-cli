import { SEA_RESOURCES_DIRECTORY } from './archive.mts'

export const SEA_NODE_LICENSE_PATH = 'node-runtime-LICENSE'
export const SEA_SOCKET_PATCH_LICENSE_PATH = `${SEA_RESOURCES_DIRECTORY}/socket-patch-LICENSE.txt`

const TOOL_DIRECTORIES = {
  node: 'tools/node',
  'socket-patch': SEA_RESOURCES_DIRECTORY,
  uv: 'tools/uv',
} as const

export type SeaNativeTool = keyof typeof TOOL_DIRECTORIES

export function seaNativeToolPaths(id: SeaNativeTool, platform: string) {
  const directory = TOOL_DIRECTORIES[id]
  return {
    binary: `${directory}/${id}${platform === 'win32' ? '.exe' : ''}`,
    digest: `${directory}/${id}.sha256`,
  }
}
