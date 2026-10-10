import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const dir = path.resolve('sandbox-signal')
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
const log = path.join(dir, 'signal.log')
const child = path.join(dir, 'victim.mjs')

fs.writeFileSync(
  child,
  `
import fs from 'node:fs'
fs.appendFileSync(${JSON.stringify(log)}, 'START pid=' + process.pid + '\\n')
process.on('SIGINT', () => { fs.appendFileSync(${JSON.stringify(log)}, 'GOT_SIGINT\\n'); process.exit(7) })
process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(log)}, 'GOT_SIGTERM\\n'); process.exit(8) })
setInterval(() => {}, 1000)
`,
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function readLog() {
  try { return fs.readFileSync(log, 'utf8').trim() } catch { return '' }
}
function alive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function trial(label, stopFn) {
  fs.writeFileSync(log, '')
  const proc = spawn(process.execPath, [child], { stdio: 'ignore' })
  await sleep(700)
  const pid = proc.pid
  const outcome = await stopFn(pid)
  await sleep(900)
  const stillAlive = alive(pid)
  console.log(`--- ${label}`)
  console.log(`    stopFn -> ${outcome}`)
  console.log(`    log    -> ${JSON.stringify(readLog())}`)
  console.log(`    alive  -> ${stillAlive}`)
  if (stillAlive) {
    spawnSync('taskkill', ['/F', '/PID', String(pid)])
  }
  proc.kill()
  await sleep(200)
}

await trial('taskkill without /F', (pid) => {
  const out = spawnSync('taskkill', ['/PID', String(pid)], { encoding: 'utf8' })
  return `status=${out.status} ${(out.stdout ?? out.stderr ?? '').trim().replace(/\s+/g, ' ')}`
})

await trial('taskkill /T without /F', (pid) => {
  const out = spawnSync('taskkill', ['/T', '/PID', String(pid)], { encoding: 'utf8' })
  return `status=${out.status} ${(out.stdout ?? out.stderr ?? '').trim().replace(/\s+/g, ' ')}`
})

await trial('node process.kill SIGTERM', async (pid) => {
  try {
    process.kill(pid, 'SIGTERM')
    return 'sent'
  } catch (error) {
    return `error ${error.code}`
  }
})

await trial('node process.kill SIGINT', async (pid) => {
  try {
    process.kill(pid, 'SIGINT')
    return 'sent'
  } catch (error) {
    return `error ${error.code}`
  }
})

fs.rmSync(dir, { recursive: true, force: true })
console.log('DONE')
process.exit(0)
