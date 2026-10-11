import { __testables } from './src/services/agentService.js'

const results = []
function check(name, ok, detail = '') {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`)
}

const blocked = await __testables.executeTool('run_command', { command: 'echo CODEX' }, 'scratch-guest', { allowShell: false })
check('run_command rejected when allowShell=false', blocked?.rejected === true && /not available/i.test(blocked?.text ?? ''), blocked?.text)

const allowed = await __testables.executeTool('run_command', { command: 'echo CODEX_ALLOWED' }, 'scratch-guest', { allowShell: true })
check('run_command not pre-blocked when allowShell=true', !/shell tool is not available/i.test(allowed?.text ?? ''), String(allowed?.text ?? '').slice(0, 80))

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
