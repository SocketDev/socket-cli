import { logger } from '@socketsecurity/registry/lib/logger'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputUpdateRepo(
  _data: SocketSdkReturnType<'updateOrgRepo'>['data']
): Promise<void> {
  logger.success('Repository updated successfully')
}
