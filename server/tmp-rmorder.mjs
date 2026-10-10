import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const base = path.resolve('sandbox-rm')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function rebuild() {
  try { fs.rmSync(base, { recursive: true, force: true }) } catch {}
  fs.mkdirSync(path.join(base, 'sub'), { recursive: true })
  for (const name of ['one.txt', 'two.txt', 'three.txt']) {
    fs.writeFileSync(path.join(base, name), name)
  }
  fs.writeFileSync(path.join(base, 'sub', 'four.txt'), 'four')
}

rebuild()
fs.chmodSync(path.join(base, 'one.txt'), 0o444)
const attrs = spawnSync('cmd.exe', ['/d', '/s', '/c', `attrib "${path.join(base, 'one.txt')}"`], { encoding: 'utf8' })
console.log(`chmod 0444 -> attrib: ${attrs.stdout?.trim()}`)
const plain = spawnSync('cmd.exe', ['/d', '/s', '/c', `attrib "${path.join(base, 'two.txt')}"`], { encoding: 'utf8' })
console.log(`chmod 0666 -> attrib: ${plain.stdout?.trim()}`)

try {
  fs.unlinkSync(path.join(base, 'one.txt'))
  console.log('unlink of chmod-0444 file: OK (attribute was NOT read-only)')
} catch (error) {
  console.log(`unlink of chmod-0444 file: ${error.code}`)
}

rebuild()
const holder = spawn('python.exe', ['-m', 'http.server', '8098', '--bind', '127.0.0.1'], { cwd: base, stdio: 'ignore' })
await sleep(1200)
try {
  await fs.promises.rm(base, { recursive: true, force: true, maxRetries: 0 })
  console.log('fs.rm with python holder: OK')
} catch (error) {
  console.log(`fs.rm with python holder: ${error.code}`)
}
console.log(`folder exists after failure: ${fs.existsSync(base)}`)
if (fs.existsSync(base)) {
  console.log(`entries left: ${JSON.stringify(fs.readdirSync(base))}`)
  let subEntries = []
  try { subEntries = fs.readdirSync(path.join(base, 'sub')) } catch { subEntries = '(missing)' }
  console.log(`sub entries left: ${JSON.stringify(subEntries)}`)
}
holder.kill()
await sleep(500)
try {
  await fs.promises.rm(base, { recursive: true, force: true, maxRetries: 0 })
  console.log('fs.rm after holder gone: OK')
} catch (error) {
  console.log(`fs.rm after holder gone: ${error.code}`)
}

try { fs.rmSync(base, { recursive: true, force: true }) } catch {}
console.log('DONE')
process.exit(0)
