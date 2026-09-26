// TEMPORARY cleanup (deleted after the run): removes everything the agent
// verification created — test workspace folders + registry entries, and the
// matching MongoDB docs (projects, keys, throwaway users).
import fs from 'node:fs'
import path from 'node:path'
import dns from 'node:dns'
import mongoose from 'mongoose'
import 'dotenv/config'

// The default resolver refuses SRV/TXT queries on this machine; point this
// process at 1.1.1.1 (same server nslookup uses successfully).
dns.setServers(['1.1.1.1'])

const WORKSPACES = 'workspaces'
const registryPath = path.join(WORKSPACES, '.workspaces.json')
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'))

const TEST_PROJECT_NAMES = ['agent-e2e', 'ui-agent-app']
const staleEntries = Object.entries(registry).filter(([, record]) =>
  TEST_PROJECT_NAMES.includes(record.folderName),
)
for (const [projectId, record] of staleEntries) {
  const folder = path.join(WORKSPACES, record.container, record.folderName)
  fs.rmSync(folder, { recursive: true, force: true })
  delete registry[projectId]
  console.log('removed folder', folder)
}
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2))

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
const db = mongoose.connection.db

const users = await db
  .collection('users')
  .find({ email: { $regex: /^(bench|keys|other|agent|ui-agent)-\d+@example\.com$/ } })
  .toArray()
const userIds = users.map((user) => user._id)
console.log('test users found:', userIds.length)

const projects = await db.collection('projects').deleteMany({ name: { $in: TEST_PROJECT_NAMES } })
const keys = await db.collection('groqapikeys').deleteMany({ owner: { $in: userIds } })
const userDelete = await db.collection('users').deleteMany({ _id: { $in: userIds } })

console.log('deleted projects:', projects.deletedCount)
console.log('deleted keys:', keys.deletedCount)
console.log('deleted users:', userDelete.deletedCount)

await mongoose.disconnect()
console.log('DONE')
