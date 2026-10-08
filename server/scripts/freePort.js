import {
  describeProcess,
  findListeningPid,
  isCodeMatrixServer,
  killProcess,
} from '../src/utils/portOwner.js'

const port = Number(process.env.PORT) || 4000
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForPortFree(attempts = 24) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!findListeningPid(port)) return true
    await delay(150)
  }
  return !findListeningPid(port)
}

const pid = findListeningPid(port)

if (!pid) {
  console.log(`[predev] Port ${port} is free.`)
  process.exit(0)
}

if (!(await isCodeMatrixServer(port))) {
  console.log(
    `[predev] Port ${port} is held by PID ${pid} (${describeProcess(pid)}), which is not a CodeMatrix server. Leaving it alone.`,
  )
  process.exit(1)
}

console.log(`[predev] Stopping stale CodeMatrix server on port ${port} (PID ${pid}).`)
killProcess(pid)

if (await waitForPortFree()) {
  console.log(`[predev] Port ${port} is now free.`)
  process.exit(0)
}

console.log(`[predev] Port ${port} is still held after stopping PID ${pid}.`)
process.exit(1)
