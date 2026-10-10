import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const dir = path.resolve('sandbox-watch')
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
const log = path.join(dir, 'watch.log')
const child = path.join(dir, 'watched.mjs')

fs.writeFileSync(
  child,
  `
import fs from 'node:fs'
const tag = 'pid=' + process.pid
const note = (m) => { try { fs.appendFileSync(${JSON.stringify(log)}, tag + ' ' + m + '\\n') } catch {} }
note('START')
process.on('SIGINT', () => { note('SIGINT'); process.exit(0) })
process.on('SIGTERM', () => { note('SIGTERM'); process.exit(0) })
process.on('SIGHUP', () => { note('SIGHUP'); process.exit(0) })
process.on('exit', () => note('EXIT'))
setInterval(() => {}, 1000)
`,
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function readLog() {
  try { return fs.readFileSync(log, 'utf8').trim() } catch { return '' }
}

const watcher = spawn(process.execPath, ['--watch', child], { stdio: 'ignore' })
await sleep(1500)
console.log('after start:\n' + readLog())
fs.writeFileSync(child, fs.readFileSync(child, 'utf8') + '\n// touched\n')
await sleep(2500)
console.log('\nafter touch:\n' + readLog())
watcher.kill()
await sleep(500)
try { watcher.kill('SIGKILL') } catch {}
console.log('\nfinal:\n' + readLog())
fs.rmSync(dir, { recursive: true, force: true })
console.log('DONE')
process.exit(0)
