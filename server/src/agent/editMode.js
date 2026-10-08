import { scanHtml, sectionStructureProblems } from '../utils/htmlStructure.js'
import {
  existsInWorkspace,
  flattenTree,
  getWorkspaceTree,
  readFileFromWorkspace,
  writeFileToWorkspace,
} from '../utils/workspaceManager.js'
import { queueAgentFsChange } from '../services/agentFsNotifier.js'
import { providerLabel } from '../config/providers.js'
import { buildEditOutline, documentIssues } from './editPipeline.js'

const LOCATE_STEPS = 4
const WRITE_STEPS = 8
const READ_FILE_MAX_CHARS = 12000
const DEFAULT_SUMMARY = 'Updated the page.'

const LOCATE_MODELS = [
  ['mistral', 'mistral-large-latest'],
  ['mistral', 'codestral-latest'],
]
const WRITE_MODELS = [
  ['mistral', 'codestral-latest'],
  ['mistral', 'mistral-large-latest'],
  ['groq', 'openai/gpt-oss-120b'],
]

const LOCATE_SYSTEM_PROMPT = `You locate the exact place in an existing static website that a request must change. You do NOT write the final code here.
You have ONE tool: read_file(path, startLine?, endLine?). Use it to inspect anything you are unsure about.
When you know the answer, reply with ONLY a JSON object (no prose, no markdown fences):
{"files":["index.html"],"problem":"what is wrong or must change","region":{"file":"index.html","sectionId":"faq","lineRange":[start,end],"cssSelectors":[".faq .grid"]},"instruction":"a plain, specific instruction for the writer","newSection":null}
Rules:
- "files" lists the exact file(s) that will change (HTML and, when styling changes, the CSS file).
- "region.sectionId" is the id of the target <section> (or the words header, nav, footer). "region.lineRange" is [startLine,endLine] when the target is not a whole section. "region.cssSelectors" lists the selectors to change when CSS is involved.
- If the request names a section that does not exist, set "newSection": {"type":"gallery","position":"before-footer"} and leave "region.sectionId" null.
- Keep "problem" and "instruction" short and concrete. Do not restate the whole page.`

const WRITER_SYSTEM_PROMPT = `You make exactly the edit you are told to make in an existing static website, and nothing else.
Tools:
- read_file(path, startLine?, endLine?)
- write_file(path, content) — writes the COMPLETE new file contents. Use it for small files or when many scattered parts change.
- replace_text(path, find, replace) — replaces one exact, unique snippet. Prefer this for a focused change. "find" must match the current file exactly and appear exactly once.
Rules:
- Change ONLY the files and region named in the instruction. Never create a file, never touch an unrelated file or section.
- Reuse the existing class names and design system. Do not invent class names without adding their CSS.
- Write real content: no placeholders, no lorem ipsum, no TODO.
- After you finish, reply with one short sentence describing what you changed and NO tool calls.`

const LOCATE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a workspace file, optionally a line range.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          startLine: { type: 'number' },
          endLine: { type: 'number' },
        },
        required: ['path'],
      },
    },
  },
]

const WRITE_TOOLS = [
  ...LOCATE_TOOLS,
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write the complete contents of an existing workspace file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_text',
      description: 'Replace one exact, unique snippet in an existing workspace file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          find: { type: 'string' },
          replace: { type: 'string' },
        },
        required: ['path', 'find', 'replace'],
      },
    },
  },
]

function parseJsonObject(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

function parseToolArgs(raw) {
  if (raw && typeof raw === 'object') return raw
  const text = String(raw ?? '').trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return parseJsonObject(text) ?? {}
  }
}

function normalizePath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .trim()
}

function sliceLines(text, startLine, endLine) {
  const lines = String(text ?? '').split('\n')
  const total = lines.length
  const start = Math.max(1, Math.floor(Number(startLine) || 1))
  const end = Math.min(total, Math.floor(Number(endLine) || total))
  if (start > end) return ''
  return lines.slice(start - 1, end).join('\n')
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function uniqueRange(text, needle) {
  const index = text.indexOf(needle)
  if (index === -1) return null
  if (text.indexOf(needle, index + 1) !== -1) return null
  return { start: index, end: index + needle.length }
}

function whitespaceRange(text, needle) {
  const trimmed = String(needle ?? '').trim()
  if (!trimmed) return null
  const pattern = trimmed.split(/\s+/).map(escapeRegExp).join('\\s+')
  const regex = new RegExp(pattern, 'm')
  const match = regex.exec(text)
  if (!match) return null
  regex.lastIndex = match.index + match[0].length
  if (regex.test(text)) return null
  return { start: match.index, end: match.index + match[0].length }
}

function closestSnippet(text, needle, context = 3) {
  const words = String(needle ?? '')
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 6)
  const lines = String(text ?? '').split('\n')
  for (const word of words) {
    const index = lines.findIndex((line) => line.includes(word))
    if (index !== -1) {
      return lines
        .slice(Math.max(0, index - 1), Math.min(lines.length, index + context))
        .join('\n')
    }
  }
  return lines.slice(0, context).join('\n')
}

function isHtmlPath(filePath) {
  return /\.html?$/i.test(String(filePath ?? ''))
}

function balanceProblems(filePath, text) {
  if (!isHtmlPath(filePath)) return []
  try {
    return sectionStructureProblems(String(text ?? '')).slice(0, 3)
  } catch {
    return []
  }
}

function hasSlotMarkers(text) {
  return /<!--\s*SLOT:/i.test(String(text ?? ''))
}

function buildLocateMessage(task, fileList, outline, cssFiles) {
  return [
    `REQUEST: ${String(task ?? '').trim()}`,
    '',
    'FILES IN THIS PROJECT:',
    ...fileList.slice(0, 40).map((file) => `  ${file}`),
    cssFiles.length > 0 ? '' : null,
    cssFiles.length > 0 ? `STYLESHEETS: ${cssFiles.join(', ')}` : null,
    '',
    'PAGE OUTLINE (each page and its sections):',
    JSON.stringify(outline, null, 2).slice(0, 8000),
    '',
    'Find the exact target. Use read_file if you need more detail, then reply with the JSON object.',
  ]
    .filter((line) => line !== null)
    .join('\n')
}

function parseLocator(raw) {
  const parsed = parseJsonObject(raw)
  if (!parsed) return null
  const files = (Array.isArray(parsed.files) ? parsed.files : [])
    .map(normalizePath)
    .filter(Boolean)
  const region = parsed.region && typeof parsed.region === 'object' ? parsed.region : {}
  const lineRange =
    Array.isArray(region.lineRange) && region.lineRange.length === 2
      ? [Number(region.lineRange[0]), Number(region.lineRange[1])]
      : null
  const result = {
    files,
    problem: String(parsed.problem ?? '').trim(),
    instruction: String(parsed.instruction ?? '').trim(),
    region: {
      file: normalizePath(region.file),
      sectionId: region.sectionId ? String(region.sectionId) : null,
      lineRange,
      cssSelectors: (Array.isArray(region.cssSelectors) ? region.cssSelectors : []).map(String),
    },
    newSection:
      parsed.newSection && typeof parsed.newSection === 'object'
        ? {
            type: String(parsed.newSection.type ?? 'section'),
            position: String(parsed.newSection.position ?? 'before-footer'),
          }
        : null,
  }
  if (result.files.length === 0 && result.region.file) result.files = [result.region.file]
  if (!result.instruction) {
    result.instruction = result.problem || String(parsed.instruction ?? '').trim()
  }
  return result
}

function buildWriteMessage(task, locator, context) {
  const lines = [
    `ORIGINAL REQUEST: ${String(task ?? '').trim()}`,
    `WHAT IS WRONG: ${locator.problem || '(unspecified)'}`,
    `WHAT TO DO: ${locator.instruction || locator.problem || '(unspecified)'}`,
    `TARGET FILE(S): ${(locator.files.length > 0 ? locator.files : [locator.region.file]).join(', ')}`,
    locator.region.sectionId ? `TARGET SECTION: #${locator.region.sectionId}` : null,
    locator.region.cssSelectors.length > 0
      ? `TARGET CSS SELECTORS: ${locator.region.cssSelectors.join(', ')}`
      : null,
    locator.newSection
      ? `A NEW section of type "${locator.newSection.type}" must be added ${locator.newSection.position}.`
      : null,
    '',
    'CURRENT CONTENT:',
    context,
    '',
    'Make the edit with the tools. Change only the target above.',
  ]
  return lines.filter((line) => line !== null).join('\n')
}

export async function runEditModeEdit(deps) {
  const {
    projectId,
    task,
    candidates,
    getActive,
    moveTo,
    advanceCandidate,
    isCooling,
    coolCandidate,
    markKeyCooling,
    markKeyInvalid,
    sendCompletion,
    event,
    agentLog,
    persistSession,
    stopRequested,
    getTaskTotals,
    addToolCalls,
    requestedModel,
    startedAt,
  } = deps

  const progress = (description) =>
    event('note', description, { status: 'done', tool: 'note' })

  const fail = (message, detail) => {
    agentLog({ scope: 'edit', tool: 'abort', message: detail ?? message })
    persistSession?.('edit_failed')
    event('complete', message, {
      status: 'done',
      failed: true,
      durationMs: Date.now() - startedAt,
      model: getActive().model,
      provider: getActive().providerId,
    })
    return {
      message,
      toolCalls: 0,
      durationMs: Date.now() - startedAt,
      model: getActive().model,
      provider: getActive().providerId,
      suggestedName: null,
      gatePassed: false,
      gateSkipped: true,
      editFailed: true,
    }
  }

  const selectStage = (stage) => {
    if (requestedModel) return
    const wanted = stage === 'locate' ? LOCATE_MODELS : WRITE_MODELS
    for (const [providerId, modelName] of wanted) {
      const candidate = candidates.find(
        (entry) =>
          entry.providerId === providerId &&
          entry.model === modelName &&
          !isCooling(entry),
      )
      if (candidate) {
        moveTo(candidate)
        return
      }
    }
  }

  const stageCompletion = async (stage, messages, { tools, maxTokens, temperature }) => {
    selectStage(stage)
    let lastError = null
    for (let step = 0; step < 6; step += 1) {
      const current = getActive()
      try {
        return await sendCompletion(messages, maxTokens, temperature, {
          allowStream: false,
          tools,
        })
      } catch (error) {
        lastError = error
        if (error.status === 429) {
          const waitMs =
            Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0
              ? error.retryAfterMs
              : 60000
          coolCandidate(current, waitMs)
          if (current.key?.id) {
            markKeyCooling(
              current.key.id,
              waitMs,
              `${providerLabel(current.providerId)} rate limit reached.`,
            )
          }
          agentLog({
            scope: 'edit',
            tool: 'fallback',
            message: `${current.providerId}/${current.model} hit its rate limit (429) — falling back`,
          })
          if (advanceCandidate()) continue
        } else if (error.status === 401 || error.status === 403) {
          if (current.key?.id) markKeyInvalid(current.key.id, error.message)
          coolCandidate(current, 180000)
          if (advanceCandidate()) {
            agentLog({
              scope: 'edit',
              tool: 'fallback',
              message: `${current.model} rejected the key — trying ${getActive().model}`,
            })
            continue
          }
        } else if ([413, 422, 404].includes(error.status)) {
          if (advanceCandidate()) continue
        }
        throw error
      }
    }
    throw lastError ?? new Error('The model could not be reached for this edit.')
  }

  const readFileTool = (args) => {
    const filePath = normalizePath(args.path)
    const content = readFileFromWorkspace(projectId, filePath)
    if (content == null) return { error: `No such file: ${filePath}` }
    const text =
      args.startLine || args.endLine
        ? sliceLines(content, args.startLine, args.endLine)
        : content
    return {
      path: filePath,
      totalLines: String(content).split('\n').length,
      content: text.length > READ_FILE_MAX_CHARS ? `${text.slice(0, READ_FILE_MAX_CHARS)}\n…` : text,
    }
  }

  const modified = new Map()

  const checkAndWrite = (filePath, before, after, label) => {
    if (!String(after ?? '').trim()) {
      return { ok: false, error: `${label} was rejected: the file would be empty.` }
    }
    const problems = balanceProblems(filePath, after)
    if (problems.length > 0) {
      return {
        ok: false,
        error: `${label} was rejected: the tags are not balanced — ${problems.join('; ')}`,
      }
    }
    if (!modified.has(filePath)) modified.set(filePath, before ?? '')
    writeFileToWorkspace(projectId, filePath, after)
    queueAgentFsChange(projectId, { path: filePath, type: 'change' })
    agentLog({ scope: 'edit', tool: label, file: filePath, message: 'written' })
    return { ok: true }
  }

  const applyWriterTool = (name, args) => {
    const filePath = normalizePath(args.path)
    if (name === 'read_file') return readFileTool(args)
    if (!filePath) return { error: 'A path is required.' }
    if (!existsInWorkspace(projectId, filePath)) {
      return { error: `Do not create files. ${filePath} does not exist; edit an existing file only.` }
    }
    const before = readFileFromWorkspace(projectId, filePath) ?? ''
    if (name === 'write_file') {
      const result = checkAndWrite(filePath, before, String(args.content ?? ''), 'write_file')
      return result.ok ? { ok: true, path: filePath, bytes: String(args.content ?? '').length } : result
    }
    if (name === 'replace_text') {
      const find = String(args.find ?? '')
      const replace = String(args.replace ?? '')
      if (!find) return { error: 'replace_text needs a non-empty "find".' }
      const normalized = before.replace(/\r\n?/g, '\n')
      const range = uniqueRange(normalized, find) ?? whitespaceRange(normalized, find)
      if (!range) {
        return {
          error: `replace_text could not find a unique match for the snippet. Closest text:\n${closestSnippet(normalized, find)}`,
        }
      }
      const next = normalized.slice(0, range.start) + replace + normalized.slice(range.end)
      const result = checkAndWrite(filePath, before, next, 'replace_text')
      return result.ok ? { ok: true, path: filePath } : result
    }
    return { error: `Unknown tool: ${name}` }
  }

  let tree
  try {
    tree = await getWorkspaceTree(projectId)
  } catch (error) {
    return fail('I could not read the project files.', `getWorkspaceTree failed: ${error?.message ?? error}`)
  }
  const allFiles = flattenTree(tree)
    .map((entry) => normalizePath(entry.path))
    .filter(Boolean)
  const isIndex = (file) => (/(^|\/)index\.html?$/i.test(file) ? 0 : 1)
  const htmlFiles = allFiles
    .filter((file) => isHtmlPath(file))
    .sort((a, b) => isIndex(a) - isIndex(b) || a.localeCompare(b))
  const cssFiles = allFiles.filter((file) => /\.css$/i.test(file))
  if (htmlFiles.length === 0) {
    return fail('I could not find an HTML page to edit in this project.')
  }

  const pageContents = new Map()
  for (const file of htmlFiles.slice(0, 12)) {
    pageContents.set(file, (await readFileFromWorkspace(projectId, file)) ?? '')
  }
  const outline = buildEditOutline(
    htmlFiles.slice(0, 12).map((file) => ({ file, content: pageContents.get(file) ?? '' })),
  )

  // ---- Stage 1: locate -----------------------------------------------------
  progress('Finding the right place to change…')
  const locateMessages = [
    { role: 'system', content: LOCATE_SYSTEM_PROMPT },
    { role: 'user', content: buildLocateMessage(task, allFiles, outline, cssFiles) },
  ]
  let locator = null
  for (let round = 0; round < LOCATE_STEPS; round += 1) {
    let response
    try {
      response = await stageCompletion('locate', locateMessages, {
        tools: LOCATE_TOOLS,
        maxTokens: 3000,
        temperature: 0.1,
      })
    } catch (error) {
      return fail(
        'I could not reach the model to find the target. Check the API key in Settings → AI and try again.',
        `locate request failed: ${error?.message ?? error}`,
      )
    }
    const message = response?.choices?.[0]?.message ?? {}
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    if (calls.length === 0) {
      locator = parseLocator(message.content)
      if (locator) break
      locateMessages.push({ role: 'assistant', content: String(message.content ?? '') })
      locateMessages.push({
        role: 'user',
        content: 'That was not the required JSON object. Reply with ONLY the JSON object described.',
      })
      continue
    }
    addToolCalls?.(calls.length)
    locateMessages.push({ role: 'assistant', content: message.content ?? '', tool_calls: calls })
    for (const call of calls) {
      const args = parseToolArgs(call.function?.arguments)
      const result = applyWriterTool('read_file', args)
      locateMessages.push({
        role: 'tool',
        tool_call_id: call.id ?? call.function?.name ?? 'read_file',
        content: JSON.stringify(result).slice(0, READ_FILE_MAX_CHARS),
      })
    }
  }
  if (!locator) {
    return fail(
      'I could not tell which part of the page to change. Name the section you mean (hero, FAQ, pricing, footer…) and try again.',
      'locator produced no usable target',
    )
  }
  agentLog({
    scope: 'edit',
    tool: 'locate',
    file: locator.region.file || locator.files.join(', '),
    message: `target ${JSON.stringify(locator)}`,
  })

  // ---- Stage 2: write ------------------------------------------------------
  const targetFile = locator.region.file || locator.files[0] || htmlFiles[0]
  const targetContent = pageContents.get(targetFile) ?? (await readFileFromWorkspace(projectId, targetFile)) ?? ''
  const contextParts = [`===== ${targetFile} =====\n${targetContent.slice(0, 16000)}`]
  const cssByFile = new Map()
  for (const cssFile of cssFiles.slice(0, 8)) {
    const text = (await readFileFromWorkspace(projectId, cssFile)) ?? ''
    cssByFile.set(cssFile, text)
  }
  for (const file of locator.files) {
    if (file === targetFile || cssByFile.has(file) || pageContents.has(file)) continue
    const text = (await readFileFromWorkspace(projectId, file)) ?? ''
    if (text) contextParts.push(`===== ${file} =====\n${text.slice(0, 8000)}`)
  }
  for (const [file, text] of cssByFile) {
    if (locator.files.includes(file) || locator.region.cssSelectors.length > 0) {
      contextParts.push(`===== ${file} (styles) =====\n${text.slice(0, 8000)}`)
    }
  }
  progress(`Updating ${targetFile}…`)

  const writeMessages = [
    { role: 'system', content: WRITER_SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildWriteMessage(task, locator, contextParts.join('\n\n')),
    },
  ]
  let summary = ''
  let failedStreak = 0
  let nudges = 0
  for (let round = 0; round < WRITE_STEPS; round += 1) {
    if (stopRequested?.()) {
      const totals = getTaskTotals?.() ?? null
      event('complete', 'Stopped by the user.', {
        status: 'done',
        stopped: true,
        durationMs: Date.now() - startedAt,
        model: getActive().model,
        provider: getActive().providerId,
        requests: totals?.requests ?? 0,
        totalTokens: totals?.totalTokens ?? 0,
      })
      persistSession?.('stopped')
      return {
        message: 'Stopped by the user.',
        stopped: true,
        toolCalls: 0,
        durationMs: Date.now() - startedAt,
        model: getActive().model,
        provider: getActive().providerId,
      }
    }
    let response
    try {
      response = await stageCompletion('write', writeMessages, {
        tools: WRITE_TOOLS,
        maxTokens: 8192,
        temperature: 0.2,
      })
    } catch (error) {
      return fail(
        'I could not reach the model to make the change. Check the API key in Settings → AI and try again.',
        `write request failed: ${error?.message ?? error}`,
      )
    }
    const message = response?.choices?.[0]?.message ?? {}
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    if (calls.length === 0) {
      summary = String(message.content ?? '').trim()
      if (modified.size > 0) break
        nudges += 1
        if (nudges >= 2) {
          agentLog({
            scope: 'edit',
            tool: 'stop',
            message: 'the writer replied twice without changing a file — stopping',
          })
          break
        }
        writeMessages.push({ role: 'assistant', content: summary })
      writeMessages.push({
        role: 'user',
        content:
          'No file was changed yet. Use replace_text or write_file to make the change, then reply with one short sentence.',
      })
      continue
    }
    addToolCalls?.(calls.length)
    writeMessages.push({ role: 'assistant', content: message.content ?? '', tool_calls: calls })
    for (const call of calls) {
      const name = call.function?.name
      const args = parseToolArgs(call.function?.arguments)
      const result = applyWriterTool(name, args)
      if (result?.error) {
        failedStreak += 1
        agentLog({ scope: 'edit', tool: name, file: normalizePath(args.path), message: result.error })
      } else {
        failedStreak = 0
      }
      writeMessages.push({
        role: 'tool',
        tool_call_id: call.id ?? name ?? 'tool',
        content: JSON.stringify(result).slice(0, 4000),
      })
    }
    if (failedStreak >= 2) {
      agentLog({
        scope: 'edit',
        tool: 'stop',
        message: 'two tool calls failed in a row — stopping the write stage',
      })
      break
    }
  }

  // ---- Final document check (server log only) -----------------------------
  for (const file of modified.keys()) {
    if (!isHtmlPath(file)) continue
    const text = readFileFromWorkspace(projectId, file) ?? ''
    const problems = [...documentIssues(text)]
    if (hasSlotMarkers(text)) problems.push('the file still contains a scaffold slot marker')
    agentLog({
      scope: 'edit',
      tool: 'final-check',
      file,
      message: problems.length > 0 ? `problems: ${problems.join(' | ')}` : 'clean',
    })
  }

  if (modified.size === 0) {
    return fail(
      'I could not make that change — the file was left unchanged. Try naming the section explicitly.',
      `writer made no changes; last summary: ${summary}`,
    )
  }

  const changed = [...modified.keys()]
  const finalSummary = summary || DEFAULT_SUMMARY
  const totals = getTaskTotals?.() ?? null
  agentLog({
    scope: 'edit',
    tool: 'write',
    file: changed.join(', '),
    message: `applied edit — ${finalSummary}`,
  })
  event('complete', finalSummary, {
    status: 'done',
    durationMs: Date.now() - startedAt,
    model: getActive().model,
    provider: getActive().providerId,
    edited: changed,
    targeted: true,
    requests: totals?.requests ?? 0,
    totalTokens: totals?.totalTokens ?? 0,
  })
  return {
    message: finalSummary,
    toolCalls: 0,
    durationMs: Date.now() - startedAt,
    model: getActive().model,
    provider: getActive().providerId,
    suggestedName: null,
    gatePassed: false,
    gateSkipped: true,
    requests: totals?.requests ?? 0,
    totalTokens: totals?.totalTokens ?? 0,
  }
}

export const __editModeTestables = { parseLocator, uniqueRange, whitespaceRange, normalizePath, scanHtml }
