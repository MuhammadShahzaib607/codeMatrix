import { resolvePortHolder, waitForPortFree } from '../src/utils/portOwner.js'

const port = Number(process.env.PORT) || 4000
const resolved = await resolvePortHolder(port)

if (resolved.status === 'free') {
  console.log(`[predev] Port ${port} is free.`)
  process.exit(0)
}

if (resolved.status === 'held') {
  console.log(
    `[predev] Port ${port} is held by PID ${resolved.pid} (${resolved.name}), which is not this project's CodeMatrix server. Stop that program yourself, then run npm run dev again.`,
  )
  process.exit(1)
}

if (resolved.status === 'failed') {
  console.log(
    `[predev] Port ${port} is held by PID ${resolved.pid} (${resolved.name}) and it could not be stopped.`,
  )
  process.exit(1)
}

console.log(
  `[predev] Stopping stale CodeMatrix server on port ${port} (PID ${resolved.pid}) — ${resolved.reason}.`,
)

if (await waitForPortFree(port)) {
  console.log(`[predev] Port ${port} is now free.`)
  process.exit(0)
}

console.log(`[predev] Port ${port} is still held after stopping PID ${resolved.pid}.`)
process.exit(1)
