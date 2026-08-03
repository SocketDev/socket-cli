import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
const logger = getDefaultLogger()

const express = require('express')
const lodash = require('lodash')

const app = express()

app.get('/', (req, res) => {
  const data = lodash.pick(req.query, ['name', 'age'])
  res.json(data)
})

app.listen(3000, () => {
  logger.log(`Test fixture ${__filename} running on port 3000`)
})
