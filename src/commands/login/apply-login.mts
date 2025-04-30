import { updateConfigValue } from '../../utils/config.mts'

export function applyLogin(
  apiToken: string,
  enforcedOrgs: string[],
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined
) {
  updateConfigValue('enforcedOrgs', enforcedOrgs)
  updateConfigValue('apiToken', apiToken)
  updateConfigValue('apiBaseUrl', apiBaseUrl)
  updateConfigValue('apiProxy', apiProxy)
}
