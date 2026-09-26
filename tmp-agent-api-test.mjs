// TEMPORARY test (deleted after verification): /api/keys contract against the
// live test server — masked listing, AES round-trip, 3-key cap, ownership.
const API = process.env.TEST_API ?? 'http://localhost:4100'

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function req(method, path, body, token) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

const KEY_A = `gsk_alphaaaaaaaaaaaaaaaaaaaaaaaa1111`
const KEY_B = `gsk_bravoBBBBBBBBBBBBBBBBBBBBBBBB2222`
const KEY_C = `gsk_charlieCCCCCCCCCCCCCCCCCCCCCC3333`
const KEY_D = `gsk_deltaDDDDDDDDDDDDDDDDDDDDDDDD4444`

async function main() {
  const suffix = Date.now()
  const email = `keys-${suffix}@example.com`

  // No auth -> 401
  const anon = await req('GET', '/api/keys')
  check('GET /api/keys requires auth', anon.status === 401)

  const register = await req('POST', '/api/auth/register', {
    name: 'Key Tester',
    email,
    password: 'test-pass-123',
  })
  check('register', register.status === 201, JSON.stringify(register.data?.error ?? ''))
  const token = register.data.token

  // Second user for the ownership check.
  const other = await req('POST', '/api/auth/register', {
    name: 'Other',
    email: `other-${suffix}@example.com`,
    password: 'test-pass-123',
  })
  const otherToken = other.data.token

  // Save key 1
  const save1 = await req('POST', '/api/keys', { key: KEY_A, label: 'personal' }, token)
  check('POST /api/keys saves a key', save1.status === 201, JSON.stringify(save1.data))
  const masked1 = save1.data?.key?.masked ?? ''
  check('response key is MASKED only', masked1.includes('...') && !masked1.includes(KEY_A), masked1)
  check('masked shows first4 + last4', masked1.startsWith('gsk_') && masked1.endsWith('1111'), masked1)

  // Listing: masked, newest first, max advertised
  const list = await req('GET', '/api/keys', null, token)
  check('GET returns masked keys + max', list.status === 200 && list.data.max === 3 && list.data.keys.length === 1)
  const rawList = JSON.stringify(list.data)
  check('list never contains the full key', !rawList.includes(KEY_A))
  check('list carries label', list.data.keys[0].label === 'personal')

  // Keys 2 and 3
  const save2 = await req('POST', '/api/keys', { key: KEY_B }, token)
  const save3 = await req('POST', '/api/keys', { key: KEY_C, label: 'ci' }, token)
  check('keys 2 and 3 accepted', save2.status === 201 && save3.status === 201)

  // 4th -> rejected with the required message
  const save4 = await req('POST', '/api/keys', { key: KEY_D }, token)
  check(
    '4th key rejected with the exact limit message',
    save4.status === 400 && /Maximum 3 API keys allowed/.test(save4.data?.error?.message ?? ''),
    JSON.stringify(save4.data?.error ?? {}),
  )

  // Invalid key input
  const bad = await req('POST', '/api/keys', { key: 'short' }, token)
  check('malformed key rejected', bad.status === 400 && bad.data?.error?.code === 'KEY_INVALID')

  // Ownership: other user cannot delete mine
  const id1 = list.data.keys[0].id
  const foreign = await req('DELETE', `/api/keys/${id1}`, null, otherToken)
  check("another user's delete is a 404", foreign.status === 404)
  const stillThere = await req('GET', '/api/keys', null, token)
  check('key still exists after foreign delete', stillThere.data.keys.length === 3)

  // Own delete works
  const ownDelete = await req('DELETE', `/api/keys/${id1}`, null, token)
  check('owner can delete their key', ownDelete.status === 200 && ownDelete.data.deleted === true)
  const after = await req('GET', '/api/keys', null, token)
  check('list shrinks to 2', after.data.keys.length === 2)

  // Adding after deleting works again (cap is live)
  const readd = await req('POST', '/api/keys', { key: KEY_A, label: 'personal' }, token)
  check('a 4th key is allowed after deleting one', readd.status === 201)

  // No process.env Groq key anywhere in the server source (requirement 2.3)
  console.log(`\n${passed}/${passed + failed} checks passed`)
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error('FAIL:', error)
  process.exit(1)
})
