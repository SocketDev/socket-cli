import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { writeFileSync } from 'node:fs'
import { spawnFirewallChild } from '../../../../src/core/firewall/child.mts'

async function runChildFixture() {
  const mode = process.argv[2]
  if (mode === 'foreground') {
    const result = await spawnFirewallChild({
      executable: '/usr/bin/python3',
      args: [
        '-c',
        'import json,os,sys; fd=os.open("/dev/tty",os.O_RDONLY); print(json.dumps({"terminal":os.tcgetpgrp(fd),"process":os.getpgrp()}),file=sys.stderr)',
      ],
      env: {},
    })
    process.exitCode = result.code ?? 1
  } else {
    const operation = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'inherit' },
    )
    void operation.catch(() => {})
    writeFileSync(process.argv[3]!, String(operation.process.pid))
    if (mode === 'exit-with-descendant') {
      process.exit(23)
    }
    setInterval(() => {}, 1000)
  }
}
void runChildFixture()
