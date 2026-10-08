import jwt from 'jsonwebtoken'
import { env } from './src/config/env.js'

const BASE = 'http://localhost:4000'
const OWNER = 'audit-upload-user'
const token = jwt.sign({ id: OWNER }, env.jwtSecret, { expiresIn: '1h' })

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function pngBytes(size = 70) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([header, Buffer.alloc(Math.max(size - header.length, 0), 0x42)])
}

async function upload(pathValue, entries, useToken = token) {
  const form = new FormData()
  form.append('path', pathValue)
  for (const entry of entries) {
    form.append('files', new Blob([entry.bytes], { type: entry.type ?? 'image/png' }), entry.name)
  }
  const res = await fetch(`${BASE}/api/workspace/container/upload`, {
    method: 'POST',
    headers: useToken ? { Authorization: `Bearer ${useToken}` } : {},
    body: form,
  })
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, body: json }
}

const treeRes = await api('GET', '/api/workspace/container/tree')
check('container/tree reachable with minted token', treeRes.status === 200, `status ${treeRes.status}`)

const rootUpload = await upload('', [{ name: 'audit-logo.png', bytes: pngBytes() }])
check('upload to container root -> 201', rootUpload.status === 201, JSON.stringify(rootUpload.body))
const firstPath = rootUpload.body?.files?.[0]?.path
check('root upload lands at top level (no prefix)', firstPath === 'audit-logo.png', String(firstPath))

const dup = await upload('', [{ name: 'audit-logo.png', bytes: pngBytes() }])
const dupName = dup.body?.files?.[0]?.name
check('conflict-free rename on duplicate name', dupName === 'audit-logo (copy).png', String(dupName))

const folder = await api('POST', '/api/workspace/container/entry', {
  name: 'audit-project',
  type: 'folder',
})
const folderName = folder.body?.name
check(
  'create project folder -> 201/200',
  folder.status < 300 && Boolean(folderName),
  `status ${folder.status} name ${folderName}`,
)

const nested = await upload(folderName, [{ name: 'audit-photo.png', bytes: pngBytes() }])
check(
  'upload into a nested project folder -> 201',
  nested.status === 201,
  JSON.stringify(nested.body),
)
check(
  'nested upload path is prefixed with the folder',
  nested.body?.files?.[0]?.path === `${folderName}/audit-photo.png`,
  String(nested.body?.files?.[0]?.path),
)

const afterTree = await api('GET', '/api/workspace/container/tree')
const flat = JSON.stringify(afterTree.body ?? {})
const occurrences = (flat.match(/"name":"audit-logo\.png"/g) ?? []).length
check('uploaded file appears exactly once in the tree', occurrences === 1, `${occurrences} nodes`)

const badType = await upload('', [{ name: 'audit-note.txt', bytes: Buffer.from('hello') }])
check('disallowed type (.txt) -> 400', badType.status === 400, `${badType.status} ${JSON.stringify(badType.body)}`)

const big = await upload('', [{ name: 'audit-big.png', bytes: pngBytes(12 * 1024 * 1024) }])
check('12 MB file -> 413', big.status === 413, `${big.status} ${JSON.stringify(big.body)}`)

const traversal = await upload('', [{ name: '../audit-evil.png', bytes: pngBytes() }])
check('traversal file name -> 400', traversal.status === 400, `${traversal.status} ${JSON.stringify(traversal.body)}`)

const anon = await upload('', [{ name: 'audit-anon.png', bytes: pngBytes() }], null)
check('unauthenticated upload -> 401', anon.status === 401, `${anon.status}`)

const escape = await upload('../other-user', [{ name: 'audit-escape.png', bytes: pngBytes() }])
check('traversal target path -> rejected', escape.status >= 400, `${escape.status} ${JSON.stringify(escape.body)}`)

const raw = await fetch(`${BASE}/api/workspace/container/file/raw?path=audit-logo.png`, {
  headers: { Authorization: `Bearer ${token}` },
})
const rawBuf = Buffer.from(await raw.arrayBuffer())
const original = pngBytes()
check('raw read of a binary asset is byte-for-byte', rawBuf.equals(original), `status ${raw.status}`)
check(
  'raw read sets an image content type',
  String(raw.headers.get('content-type')).includes('image/png'),
  String(raw.headers.get('content-type')),
)

const renameRes = await api('PATCH', '/api/workspace/container/rename', {
  oldPath: `${folderName}/audit-photo.png`,
  newPath: `${folderName}/audit-photo-2.png`,
})
check('rename works on an uploaded binary', renameRes.status < 300, `${renameRes.status}`)

const delRes = await api('DELETE', '/api/workspace/container/delete', {
  path: 'audit-logo (copy).png',
})
check('delete works on an uploaded binary', delRes.status < 300, `${delRes.status}`)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(' | '))
