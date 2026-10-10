import fs from 'node:fs'
import path from 'node:path'

const target = path.resolve(process.argv[2] ?? 'workspaces/u-6ac206d781c7e207307dab35/alex-portfolio')

console.log(`target: ${target}  (${target.length} chars)`)

function probeRename(p, label) {
  const sibling = `${p}.probe-${process.pid}`
  try {
    fs.renameSync(p, sibling)
    fs.renameSync(sibling, p)
    console.log(`  rename OK    ${label}`)
    return true
  } catch (error) {
    if (fs.existsSync(sibling)) {
      try { fs.renameSync(sibling, p) } catch {}
    }
    console.log(`  rename FAIL  ${label}  -> ${error.code}: ${error.message}`)
    return false
  }
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push({ path: full, kind: 'dir' })
      walk(full, out)
    } else {
      out.push({ path: full, kind: 'file' })
    }
  }
  return out
}

console.log('attributes:')
const attrOut = fs.readdirSync(target, { withFileTypes: true }).map((entry) => {
  const full = path.join(target, entry.name)
  const st = fs.statSync(full)
  return `  ${entry.isDirectory() ? 'D' : '-'} mode=${(st.mode & 0o777).toString(8)} ${entry.name}`
})
console.log(attrOut.join('\n'))

console.log('per-entry rename probe:')
const entries = walk(target)
let failures = 0
for (const entry of entries) {
  const ok = probeRename(entry.path, `${entry.kind} ${path.relative(target, entry.path)}`)
  if (!ok) failures += 1
}
console.log(`  ${entries.length} entries probed, ${failures} failed`)

console.log('directory rename probe:')
probeRename(target, 'ROOT')

console.log('DONE')
