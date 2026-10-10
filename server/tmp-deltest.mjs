import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = path.join(here, 'sandbox')

const results = []
function record(name, detail) {
  results.push({ name, detail })
  console.log(`--- ${name}\n${detail}`)
}

function reset(dir) {
  try {
    fs.rmSync(base, { recursive: true, force: true })
  } catch (error) {
    console.log(`(reset could not fully remove: ${error.code})`)
  }
  fs.mkdirSync(dir, { recursive: true })
  for (const p of [path.join(dir, 'a.txt'), path.join(dir, 'b.txt'), path.join(dir, 'sub')]) {
    try { fs.chmodSync(p, 0o666) } catch {}
  }
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a'.repeat(100))
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b'.repeat(100))
  fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'sub', 'deep', 'c.txt'), 'c'.repeat(100))
}

async function tryRm(dir) {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 0 })
    return 'OK'
  } catch (error) {
    return `${error.code}: ${error.message}`
  }
}

function errnoOf(fn) {
  try {
    fn()
    return 'OK'
  } catch (error) {
    return `${error.code}: ${error.message}`
  }
}

console.log(`node ${process.version}`)

reset(base)
record('A: plain folder rm', await tryRm(base))

reset(base)
fs.chmodSync(path.join(base, 'a.txt'), 0o444)
record('B1: read-only FILE, fs.rm', await tryRm(base))
record('B2: read-only FILE, fs.unlink', errnoOf(() => fs.unlinkSync(path.join(base, 'a.txt'))))
if (fs.existsSync(path.join(base, 'a.txt'))) fs.chmodSync(path.join(base, 'a.txt'), 0o666)

reset(base)
fs.chmodSync(path.join(base, 'sub'), 0o555)
record('B3: read-only DIR, fs.rm', await tryRm(base))
if (fs.existsSync(base)) {
  try { fs.chmodSync(path.join(base, 'sub'), 0o777) } catch {}
}

reset(base)
const holder = spawn('cmd.exe', ['/d', '/s', '/c', 'timeout /t 120 /nobreak'], { cwd: base, stdio: 'ignore', windowsHide: false })
await new Promise((resolve) => setTimeout(resolve, 600))
record('C1: process cwd inside, fs.rmdir (non-recursive)', errnoOf(() => fs.rmdirSync(base)))
record('C2: process cwd inside, fs.rm recursive', await tryRm(base))
record('C3: process cwd inside, fs.rm then exists', `exists=${fs.existsSync(base)}`)
record('C4: entries left behind', fs.existsSync(base) ? String(fs.readdirSync(base)) : '(gone)')

reset(base)
const holder2 = spawn('cmd.exe', ['/d', '/s', '/c', 'timeout /t 120 /nobreak'], { cwd: base, stdio: 'ignore', windowsHide: false })
await new Promise((resolve) => setTimeout(resolve, 600))
const renameResult = errnoOf(() => fs.renameSync(base, `${base}-renamed`))
record('C5: process cwd inside, fs.rename', renameResult)
if (fs.existsSync(`${base}-renamed`)) {
  const rmAfterRename = await tryRm(`${base}-renamed`)
  record('C6: rm the renamed folder (holder still alive)', rmAfterRename)
}
try { holder2.kill() } catch {}
try { holder.kill() } catch {}
await new Promise((resolve) => setTimeout(resolve, 400))

reset(base)
const chokidar = (await import('chokidar')).default
const watcher = chokidar.watch(base, { ignoreInitial: true, persistent: true })
await new Promise((resolve) => setTimeout(resolve, 800))
record('E: chokidar watching, fs.rm', await tryRm(base))
await watcher.close()

reset(base)
const deepRoot = path.join(base, 'long')
let longDir = deepRoot
for (let i = 0; i < 30; i += 1) {
  longDir = path.join(longDir, `segment-with-a-fairly-long-name-${i}`)
}
fs.mkdirSync(longDir, { recursive: true })
fs.writeFileSync(path.join(longDir, 'deep-file.txt'), 'deep')
const longTarget = path.join(longDir, 'deep-file.txt')
record('F1: long path length', `${longTarget.length} chars`)
record('F2: unlink deep file', errnoOf(() => fs.unlinkSync(longTarget)))
record('F3: rm long root', await tryRm(deepRoot))
if (fs.existsSync(deepRoot)) {
  const prefixed = `\\\\?\\${deepRoot}`
  record('F4: rm long root with \\\\?\\ prefix', await tryRm(prefixed))
}

reset(base)
const netstatTest = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
record('G: netstat works', `status=${netstatTest.status} lines=${String(netstatTest.stdout ?? '').split(/\r?\n/).length}`)

fs.rmSync(base, { recursive: true, force: true })
fs.rmSync(`${base}-renamed`, { recursive: true, force: true })
console.log('\nDONE')
process.exit(0)
