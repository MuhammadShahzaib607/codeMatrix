const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
])

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title'])

const OPTIONAL_CLOSE_ELEMENTS = new Set([
  'li', 'p', 'dt', 'dd', 'option', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
])

const STRUCTURAL_TAGS = new Set([
  'main', 'header', 'footer', 'section', 'article', 'nav', 'aside', 'div',
  'form', 'figure', 'blockquote', 'ul', 'ol', 'table',
])

const ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g

function buildLineIndex(source) {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1)
  }
  return starts
}

function lineFor(starts, index) {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (starts[mid] <= index) low = mid
    else high = mid - 1
  }
  return low + 1
}

function readAttributes(raw) {
  const attrs = {}
  ATTRIBUTE_PATTERN.lastIndex = 0
  let match
  while ((match = ATTRIBUTE_PATTERN.exec(raw)) !== null) {
    const name = match[1].toLowerCase()
    if (attrs[name] === undefined) attrs[name] = match[2].replace(/^["']|["']$/g, '')
  }
  return attrs
}

export function scanHtml(text) {
  const source = String(text ?? '')
  const lineStarts = buildLineIndex(source)
  const tags = []
  let index = 0

  while (index < source.length) {
    const open = source.indexOf('<', index)
    if (open === -1) break

    if (source.startsWith('<!--', open)) {
      const close = source.indexOf('-->', open + 4)
      index = close === -1 ? source.length : close + 3
      continue
    }
    if (source.startsWith('<!', open) || source.startsWith('<?', open)) {
      const close = source.indexOf('>', open)
      index = close === -1 ? source.length : close + 1
      continue
    }
    const nextCharacter = source[open + 1]

    if (nextCharacter === '/') {
      const close = source.indexOf('>', open)
      if (close === -1) break
      const name = source.slice(open + 2, close).trim().toLowerCase().split(/[\s/]/)[0]
      if (name) {
        tags.push({ name, closing: true, selfClosing: false, index: open, end: close + 1, line: lineFor(lineStarts, open), attrs: {} })
      }
      index = close + 1
      continue
    }

    if (!nextCharacter || !/[a-zA-Z]/.test(nextCharacter)) {
      index = open + 1
      continue
    }

    let cursor = open + 1
    let quote = null
    while (cursor < source.length) {
      const character = source[cursor]
      if (quote) {
        if (character === quote) quote = null
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '>') {
        break
      }
      cursor += 1
    }
    if (cursor >= source.length) break

    const raw = source.slice(open + 1, cursor)
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(raw)
    if (!nameMatch) {
      index = cursor + 1
      continue
    }
    const name = nameMatch[1].toLowerCase()
    const selfClosing = /\/\s*$/.test(raw)
    tags.push({ name, closing: false, selfClosing, index: open, end: cursor + 1, line: lineFor(lineStarts, open), attrs: readAttributes(raw) })
    index = cursor + 1

    if (!selfClosing && RAW_TEXT_ELEMENTS.has(name)) {
      const closePattern = new RegExp(`</${name}\\s*>`, 'i')
      const rest = source.slice(index)
      const match = closePattern.exec(rest)
      index = match ? index + match.index + match[0].length : source.length
    }
  }

  return { source, tags, lineFor: (at) => lineFor(lineStarts, at) }
}

export function findSectionBlock(text, id) {
  const target = String(id ?? '').trim()
  if (!target) return null
  const { source, tags } = scanHtml(text)
  const matches = tags.filter(
    (tag) =>
      !tag.closing &&
      !tag.selfClosing &&
      (tag.attrs.id === target || tag.attrs['data-section'] === target),
  )
  if (matches.length === 0) return null
  if (matches.length > 1) return { ambiguous: true }

  const opening = matches[0]
  const startIndex = tags.indexOf(opening)
  let depth = 0
  for (let position = startIndex; position < tags.length; position += 1) {
    const tag = tags[position]
    if (tag.name !== opening.name) continue
    if (!tag.closing) {
      if (!tag.selfClosing) depth += 1
      continue
    }
    depth -= 1
    if (depth === 0) {
      return { start: opening.index, end: tag.end, tagName: opening.name, line: opening.line, endLine: tag.line }
    }
  }
  return { start: opening.index, end: source.length, tagName: opening.name, line: opening.line, unbalanced: true }
}

export function sectionLineRange(text, id) {
  const block = findSectionBlock(text, id)
  if (!block || block.ambiguous) return null
  const { lineFor } = scanHtml(text)
  return {
    startLine: block.line ?? lineFor(block.start),
    endLine: block.endLine ?? lineFor(Math.max(0, block.end - 1)),
  }
}

function structuralProblems(text) {
  const { tags } = scanHtml(text)
  const stack = []
  const problems = []

  for (const tag of tags) {
    if (tag.selfClosing || VOID_ELEMENTS.has(tag.name)) continue
    if (OPTIONAL_CLOSE_ELEMENTS.has(tag.name)) continue
    if (!STRUCTURAL_TAGS.has(tag.name)) continue
    if (!tag.closing) {
      stack.push(tag)
      continue
    }
    if (stack.length === 0) {
      problems.push(`unexpected </${tag.name}> at line ${tag.line} — nothing is open there`)
      continue
    }
    const top = stack[stack.length - 1]
    if (top.name === tag.name) {
      stack.pop()
      continue
    }
    const matchIndex = stack.map((entry) => entry.name).lastIndexOf(tag.name)
    if (matchIndex === -1) {
      problems.push(`unexpected </${tag.name}> at line ${tag.line}; the open element is <${top.name}> opened at line ${top.line} (expected </${top.name}>)`)
      continue
    }
    for (let position = stack.length - 1; position > matchIndex; position -= 1) {
      const unclosed = stack[position]
      problems.push(`<${unclosed.name}> opened at line ${unclosed.line} is never closed before </${tag.name}> at line ${tag.line} (expected </${unclosed.name}>)`)
    }
    stack.length = matchIndex
    stack.pop()
  }

  for (const unclosed of stack) {
    problems.push(`<${unclosed.name}> opened at line ${unclosed.line} is never closed (expected </${unclosed.name}>)`)
  }

  return problems
}

function nestedSectionProblems(text) {
  const { tags } = scanHtml(text)
  const sections = tags.filter(
    (tag) => !tag.closing && !tag.selfClosing && tag.attrs.id && (tag.name === 'section' || tag.name === 'article'),
  )
  if (sections.length < 2) return []
  const problems = []
  for (const outer of sections) {
    const block = findSectionBlock(text, outer.attrs.id)
    if (!block || block.ambiguous) continue
    for (const inner of sections) {
      if (inner === outer) continue
      if (inner.index > block.start && inner.index < block.end) {
        problems.push(`section "#${inner.attrs.id}" (line ${inner.line}) sits inside section "#${outer.attrs.id}" (line ${outer.line}) — a section must only contain its own content and cards`)
      }
    }
  }
  return problems
}

export function sectionStructureProblems(text) {
  return [...new Set([...structuralProblems(text), ...nestedSectionProblems(text)])]
}
