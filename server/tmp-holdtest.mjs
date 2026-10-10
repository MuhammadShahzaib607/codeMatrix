import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const base = path.resolve('sandbox-hold')

function reset() {
  try { fs.rmSync(base, { recursive: true, force: true }) } catch {}
  fs.mkdirSync(base, { recursive: true })
  fs.writeFileSync(path.join(base, 'a.txt'), 'a'.repeat(50))
}

function probe(label) {
  const renameResult = (() => {
    try {
      fs.renameSync(base, `${base}-x`)
      fs.renameSync(`${base}-x`, base)
      return 'OK'
    } catch (error) {
      if (fs.existsSync(`${base}-x`)) {
        try { fs.renameSync(`${base}-x`, base) } catch {}
      }
      return error.code
    }
  })()
  const rmResult = (async () => {
    try {
      await fs.promises.rm(base, { recursive: true, force: true, maxRetries: 0 })
      return 'OK'
    } catch (error) {
      return error.code
    }
  })()
  return rmResult.then((rm) => `${label}: rename=${renameResult} rm=${rm}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

reset()
console.log(await probe('baseline (no holder)'))

reset()
const cmd = spawn('cmd.exe', ['/d', '/s', '/c', 'timeout /t 60 /nobreak'], { cwd: base, stdio: 'ignore' })
await sleep(500)
console.log(await probe('cmd cwd inside'))
cmd.kill()
await sleep(300)

reset()
const bash = spawn('C:/Program Files/Git/bin/bash.exe', ['-c', 'sleep 60'], { cwd: base, stdio: 'ignore' })
await sleep(500)
console.log(await probe('bash cwd inside'))
bash.kill()
await sleep(300)

reset()
const python = spawn('python.exe', ['-m', 'http.server', '8099', '--bind', '127.0.0.1'], { cwd: base, stdio: 'ignore' })
await sleep(1200)
console.log(await probe('python http.server cwd inside'))
python.kill()
await sleep(400)

reset()
const chokidar = (await import('chokidar')).default
const watcher = chokidar.watch(base, { ignoreInitial: true, persistent: true, depth: 12 })
await new Promise((resolve) => watcher.on('ready', resolve))
console.log(await probe('chokidar watching'))
await watcher.close()

reset()
const watcher2 = fs.watch(base, { recursive: true })
await sleep(400)
console.log(await probe('fs.watch watching'))
watcher2.close()

reset()
const reader = setInterval(() => {
  try { fs.readdirSync(base) } catch {}
}, 10)
await sleep(300)
console.log(await probe('readdir loop'))
clearInterval(reader)

try { fs.rmSync(base, { recursive: true, force: true }) } catch {}
try { fs.rmSync(`${base}-x`, { recursive: true, force: true }) } catch {}
console.log('DONE')
process.exit(0)
