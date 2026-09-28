export const MAX_STRICT_RULES = 20
export const MAX_STRICT_RULE_LENGTH = 300

function stripControlChars(text) {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0)
    out += code < 32 || code === 127 ? ' ' : char
  }
  return out
}

export function sanitizeStrictRules(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const rules = []
  for (const entry of raw) {
    if (rules.length >= MAX_STRICT_RULES) break
    const source = entry && typeof entry === 'object' ? entry.text : entry
    const text = stripControlChars(String(source ?? ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_STRICT_RULE_LENGTH)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const id = entry && typeof entry === 'object' && typeof entry.id === 'string' ? entry.id.slice(0, 64) : null
    rules.push({ id, text })
  }
  return rules
}

export function buildStrictRulesBlock(rules) {
  const list = Array.isArray(rules) ? rules : []
  if (list.length === 0) return ''
  const lines = list.map((rule, index) => `${index + 1}. ${rule.text}`)
  return (
    'USER STRICT RULES (follow always; they override style preferences, never override safety or the tool protocol):\n' +
    lines.join('\n')
  )
}

export function strictRuleFlags(rules = []) {
  const flags = {
    blockOverwrite: false,
    blockRenameMove: false,
    overwriteRule: null,
    renameRule: null,
  }
  for (const rule of Array.isArray(rules) ? rules : []) {
    const text = String(rule?.text ?? '')
    if (!flags.blockOverwrite && /overwrit/i.test(text)) {
      flags.blockOverwrite = true
      flags.overwriteRule = text
    }
    if (!flags.blockOverwrite && /\bdelete\b/i.test(text) && /\b(existing|files?|folders?)\b/i.test(text)) {
      flags.blockOverwrite = true
      flags.overwriteRule = text
    }
    if (!flags.blockRenameMove && /\b(rename|move)\b/i.test(text) && /\b(files?|folders?|directories)\b/i.test(text)) {
      flags.blockRenameMove = true
      flags.renameRule = text
    }
  }
  return flags
}

const DELETE_COMMAND = /(^|&&|\|\||;)\s*(rm|rmdir|del|erase|rd|remove-item|unlink)\b|\bgit\s+clean\b/i
const MOVE_COMMAND = /(^|&&|\|\||;)\s*(mv|move|ren|rename)\b|\bgit\s+mv\b/i

export function findRuleBlock({ name, args = {}, rules = [], fileExists = () => false }) {
  const flags = strictRuleFlags(rules)
  if (!flags.blockOverwrite && !flags.blockRenameMove) return null
  const target = typeof args.path === 'string' ? args.path : ''
  const command = typeof args.command === 'string' ? args.command : ''

  if (name === 'delete_file' && flags.blockOverwrite && target) {
    return {
      rule: flags.overwriteRule,
      message: `Error: BLOCKED by your strict rule "${flags.overwriteRule}" — deleting "${target}" is not allowed. Use edit_file to replace its content instead, or leave the file alone.`,
    }
  }

  if (name === 'create_file' && flags.blockOverwrite && target && fileExists(target)) {
    return {
      rule: flags.overwriteRule,
      message: `Error: BLOCKED by your strict rule "${flags.overwriteRule}" — "${target}" already exists. Use edit_file to change it or append_to_file to extend it, or pick a new file name.`,
    }
  }

  if (name === 'run_command' && flags.blockOverwrite && command && DELETE_COMMAND.test(command)) {
    return {
      rule: flags.overwriteRule,
      message: `Error: BLOCKED by your strict rule "${flags.overwriteRule}" — this command deletes files: "${command}". Delete nothing; use edit_file to change a file's content instead.`,
    }
  }

  if (name === 'run_command' && flags.blockRenameMove && command && MOVE_COMMAND.test(command)) {
    return {
      rule: flags.renameRule,
      message: `Error: BLOCKED by your strict rule "${flags.renameRule}" — this command renames or moves files: "${command}". Keep every file at its current path and edit it in place.`,
    }
  }

  return null
}
