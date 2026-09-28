import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import chokidar from 'chokidar'

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'eprobe-'))
const dir = path.join(base, 'project')
fs.mkdirSync(path.join(dir, 'css'), { recursive: true })
fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>')
fs.writeFileSync(path.join(dir, 'css', 'style.css'), 'body{}')

function tryRename(label) {
  const target = path.join(base, 'renamed')
  try {
    fs.renameSync(dir, target)
    fs.renameSync(target, dir)
    console.log(`${label}: RENAME OK`)
    return true
  } catch (error) {
    console.log(`${label}: ${error.code} ${error.message.split('\n')[0]}`)
    return false
  }
}

function tryWrite(label) {
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), '<html>updated</html>')
    console.log(`${label}: WRITE OK`)
  } catch (error) {
    console.log(`${label}: WRITE ${error.code} ${error.message.split('\n')[0]}`)
  }
}

async function main() {
  tryRename('baseline (no handles)')

  const watcher = chokidar.watch(dir, { ignoreInitial: true, persistent: true, depth: 12 })
  await new Promise((resolve) => watcher.once('ready', resolve))
  tryRename('chokidar watching the folder')
  tryWrite('while chokidar watches')
  await watcher.close()
  await new Promise((resolve) => setTimeout(resolve, 200))
  tryRename('after watcher.close()')

  const child = spawn(process.env.ComSpec || 'cmd.exe', [], { cwd: dir, stdio: 'ignore' })
  await new Promise((resolve) => setTimeout(resolve, 400))
  tryRename('child process cwd inside folder')
  child.kill()
  await new Promise((resolve) => setTimeout(resolve, 400))
  tryRename('after child exited')

  const handle = fs.openSync(path.join(dir, 'index.html'), 'r')
  tryRename('file inside folder held open (read)')
  fs.closeSync(handle)
  tryRename('after file handle closed')

  const writeHandle = fs.openSync(path.join(dir, 'index.html'), 'r+')
  tryRename('file inside folder held open (r+)')
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), 'x')
    console.log('write to r+-open file: WRITE OK')
  } catch (error) {
    console.log(`write to r+-open file: ${error.code}`)
  }
  fs.closeSync(writeHandle)

  const watcher2 = chokidar.watch(dir, { ignoreInitial: true, persistent: true, depth: 12 })
  await new Promise((resolve) => watcher2.once('ready', resolve))
  const child2 = spawn(process.env.ComSpec || 'cmd.exe', [], { cwd: dir, stdio: 'ignore' })
  await new Promise((resolve) => setTimeout(resolve, 400))
  tryRename('watcher + child cwd together')
  child2.kill()
  await new Promise((resolve) => setTimeout(resolve, 300))
  tryRename('watcher only (child gone)')
  await watcher2.close()
  await new Promise((resolve) => setTimeout(resolve, 200))
  tryRename('all closed')

  fs.rmSync(base, { recursive: true, force: true })
}

main()
