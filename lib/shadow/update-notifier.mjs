// ESM entrypoint doesn't work w/ --require, this needs to be done w/ a spawnSync sadly
import { initUpdateNotifier } from '../utils/update-notifier.js'
initUpdateNotifier()
