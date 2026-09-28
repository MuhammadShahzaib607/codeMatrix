import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'rename-retry-'))
process.env.WORKSPACES_ROOT = tempRoot

const workspaceManager = await import('./src/utils/workspaceManager.js')
const fileWatcher = await import('./src/utils/fileWatcher.js')
const { adoptScratchProject } = await import('./src/services/scratchProjectService.js')

const {
  registerWorkspaceFolder,
  getWorkspaceRecord,
  getWorkspacePath,
  renameFolderWithRetry,
  renameWorkspaceFolder,
} = workspaceManager
const { startWatchingProject, getWatchedProjectIds, stopWatchingProject, closeAllWatchers } = fileWatcher

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function makeTree(base) {
  await fsp.mkdir(path.join(base, 'css'), { recursive: true })
  await fsp.writeFile(path.join(base, 'index.html'), '<!doctype html>\n<html><body>hi</body></html>\n')
  await fsp.writeFile(path.join(base, 'css', 'style.css'), 'body { color: #111; }\n')
}

async function partA() {
  const base = path.join(tempRoot, 'partA')
  const from = path.join(base, 'src')
  const to = path.join(base, 'dst')
  await makeTree(from)

  let calls = 0
  const flaky = async (a, b) => {
    calls += 1
    if (calls < 3) {
      const error = new Error(`EPERM: operation not permitted, rename '${a}' -> '${b}'`)
      error.code = 'EPERM'
      throw error
    }
    return fsp.rename(a, b)
  }
  const started = Date.now()
  const ok = await renameFolderWithRetry(from, to, flaky)
  const content = await fsp.readFile(path.join(to, 'index.html'), 'utf8')
  check('A1: two EPERM tries then success moves the folder', ok && calls === 3 && content.includes('doctype'), `calls=${calls}`)
  check('A2: retries waited with backoff before the third try', Date.now() - started >= 280, `${Date.now() - started}ms`)

  const from2 = path.join(base, 'src2')
  const to2 = path.join(base, 'dst2')
  await makeTree(from2)
  let calls2 = 0
  const alwaysFail = async (a, b) => {
    calls2 += 1
    const error = new Error('EPERM: operation not permitted')
    error.code = 'EPERM'
    throw error
  }
  const ok2 = await renameFolderWithRetry(from2, to2, alwaysFail)
  const copied = await fsp.readFile(path.join(to2, 'index.html'), 'utf8')
  const copiedCss = await fsp.readFile(path.join(to2, 'css', 'style.css'), 'utf8')
  const sourceGone = !(await fsp.stat(from2).then(() => true, () => false))
  check('A3: all renames fail -> copy fallback still moves every file', ok2 && calls2 === 5 && copied.includes('doctype') && copiedCss.includes('color'), `calls=${calls2}`)
  check('A4: copy fallback removed the original folder', sourceGone)

  const from3 = path.join(base, 'src3')
  const to3 = path.join(base, 'dst3')
  await makeTree(from3)
  let calls3 = 0
  const nonRetryable = async () => {
    calls3 += 1
    const error = new Error('EXDEV: cross-device link not permitted')
    error.code = 'EXDEV'
    throw error
  }
  let threw = null
  await renameFolderWithRetry(from3, to3, nonRetryable).catch((error) => {
    threw = error
  })
  check('A5: a non-retryable error is thrown immediately', threw?.code === 'EXDEV' && calls3 === 1, `calls=${calls3}`)
}

async function partB() {
  const record = registerWorkspaceFolder('scratch-rename-b', { ownerId: 'renamer', displayName: 'Scratch' })
  const oldPath = path.join(tempRoot, record.container, record.folderName)
  await makeTree(oldPath)

  const notifications = []
  const started = startWatchingProject('scratch-rename-b', (id) => notifications.push(id), null)
  check('B1: watcher attached before the rename', started && getWatchedProjectIds().includes('scratch-rename-b'))

  const renamed = await renameWorkspaceFolder('scratch-rename-b', { displayName: 'renamed-project' })
  check('B2: rename with a live watcher succeeds (no EPERM)', renamed.folderName === 'renamed-project', renamed.folderName)
  check('B3: registry points at the new folder', getWorkspaceRecord('scratch-rename-b')?.folderName === 'renamed-project')
  const newPath = getWorkspacePath('scratch-rename-b')
  check('B4: the folder really moved on disk', fs.existsSync(path.join(newPath, 'index.html')))

  await new Promise((resolve) => setTimeout(resolve, 400))
  await fsp.writeFile(path.join(newPath, 'after.txt'), 'x')
  await new Promise((resolve) => setTimeout(resolve, 1400))
  check('B5: watcher resumed against the NEW path', notifications.length > 0, `notifications=${notifications.length}`)
  stopWatchingProject('scratch-rename-b')
}

async function partC() {
  const named = registerWorkspaceFolder('scratch-adopt-c1', { ownerId: 'adapter', folderName: 'modern-static-website' })
  const namedPath = path.join(tempRoot, named.container, named.folderName)
  await makeTree(namedPath)

  const warns = []
  const originalWarn = console.warn
  console.warn = (...args) => warns.push(args.join(' '))

  const resultC1 = await adoptScratchProject({
    projectId: 'scratch-adopt-c1',
    task: 'add 4 more pages',
    userId: 'adapter',
    modelSuggestedName: 'crafted-solutions',
    emit: null,
    fresh: true,
  })
  check('C1: named project + model suggestion -> no rename', getWorkspaceRecord('scratch-adopt-c1')?.folderName === 'modern-static-website', getWorkspaceRecord('scratch-adopt-c1')?.folderName)
  check('C2: adoption reports the existing name and no rename', resultC1?.name === 'modern-static-website' && resultC1?.renamed === false)
  check('C3: the files are still in place', fs.existsSync(path.join(namedPath, 'index.html')))

  const anon = registerWorkspaceFolder('scratch-adopt-c2', { ownerId: 'adapter', displayName: 'Scratch' })
  const anonPath = path.join(tempRoot, anon.container, anon.folderName)
  const resultC2 = await adoptScratchProject({
    projectId: 'scratch-adopt-c2',
    task: 'build a todo app',
    userId: 'adapter',
    modelSuggestedName: 'todo-works',
    fresh: true,
  })
  check('C4: anonymous EMPTY folder is renamed to the model suggestion', resultC2?.renamed === true && resultC2?.name === 'todo-works', resultC2?.name)

  const anon2 = registerWorkspaceFolder('scratch-adopt-c3', { ownerId: 'adapter', displayName: 'Scratch' })
  const anon2Path = path.join(tempRoot, anon2.container, anon2.folderName)
  await makeTree(anon2Path)
  const resultC3 = await adoptScratchProject({
    projectId: 'scratch-adopt-c3',
    task: 'follow-up work',
    userId: 'adapter',
    modelSuggestedName: 'should-not-apply',
    fresh: true,
  })
  const recordC3 = getWorkspaceRecord('scratch-adopt-c3')
  check('C5: anonymous folder WITH files is not renamed', String(recordC3?.folderName ?? '').startsWith('Scratch') && resultC3?.renamed === false, recordC3?.folderName)

  const anon3 = registerWorkspaceFolder('scratch-adopt-c4', { ownerId: 'adapter', displayName: 'Scratch' })
  const resultC4 = await adoptScratchProject({
    projectId: 'scratch-adopt-c4',
    task: 'continue the crash-interrupted task',
    userId: 'adapter',
    modelSuggestedName: null,
    fresh: false,
  })
  check('C6: resume on an anonymous EMPTY folder still gets named', resultC4?.renamed === true && resultC4?.name !== 'Scratch', resultC4?.name)

  console.warn = originalWarn
  check('C7: no adoption warnings were logged for the quiet paths', warns.length === 0, warns.join(' | ').slice(0, 200))
}

async function partD() {
  const anon = registerWorkspaceFolder('scratch-adopt-d1', { ownerId: 'adapter', displayName: 'Scratch' })
  const folderPath = path.join(tempRoot, anon.container, anon.folderName)

  const realRename = fsp.rename
  const realReaddir = fsp.readdir
  let readdirCalls = 0
  fsp.rename = async () => {
    const error = new Error("EPERM: operation not permitted, rename 'locked' -> 'target'")
    error.code = 'EPERM'
    throw error
  }
  fsp.readdir = async (...args) => {
    readdirCalls += 1
    if (readdirCalls > 1) {
      const error = new Error('ENOENT: no such file or directory, scandir')
      error.code = 'ENOENT'
      throw error
    }
    return realReaddir(...args)
  }

  const warns = []
  const originalWarn = console.warn
  console.warn = (...args) => warns.push(args.join(' '))
  const result = await adoptScratchProject({
    projectId: 'scratch-adopt-d1',
    task: 'locked folder task',
    userId: 'adapter',
    modelSuggestedName: 'locked-name',
    fresh: true,
    emit: () => {},
  }).catch((error) => ({ threw: error }))
  console.warn = originalWarn
  fsp.rename = realRename
  fsp.readdir = realReaddir

  const stillThere = fs.existsSync(folderPath)
  const record = getWorkspaceRecord('scratch-adopt-d1')
  const targetGone = !fs.existsSync(path.join(tempRoot, anon.container, 'locked-name'))
  check('D1: a locked folder does not throw out of adoption', !result?.threw, result?.threw?.message)
  check('D2: adoption reports not-renamed after the failed rename', result?.renamed === false && result?.adopted === false)
  check('D3: exactly one warning was logged', warns.length === 1, warns.join(' | ').slice(0, 240))
  check('D4: the folder survived at the old path', stillThere)
  check('D5: registry still points at the old folder', record?.folderName === anon.folderName, record?.folderName)
  check('D6: no half-copied target folder was left behind', targetGone)
  check('D7: all five rename retries ran before the fallback', readdirCalls >= 2, `readdirCalls=${readdirCalls}`)
}

await partA()
await partB()
await partC()
await partD()
await closeAllWatchers()

console.log(`\n${passed}/${passed + failed} checks passed`)
await fsp.rm(tempRoot, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
