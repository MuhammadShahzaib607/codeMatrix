// TEMPORARY cleanup (deleted after the run): removes the throwaway accounts this
// session's tests registered in the dev MongoDB, plus their projects, workspace
// folders and .workspaces.json entries. Only test-prefixed emails are touched.
import fs from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import { env } from './src/config/env.js'
import User from './src/models/User.model.js'
import Project from './src/models/Project.model.js'
import { WORKSPACES_ROOT, workspaceOwnerKey } from './src/utils/workspaceManager.js'

const TEST_EMAIL = /^(probe\d*|probe2-\d+|fresh-\d+|ui-e2e-\d+|create-\d+|agent-\d+|ui-agent-\d+|term-e2e-\d+)@example\.com$/

const registryPath = path.join(WORKSPACES_ROOT, '.workspaces.json')
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'))

await mongoose.connect(env.mongoUri)

const users = await User.find({ email: TEST_EMAIL }).select('_id email').lean()
const userIds = users.map((user) => String(user._id))
console.log(`test users: ${users.length}`)

const projects = userIds.length ? await Project.find({ owner: { $in: userIds } }).lean() : []
console.log(`their projects: ${projects.length}`)

let foldersRemoved = 0
const projectIds = new Set(projects.map((project) => project.projectId))

// Legacy scratch ids have no Project document: derive them from the owner id.
for (const userId of userIds) {
  for (const projectId of Object.keys(registry)) {
    if (projectId === `scratch-${userId}` || projectId.startsWith(`scratch-${userId}-`)) {
      projectIds.add(projectId)
    }
  }
}

for (const projectId of projectIds) {
  const record = registry[projectId]
  if (!record) continue
  const folder = path.join(WORKSPACES_ROOT, record.container || '', record.folderName)
  try {
    if (fs.existsSync(folder)) {
      fs.rmSync(folder, { recursive: true, force: true })
      foldersRemoved += 1
    }
  } catch (error) {
    console.warn(`  could not remove ${folder}: ${error.message}`)
  }
  delete registry[projectId]
}

if (projectIds.size) {
  await Project.deleteMany({ projectId: { $in: [...projectIds] } })
}
if (userIds.length) {
  await User.deleteMany({ _id: { $in: userIds } })
}

// Drop now-empty per-user containers.
let containersRemoved = 0
for (const userId of userIds) {
  const container = path.join(WORKSPACES_ROOT, workspaceOwnerKey(userId))
  try {
    if (fs.existsSync(container) && fs.readdirSync(container).length === 0) {
      fs.rmdirSync(container)
      containersRemoved += 1
    }
  } catch {}
}

fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8')

console.log(
  `removed: ${userIds.length} users, ${projectIds.size} project ids, ${foldersRemoved} folders, ${containersRemoved} empty containers`,
)

await mongoose.disconnect()
