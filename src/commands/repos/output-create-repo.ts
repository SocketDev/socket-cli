import { logger } from '@socketsecurity/registry/lib/logger'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'
export async function outputCreateRepo(
  _data: SocketSdkReturnType<'createOrgRepo'>['data']
): Promise<void> {
  logger.success('Repository created successfully')
}
