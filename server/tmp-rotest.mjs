import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const dir = path.resolve('sandbox-ro')
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })

function attrib(p) {
  const out = spawnSync('attrib', [p.replace(/\//g, '\\')], { encoding: 'utf8' })
  return (out.stdout ?? '').trim() || (out.stderr ?? '').trim()
}

const f1 = path.join(dir, 'a.txt')
fs.writeFileSync(f1, 'a')
spawnSync('attrib', ['+r', f1])
console.log(`attrib +r          -> ${attrib(f1)}`)
try {
  fs.unlinkSync(f1)
  console.log('unlink after +r    -> OK (unexpected)')
} catch (error) {
  console.log(`unlink after +r    -> ${error.code}`)
}
fs.chmodSync(f1, 0o666)
console.log(`after chmod 0666   -> ${attrib(f1)}`)
try {
  fs.unlinkSync(f1)
  console.log('unlink after chmod 0666 -> OK')
} catch (error) {
  console.log(`unlink after chmod 0666 -> ${error.code}`)
}

const f2 = path.join(dir, 'b.txt')
fs.writeFileSync(f2, 'b')
fs.chmodSync(f2, 0o444)
console.log(`chmod 0444         -> ${attrib(f2)}`)

const f3 = path.join(dir, 'c.txt')
fs.writeFileSync(f3, 'c')
console.log(`baseline           -> ${attrib(f3)}`)

const roDir = path.join(dir, 'rodir')
fs.mkdirSync(roDir, { recursive: true })
fs.writeFileSync(path.join(roDir, 'd.txt'), 'd')
spawnSync('attrib', ['+r', path.join(roDir, 'd.txt')])
console.log(`read-only child    -> ${attrib(path.join(roDir, 'd.txt'))}`)
try {
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 0 })
  console.log('fs.rm over read-only child -> OK')
} catch (error) {
  console.log(`fs.rm over read-only child -> ${error.code}`)
}
try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
console.log('DONE')
process.exit(0)
