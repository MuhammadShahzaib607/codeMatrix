import zlib from 'node:zlib'
import jwt from 'jsonwebtoken'
import { env } from './src/config/env.js'

function extractEntry(zip, name) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd === -1) return null
  const count = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)
  for (let index = 0; index < count; index += 1) {
    const method = zip.readUInt16LE(offset + 10)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const localOffset = zip.readUInt32LE(offset + 42)
    const entryName = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (entryName === name) {
      const localNameLength = zip.readUInt16LE(localOffset + 26)
      const localExtraLength = zip.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const data = zip.subarray(dataStart, dataStart + compressedSize)
      return method === 0 ? data : zlib.inflateRawSync(data)
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return null
}

const BASE = 'http://localhost:4000'
const OWNER = 'audit-preview-user'
const token = jwt.sign({ id: OWNER }, env.jwtSecret, { expiresIn: '1h' })

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function pngBytes() {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([header, Buffer.alloc(100, 0x7f)])
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
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

async function upload(pathValue, name, bytes) {
  const form = new FormData()
  form.append('path', pathValue)
  form.append('files', new Blob([bytes], { type: 'image/png' }), name)
  const res = await fetch(`${BASE}/api/workspace/container/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  return { status: res.status, body: await res.json() }
}

async function fetchPreview(pathAndQuery) {
  const res = await fetch(`${BASE}/preview/${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return { status: res.status, contentType: res.headers.get('content-type'), buf }
}

const created = await api('POST', '/api/workspace/container/entry', {
  name: 'preview-audit',
  type: 'folder',
})
const projectId = created.body?.projectId
const folderName = created.body?.name
check('project folder created', created.status < 300 && Boolean(projectId), JSON.stringify(created.body))

const bytes = pngBytes()
await upload(folderName, 'nested-photo.png', bytes)
const sub = await api('POST', '/api/workspace/container/create', {
  path: `${folderName}/assets`,
  type: 'folder',
})
check('nested assets folder created', sub.status < 300, `${sub.status}`)
await upload(`${folderName}/assets`, 'deep-photo.png', bytes)
await upload('', 'loose-photo.png', bytes)

const siblingFolder = await api('POST', '/api/workspace/container/entry', {
  name: 'preview-sibling',
  type: 'folder',
})
await upload(siblingFolder.body?.name, 'sib-photo.png', bytes)

const inProject = await fetchPreview(`${projectId}/nested-photo.png`)
check('preview serves a project image', inProject.status === 200, `${inProject.status}`)
check('preview image content type is image/png', String(inProject.contentType).includes('image/png'), String(inProject.contentType))
check('preview image is byte-for-byte', inProject.buf.equals(bytes), `${inProject.buf.length} bytes`)

const nested = await fetchPreview(`${projectId}/assets/deep-photo.png`)
check('preview serves an image from a nested folder', nested.status === 200 && nested.buf.equals(bytes), `${nested.status}`)

const sibling = await fetchPreview('loose-photo.png')
check('preview serves a top-level loose (container root) asset', sibling.status === 200 && sibling.buf.equals(bytes), `${sibling.status} ${String(sibling.contentType)}`)

const otherFolder = await fetchPreview(`${siblingFolder.body?.name}/sib-photo.png`)
check(
  'preview serves an asset from a sibling top-level project folder',
  otherFolder.status === 200 && otherFolder.buf.equals(bytes),
  `${otherFolder.status} ${String(otherFolder.contentType)}`,
)

const escape = await fetchPreview('../../server/.env')
check('preview traversal is refused', escape.status >= 400, `${escape.status}`)

const anon = await fetch(`${BASE}/preview/${projectId}/nested-photo.png`)
check('preview without a token -> 401', anon.status === 401, `${anon.status}`)

const zip = await fetch(`${BASE}/api/workspace/${projectId}/export`, {
  headers: { Authorization: `Bearer ${token}` },
})
const zipBuf = Buffer.from(await zip.arrayBuffer())
check('zip export -> 200 application/zip', zip.status === 200 && String(zip.headers.get('content-type')).includes('zip'), `${zip.status}`)
check('zip starts with the PK signature', zipBuf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), zipBuf.subarray(0, 4).toString('hex'))
const text = zipBuf.toString('latin1')
check('zip contains the nested image entry', text.includes('nested-photo.png'), '')
check('zip contains the deep image entry', text.includes('deep-photo.png'), '')
const extracted = extractEntry(zipBuf, 'nested-photo.png')
check('zip nested image inflates byte-for-byte', Boolean(extracted) && extracted.equals(bytes), `${extracted?.length} bytes`)
check('zip does not leak the loose container-root file', !text.includes('loose-photo.png'), '')

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(' | '))
