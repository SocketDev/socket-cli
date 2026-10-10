import { rmdir, unlink } from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'
import process from 'node:process'

import {
  isRunnerResourceMain,
  readRunnerResource,
  RUNNER_RESOURCE_SCRIPT_META,
  runRunnerResourceMain,
  spawnRunnerResourceCommand,
  writeRunnerResourceResult,
} from './runner-resource-runtime.mts'
import {
  createRunnerResourceStorage,
  refuseRunnerResource as refuseResource,
  RUNNER_SWAP_HEADER_ALLOWANCE as HEADER_ALLOWANCE,
  RUNNER_SWAP_LIMIT as SWAP_LIMIT,
  validateRunnerSwap,
} from './runner-swap-file.mts'
import type { OwnedSwap, RunnerResourceDisk } from './runner-swap-file.mts'
export { createRunnerSwap, validateRunnerSwap } from './runner-swap-file.mts'

const GIB = 1024 ** 3
const RESOURCE_TARGET = 12 * GIB
const DISK_HEADROOM = 7 * GIB
const CGROUP_CONTROLS = ['memory.max', 'memory.swap.max', 'memory.swap.current']

type ReadResource = (path: string) => Promise<string | undefined>
type SwapArea = { path: string; bytes: number }
type ResourceContext = {
  platform: string
  githubActions?: string | undefined
  runnerEnvironment?: string | undefined
}
type ResourceSystem = {
  read: ReadResource
  memory: () => number
  freeDisk: () => Promise<RunnerResourceDisk>
  report: (snapshot: Record<string, number | string>) => void
  create: (bytes: number) => Promise<OwnedSwap>
  validate: (swap: OwnedSwap) => Promise<void>
  command: (command: 'mkswap' | 'swapon', path: string) => Promise<void>
  remove: (swap: OwnedSwap) => Promise<void>
}

function resourceNumber(value: string | undefined): number {
  if (!value || !/^\d+$/u.test(value.trim())) {
    refuseResource('invalid resource metadata')
  }
  const number = Number(value.trim())
  if (!Number.isSafeInteger(number) || number < 0) {
    refuseResource('invalid resource capacity')
  }
  return number
}

function resourceLimit(value: string | undefined): number {
  return value?.trim() === 'max' ? Infinity : resourceNumber(value)
}

function procPath(value: string): string {
  const decoded = value.replace(/\\(?:040|011|012|134)/gu, octal =>
    String.fromCharCode(Number.parseInt(octal.slice(1), 8)),
  )
  if (
    !decoded.startsWith('/') ||
    decoded.includes('\0') ||
    nodePath.posix.normalize(decoded) !== decoded
  ) {
    refuseResource('unsupported resource path')
  }
  return decoded
}

export function parseRunnerSwaps(text: string | undefined): SwapArea[] {
  const lines = text?.trim().split(/\r?\n/u)
  if (
    !lines ||
    lines.shift()?.trim().replace(/\s+/gu, ' ') !==
      'Filename Type Size Used Priority'
  ) {
    refuseResource('invalid active swap table')
  }
  const areas = lines.map(line => {
    const fields = line.trim().split(/\s+/u)
    if (
      fields.length !== 5 ||
      !['file', 'partition'].includes(fields[1]!) ||
      !/^-?\d+$/u.test(fields[4]!)
    ) {
      refuseResource('invalid active swap entry')
    }
    const bytes = resourceNumber(fields[2]) * 1024
    if (
      !Number.isSafeInteger(bytes) ||
      resourceNumber(fields[3]) * 1024 > bytes
    ) {
      refuseResource('invalid active swap size')
    }
    return { __proto__: null, bytes, path: procPath(fields[0]!) }
  })
  if (new Set(areas.map(area => area.path)).size !== areas.length) {
    refuseResource('duplicate active swap entries')
  }
  return areas
}

async function runnerCgroupRoot(read: ReadResource): Promise<string> {
  const mounts = (await read('/proc/self/mountinfo'))
    ?.trim()
    .split(/\r?\n/u)
    .filter(line => line.split(' - ')[1]?.split(' ')[0] === 'cgroup2')
  if (mounts?.length !== 1) {
    refuseResource('ambiguous cgroup mounts')
  }
  const fields = mounts[0]!.split(' - ')[0]!.split(' ')
  if (fields.length < 6 || fields[3] !== '/') {
    refuseResource('hidden cgroup ancestry')
  }
  const root = procPath(fields[4]!)
  const controllers = (
    await read(nodePath.posix.join(root, 'cgroup.controllers'))
  )
    ?.trim()
    .split(/\s+/u)
  if (!controllers?.includes('memory')) {
    refuseResource('unavailable memory controller')
  }
  for (
    let index = 0, { length } = CGROUP_CONTROLS;
    index < length;
    index += 1
  ) {
    if (
      (await read(nodePath.posix.join(root, CGROUP_CONTROLS[index]!))) !==
      undefined
    ) {
      refuseResource('hidden cgroup root limits')
    }
  }
  return root
}

export async function readRunnerCgroupLimits(
  read: ReadResource,
): Promise<{ memory: number; swap: number }> {
  const membership = (await read('/proc/self/cgroup'))?.trim().split(/\r?\n/u)
  if (membership?.length !== 1 || !membership[0]?.startsWith('0::')) {
    refuseResource('unsupported cgroup membership')
  }
  const current = procPath(membership[0].slice(3))
  const root = await runnerCgroupRoot(read)
  let memory = Infinity
  let swap = Infinity
  for (
    let ancestor = current;
    ancestor !== '/';
    ancestor = nodePath.posix.dirname(ancestor)
  ) {
    const directory = nodePath.posix.join(root, ancestor)
    memory = Math.min(
      memory,
      resourceLimit(
        await read(nodePath.posix.join(directory, CGROUP_CONTROLS[0]!)),
      ),
    )
    const swapMax = resourceLimit(
      await read(nodePath.posix.join(directory, CGROUP_CONTROLS[1]!)),
    )
    const swapCurrent = resourceNumber(
      await read(nodePath.posix.join(directory, CGROUP_CONTROLS[2]!)),
    )
    swap = Math.min(swap, Math.max(0, swapMax - swapCurrent))
  }
  return { memory, swap }
}

function activatedRunnerSwap(
  text: string | undefined,
  owned: OwnedSwap,
  added: number,
): number {
  const activated = parseRunnerSwaps(text).find(
    area => area.path === owned.path,
  )
  if (
    !activated ||
    activated.bytes < added - HEADER_ALLOWANCE ||
    activated.bytes > added
  ) {
    refuseResource('unverified swap activation')
  }
  return activated.bytes
}

function runnerSwapDeficit(
  memory: number,
  swap: number,
  swapAllowance: number,
): number {
  if (memory >= RESOURCE_TARGET) {
    return 0
  }
  const requiredSwap = RESOURCE_TARGET - memory
  if (requiredSwap > SWAP_LIMIT) {
    refuseResource('insufficient physical memory')
  }
  if (swapAllowance < requiredSwap) {
    refuseResource('insufficient cgroup swap allowance')
  }
  return swap >= requiredSwap - HEADER_ALLOWANCE ? 0 : requiredSwap - swap
}

type RunnerDiskDetails = {
  mount: string
  path: string
  requiredAdded: number
}

function runnerDiskDetails(
  disk: RunnerResourceDisk,
  memory: number,
  swap: number,
): RunnerDiskDetails {
  const mount = procPath(disk.mount)
  const path = procPath(disk.path)
  if (!Number.isSafeInteger(disk.device) || disk.device < 0) {
    refuseResource('invalid scratch device')
  }
  const requiredSwap = Math.max(0, RESOURCE_TARGET - memory)
  const requiredAdded = Math.max(0, requiredSwap - swap)
  return { mount, path, requiredAdded }
}

function reportRunnerResource(
  system: ResourceSystem,
  limits: { swap: number },
  disk: RunnerResourceDisk,
  details: RunnerDiskDetails,
  memory: number,
  swap: number,
): void {
  system.report({
    activeSwap: swap,
    allowedSwap: Number.isFinite(limits.swap) ? limits.swap : 'max',
    availableDisk: disk.availableBytes,
    device: disk.device,
    filesystemType: disk.filesystemType,
    mount: details.mount,
    path: details.path,
    reserve: DISK_HEADROOM,
    memory,
    requiredAdded: details.requiredAdded,
  })
}

function validateRunnerDisk(
  disk: RunnerResourceDisk,
  details: RunnerDiskDetails,
  added: number,
  memory: number,
): void {
  const free = disk.availableBytes
  if (!Number.isSafeInteger(free) || free - added < DISK_HEADROOM) {
    refuseResource(
      `insufficient disk headroom (memory=${memory} bytes, requiredSwap=${details.requiredAdded} bytes, reserve=${DISK_HEADROOM} bytes, freeDisk=${free} bytes, mount=${details.mount}, path=${details.path}, device=${disk.device})`,
    )
  }
}

async function cleanupFailedRunnerSwap(
  owned: OwnedSwap,
  system: ResourceSystem,
): Promise<void> {
  try {
    const latest = parseRunnerSwaps(await system.read('/proc/swaps'))
    if (!latest.some(area => area.path === owned.path)) {
      await system.validate(owned)
      await system.remove(owned)
    }
  } catch {
    refuseResource('failed activation with unverified cleanup safety')
  }
}

async function activateRunnerSwap(
  owned: OwnedSwap,
  added: number,
  memory: number,
  swap: number,
  system: ResourceSystem,
): Promise<{ status: string; memory: number; swap: number; added: number }> {
  try {
    await system.validate(owned)
    await system.command('mkswap', owned.path)
    await system.validate(owned)
    await system.command('swapon', owned.path)
    const activated = activatedRunnerSwap(
      await system.read('/proc/swaps'),
      owned,
      added,
    )
    return { status: 'activated', memory, swap: swap + activated, added }
  } catch {
    await cleanupFailedRunnerSwap(owned, system)
    return refuseResource('failed swap activation')
  }
}

export async function prepareRunnerResources(
  context: ResourceContext,
  system: ResourceSystem,
): Promise<{
  status: string
  memory?: number | undefined
  swap?: number | undefined
  added?: number | undefined
}> {
  if (
    context.platform !== 'linux' ||
    context.githubActions !== 'true' ||
    context.runnerEnvironment !== 'github-hosted'
  ) {
    return { status: 'skipped' }
  }
  const limits = await readRunnerCgroupLimits(system.read)
  const memory = Math.min(system.memory(), limits.memory)
  if (!Number.isSafeInteger(memory) || memory <= 0) {
    refuseResource('invalid physical memory')
  }
  const active = parseRunnerSwaps(await system.read('/proc/swaps'))
  const swap = active.reduce((sum, area) => sum + area.bytes, 0)
  if (!Number.isSafeInteger(swap)) {
    refuseResource('invalid total swap capacity')
  }
  const disk = await system.freeDisk()
  const diskDetails = runnerDiskDetails(disk, memory, swap)
  reportRunnerResource(system, limits, disk, diskDetails, memory, swap)
  const added = runnerSwapDeficit(memory, swap, limits.swap)
  if (!added) {
    return { status: 'sufficient', memory, swap, added: 0 }
  }
  validateRunnerDisk(disk, diskDetails, added, memory)
  const owned = await system.create(added)
  return activateRunnerSwap(owned, added, memory, swap, system)
}

export async function runRunnerSwapCommand(
  command: 'mkswap' | 'swapon',
  path: string,
  execute: (
    command: string,
    args: string[],
    options: {
      stdio: 'ignore'
      timeout: number
      throws: false
      killTreeOnTimeout: true
    },
  ) => PromiseLike<{ code: number }> = (nextCommand, args, config) => {
    const safeConfig = { __proto__: null, ...config } as typeof config
    return spawnRunnerResourceCommand(
      nextCommand,
      args,
      safeConfig.stdio,
      safeConfig.timeout,
    )
  },
): Promise<void> {
  try {
    const result = await execute('sudo', ['-n', command, '--', path], {
      stdio: 'ignore',
      timeout: 60_000,
      throws: false,
      killTreeOnTimeout: true,
    })
    if (result.code !== 0) {
      refuseResource('unsuccessful swap command')
    }
  } catch {
    refuseResource('unsuccessful swap command')
  }
}

async function main(): Promise<void> {
  const json = process.argv.includes('--json')
  const result = await prepareRunnerResources(
    {
      platform: process.platform,
      githubActions: process.env['GITHUB_ACTIONS'],
      runnerEnvironment: process.env['RUNNER_ENVIRONMENT'],
    },
    {
      ...createRunnerResourceStorage([
        process.env['RUNNER_TEMP'] ?? '',
        os.tmpdir(),
        '/mnt',
      ]),
      read: readRunnerResource,
      memory: os.totalmem,
      report(snapshot) {
        const output = json ? process.stderr : process.stdout
        output.write(`Runner resource capacity: ${JSON.stringify(snapshot)}\n`)
      },
      validate: validateRunnerSwap,
      command: runRunnerSwapCommand,
      async remove(swap) {
        // oxlint-disable-next-line socket/prefer-safe-delete -- nonrecursive
        await unlink(swap.path)
        // oxlint-disable-next-line socket/prefer-safe-delete -- empty directory
        await rmdir(swap.directory)
      },
    },
  )
  writeRunnerResourceResult(result)
}

if (isRunnerResourceMain(import.meta.url)) {
  await runRunnerResourceMain(main, RUNNER_RESOURCE_SCRIPT_META)
}
