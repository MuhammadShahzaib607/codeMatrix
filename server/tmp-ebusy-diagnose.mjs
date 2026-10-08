import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import chokidar from 'chokidar'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, 'tmp-ebusy-root')

function reset(name) {
  const dir = path.join(root, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'alex-portfolio', 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'alex-portfolio', 'index.html'), '<html></html>')
  for (let i = 0; i < 40; i += 1) {
    fs.writeFileSync(path.join(dir, 'alex-portfolio', 'src', `f${i}.js`), 'x')
  }
  return dir
}

async function attempt(label, setup) {
  const dir = reset(label)
  const target = path.join(dir, 'alex-portfolio')
  const cleanup = (await setup(dir, target)) ?? (() => {})
  let result = 'OK'
  try {
    await fs.promises.rm(target, { recursive: true, force: true })
  } catch (error) {
    result = `${error.code}`
  }
  await cleanup()
  console.log(`${label.padEnd(30)} -> ${result}`)
  return result
}

async function main() {
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true })

  await attempt('A no handles', async () => {})

  await attempt('B project+container watchers', async (dir, target) => {
    const watchers = [
      chokidar.watch(target, { ignoreInitial: true, persistent: true }),
      chokidar.watch(dir, { ignoreInitial: true, persistent: true }),
    ]
    await new Promise((resolve) => setTimeout(resolve, 500))
    return async () => {
      await Promise.all(watchers.map((w) => w.close()))
    }
  })

  await attempt('E container watcher only', async (dir) => {
    const watcher = chokidar.watch(dir, { ignoreInitial: true, persistent: true })
    await new Promise((resolve) => setTimeout(resolve, 500))
    return async () => {
      await watcher.close()
    }
  })

  await attempt('F project watcher only', async (dir, target) => {
    const watcher = chokidar.watch(target, { ignoreInitial: true, persistent: true })
    await new Promise((resolve) => setTimeout(resolve, 500))
    return async () => {
      await watcher.close()
    }
  })

  await attempt('C pty cwd inside folder', async (dir, target) => {
    let pty = null
    try {
      const mod = await import('node-pty')
      pty = mod.default ?? mod
    } catch (error) {
      console.log('   (node-pty unavailable: ' + error.message + ')')
      return async () => {}
    }
    const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/bash'
    const p = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: target,
      env: process.env,
      ...(process.platform === 'win32' ? { useConpty: true } : {}),
    })
    await new Promise((resolve) => setTimeout(resolve, 700))
    return () => {
      try {
        p.kill()
      } catch {}
    }
  })

  await attempt('D open file handle inside', async (dir, target) => {
    const handle = fs.openSync(path.join(target, 'index.html'), 'r')
    return () => fs.closeSync(handle)
  })

  await attempt('G watchers closed before rm', async (dir, target) => {
    const watchers = [
      chokidar.watch(target, { ignoreInitial: true, persistent: true }),
      chokidar.watch(dir, { ignoreInitial: true, persistent: true }),
    ]
    await new Promise((resolve) => setTimeout(resolve, 500))
    await Promise.all(watchers.map((w) => w.close()))
    return async () => {}
  })

  fs.rmSync(root, { recursive: true, force: true })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
