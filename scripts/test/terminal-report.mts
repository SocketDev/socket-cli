import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

type Artifact = { name: string; file: string; kind: string; data: string }
const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

async function filesAt(dir: string): Promise<string[]> {
  const output: string[] = []
  async function visit(current: string): Promise<void> {
    try {
      const entries = await readdir(current, { withFileTypes: true })
      await Promise.all(
        entries.map(async entry => {
          const filename = path.join(current, entry.name)
          if (entry.isDirectory()) {
            await visit(filename)
          } else if (entry.isFile()) {
            output.push(filename)
          }
        }),
      )
    } catch {
      /* Missing artifacts are represented in the report. */
    }
  }
  await visit(dir)
  return output
}

export async function main(): Promise<number> {
  const args = process.argv.slice(2)
  let artifactsDir = path.resolve('build/native-test-artifacts')
  let output = path.join(artifactsDir, 'index.html')
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--artifacts' && args[i + 1]) {
      artifactsDir = path.resolve(args[++i]!)
    } else if (args[i] === '--output' && args[i + 1]) {
      output = path.resolve(args[++i]!)
    } else {
      throw new Error(`Unknown or incomplete argument: ${args[i]}`)
    }
  }
  const records: Artifact[] = []
  const allFiles = await filesAt(artifactsDir)
  const sequences = new Map<
    string,
    { checkpoints: string[]; durations: number[] }
  >()
  const svgs = new Map<string, string>()
  await Promise.all(
    allFiles
      .filter(file => path.basename(file) === 'sequence.json')
      .map(async file => {
        const flow = path.dirname(file)
        try {
          const parsed = JSON.parse(await readFile(file, 'utf8')) as {
            checkpoints?: string[]
            durations?: number[]
          }
          if (
            Array.isArray(parsed.checkpoints) &&
            parsed.checkpoints.every(
              name => typeof name === 'string' && /^[\w.-]+$/.test(name),
            )
          ) {
            sequences.set(flow, {
              checkpoints: parsed.checkpoints,
              durations: Array.isArray(parsed.durations)
                ? parsed.durations
                : [],
            })
          }
        } catch {
          /* malformed receipt is excluded; image files are still shown */
        }
      }),
  )
  await Promise.all(
    allFiles
      .filter(file => path.extname(file).toLowerCase() === '.png')
      .map(async file => {
        const name = path.relative(artifactsDir, file).replaceAll('\\', '/')
        const bytes = await readFile(file)
        records.push({
          name,
          file,
          kind: 'PNG',
          data: `data:image/png;base64,${bytes.toString('base64')}`,
        })
      }),
  )
  await Promise.all(
    allFiles
      .filter(file => path.extname(file).toLowerCase() === '.svg')
      .map(async file => {
        const bytes = await readFile(file)
        svgs.set(
          path.relative(artifactsDir, file).replaceAll('\\', '/'),
          `data:image/svg+xml;base64,${bytes.toString('base64')}`,
        )
      }),
  )
  const statusFile = allFiles.find(
    file => path.basename(file) === 'test-result.json',
  )
  const status = statusFile
    ? (JSON.parse(await readFile(statusFile, 'utf8')) as Record<
        string,
        unknown
      >)
    : {}
  const metadata = allFiles.filter(
    file =>
      /receipt|manifest/i.test(path.basename(file)) && file.endsWith('.json'),
  )
  const receipts = await Promise.all(
    metadata.map(async file => ({
      name: path.relative(artifactsDir, file).replaceAll('\\', '/'),
      value: JSON.parse(await readFile(file, 'utf8')) as Record<
        string,
        unknown
      >,
    })),
  )
  records.sort((a, b) => a.name.localeCompare(b.name))
  const assetIds = new Map<string, string>()
  const assets: Array<{ id: string; data: string }> = []
  const assetId = (data: string): string => {
    const existing = assetIds.get(data)
    if (existing) {
      return existing
    }
    const id = `asset-${assets.length}`
    assetIds.set(data, id)
    assets.push({ id, data })
    return id
  }
  const cards = records
    .map(item => {
      const flow = path.dirname(path.join(artifactsDir, item.name))
      const stem = path.basename(item.file, '.png')
      const order = sequences.get(flow)?.checkpoints.indexOf(stem) ?? -1
      const duration =
        order >= 0 ? sequences.get(flow)?.durations[order] : undefined
      return { ...item, order, duration }
    })
    .sort((a, b) => {
      const flowA = path.dirname(path.join(artifactsDir, a.name))
      const flowB = path.dirname(path.join(artifactsDir, b.name))
      return (
        flowA.localeCompare(flowB) ||
        (a.order < 0 ? Number.MAX_SAFE_INTEGER : a.order) -
          (b.order < 0 ? Number.MAX_SAFE_INTEGER : b.order) ||
        a.name.localeCompare(b.name, undefined, { numeric: true })
      )
    })
    .map(item => {
      const svg = svgs.get(item.name.replace(/\.png$/i, '.svg'))
      const flowName = path.basename(path.dirname(item.name))
      const helpCard =
        /^socket-help(?:-.+)?$/.test(flowName) ||
        /^socket-patch-.+-help$/.test(flowName)
      const pngAsset = assetId(item.data)
      const svgAsset = svg ? assetId(svg) : undefined
      const captureLabel =
        item.order >= 0
          ? `Checkpoint ${item.order + 1}${typeof item.duration === 'number' ? ` · ${item.duration} ms` : ''}`
          : 'Legacy capture (no sequence metadata)'
      return `<article class="${helpCard ? 'help-card' : ''}" data-name="${esc(item.name.toLowerCase())}"><h2>${esc(item.name)}</h2><a target="_blank" rel="noopener noreferrer" data-view-asset="${pngAsset}" aria-label="Open ${esc(item.name)} PNG in a new tab"><img loading="lazy" data-image-asset="${pngAsset}" alt="${esc(item.name)}"></a><p>${captureLabel} · <a target="_blank" rel="noopener noreferrer" data-view-asset="${pngAsset}">Open PNG</a> · <a data-download-asset="${pngAsset}" download="${esc(path.basename(item.file))}">Download PNG</a>${svgAsset ? ` · <a target="_blank" rel="noopener noreferrer" data-view-asset="${svgAsset}" aria-label="Open ${esc(item.name)} SVG snapshot in a new tab">Open SVG snapshot</a> · <a data-download-asset="${svgAsset}" download="${esc(path.basename(item.file).replace(/\.png$/i, '.svg'))}">Download SVG snapshot</a>` : ''}</p></article>`
    })
    .join('\n')
  const animations = [...svgs.entries()]
    .filter(([name]) => path.basename(name) === 'animation.svg')
    .map(([name, data]) => {
      const id = assetId(data)
      return `<article data-name="${esc(name.toLowerCase())}"><h2>${esc(name)} · animation</h2><a target="_blank" rel="noopener noreferrer" data-view-asset="${id}" aria-label="Open ${esc(name)} animation in a new tab"><img data-image-asset="${id}" alt="${esc(name)} animation"></a><p><a target="_blank" rel="noopener noreferrer" data-view-asset="${id}">Open animated SVG</a> · <a data-download-asset="${id}" download="animation.svg">Download animated SVG</a></p></article>`
    })
    .join('\n')
  const assetManifest = JSON.stringify(assets).replaceAll('<', '\\u003c')
  const sha = process.env['GITHUB_SHA'] ?? 'unknown'
  const platform =
    typeof status['platform'] === 'string'
      ? status['platform']
      : `${process.platform}/${process.arch}`
  const statusLabel =
    status['status'] === 'passed'
      ? 'passed'
      : `not a passing run (${String(status['status'] ?? 'unknown')})`
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Native terminal screenshots</title><style>body{font:15px system-ui;max-width:1200px;margin:2rem auto;padding:0 1rem;color:#18212b}header{position:sticky;top:0;background:#fff;padding:1rem 0;border-bottom:1px solid #ccd3da}input{padding:.6rem;width:min(32rem,80vw)}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem;margin-top:1rem}article{border:1px solid #d5dce2;border-radius:8px;padding:.8rem;min-width:0}.help-card{grid-column:1/-1}h2{font-size:1rem;overflow-wrap:anywhere}table{border-collapse:collapse}th,td{padding:.35rem .7rem;border:1px solid #ccd3da;text-align:left}img{display:block;width:100%;max-width:100%;height:auto;max-height:720px;object-fit:contain;background:#f1f3f5}.help-card img{max-height:none}p{font-size:.8rem;color:#53606c}</style><header><h1>Native terminal screenshots</h1><p>Source commit: ${esc(String(status['sourceCommit'] ?? sha))} · runner: ${esc(platform)} · screenshot tests: ${esc(statusLabel)}</p><p>Signing: ${esc(String(status['signingMode'] ?? 'unknown'))} · source: ${esc(String(status['sourceSha256'] ?? 'unknown'))} · binary: ${esc(String(status['binarySha256'] ?? 'unknown'))}</p><label>Search command or checkpoint <input id="q" type="search" placeholder="Search"></label><h2>Platform validation</h2><table><thead><tr><th>Platform</th><th>Screenshot tests</th><th>Signing</th></tr></thead><tbody><tr><td>${esc(String(status['platform'] ?? platform))}</td><td>${esc(statusLabel)}</td><td>${esc(String(status['signingMode'] ?? 'unknown'))}</td></tr></tbody></table></header><details><summary>Build receipts (${receipts.length})</summary><pre>${esc(JSON.stringify(receipts, null, 2))}</pre></details><main>${animations}${cards || '<p>No PNG captures found.</p>'}</main><script type="application/json" id="asset-manifest">${assetManifest}</script><script>const assets=JSON.parse(document.querySelector('#asset-manifest').textContent);const urls=new Map;for(const asset of assets){const match=asset.data.match(/^data:([^;,]+);base64,(.*)$/s);if(!match)continue;const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));urls.set(asset.id,URL.createObjectURL(new Blob([bytes],{type:match[1]})))}document.querySelectorAll('[data-image-asset]').forEach(image=>{const url=urls.get(image.dataset.imageAsset);if(url)image.src=url});document.querySelectorAll('[data-view-asset]').forEach(link=>{const url=urls.get(link.dataset.viewAsset);if(url)link.href=url});document.querySelectorAll('[data-download-asset]').forEach(link=>{const url=urls.get(link.dataset.downloadAsset);if(url)link.href=url});document.querySelector('#q').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('article').forEach(x=>x.hidden=!x.dataset.name.includes(q))})</script></html>`
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, html)
  console.log(`Wrote ${records.length} image(s) to ${output}`)
  return 0
}

if (isMainModule(import.meta.url)) {
  runMain(main, {
    describe:
      'builds a self-contained HTML report from native terminal screenshots',
    help: 'Usage: node scripts/test/terminal-report.mts [--artifacts <dir>] [--output <file>]',
  })
}
