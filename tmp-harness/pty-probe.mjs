import pty from 'node-pty'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = join(dirname(fileURLToPath(import.meta.url)), '..', 'server')
const code =
  "process.stdout.write('\\u001b[?1000h\\u001b[?1002h\\u001b[?1006h'); process.stdout.write('MARKER_XYZ\\r\\n'); setTimeout(() => {}, 500)"

const child = pty.spawn(process.execPath, ['-e', code], {
  name: 'xterm-256color',
  cols: 100,
  rows: 30,
  cwd,
  env: process.env,
})

let buffer = ''
child.onData((chunk) => {
  buffer += chunk
})

setTimeout(() => {
  console.log('RAW:', JSON.stringify(buffer))
  console.log('has ?1000h:', buffer.includes('?1000h'))
  console.log('has ?1006h:', buffer.includes('?1006h'))
  console.log('has MARKER_XYZ:', buffer.includes('MARKER_XYZ'))
  try {
    child.kill()
  } catch {}
  process.exit(0)
}, 2500)
