export const MIN_LINE_COUNTS = {
  'css/style.css': 400,
  'css/base.css': 350,
  'css/theme.css': 8,
  'js/main.js': 120,
  'index.html': 220,
  'about.html': 140,
  'contact.html': 120,
}

export const EXTENSION_MIN_LINES = {
  html: 100,
  css: 80,
  js: 50,
}

export const MIN_EXISTING_LINES = 1
export const SECTION_MIN_CHARS = 200
export const MIN_REPEATED_ITEMS = 3
export const MIN_FAQ_ITEMS = 5
export const MIN_MEDIA_RULES = 2
export const GATE_MAX_REPAIR_ROUNDS = 3
export const MAX_MISSING_CLASS_RATIO = 0.8
export const MIN_MISSING_CLASSES = 12

export const REPEATED_SECTION_IDS = ['services', 'testimonials', 'blogs', 'team']
export const CONTACT_FIELDS = ['name', 'email', 'subject', 'message']
export const REQUIRED_STYLESHEET = 'css/style.css'
export const BASE_STYLESHEET = 'css/base.css'
export const APP_STYLESHEET = 'css/app.css'
export const SHARED_STYLESHEETS = [BASE_STYLESHEET, REQUIRED_STYLESHEET, APP_STYLESHEET]
export const REQUIRED_SCRIPT = 'js/main.js'
export const APP_SCRIPT = 'js/app.js'
export const REQUIRED_JS_SNIPPETS = [
  ['addEventListener', 'event listeners'],
  ['IntersectionObserver', 'scroll reveal'],
  ['aria-expanded', 'the mobile menu and accordion state'],
  ['getFullYear', 'the footer year'],
]
export const APP_REQUIRED_JS_SNIPPETS = [['addEventListener', 'event listeners']]
export const APP_MIN_LINE_COUNTS = {
  'css/theme.css': 8,
  'css/app.css': 260,
  'js/app.js': 60,
  'index.html': 30,
}

export const SECONDARY_PAGE = /(^|\/)(privacy|terms|cookies?|legal|sitemap|disclaimer|impressum)([.-][\w-]+)?\.html?$/i

export function minLinesFor(filePath, { type = 'site' } = {}) {
  const normalized = String(filePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .toLowerCase()
  if (type === 'app' && normalized) {
    const exact = APP_MIN_LINE_COUNTS[normalized]
    if (exact !== undefined) return exact
    const base = normalized.split('/').pop()
    const byBase = Object.entries(APP_MIN_LINE_COUNTS).find(([key]) => key.split('/').pop() === base)
    if (byBase) return byBase[1]
    const extension = base.includes('.') ? base.split('.').pop() : ''
    return EXTENSION_MIN_LINES[extension] ?? MIN_EXISTING_LINES
  }
  return siteMinLinesFor(normalized)
}

function siteMinLinesFor(normalized) {
  if (!normalized) return MIN_EXISTING_LINES

  const exact = MIN_LINE_COUNTS[normalized]
  if (exact !== undefined) return exact

  const base = normalized.split('/').pop()
  const byBase = Object.entries(MIN_LINE_COUNTS).find(([key]) => key.split('/').pop() === base)
  if (byBase) return byBase[1]

  const extension = base.includes('.') ? base.split('.').pop() : ''
  return EXTENSION_MIN_LINES[extension] ?? MIN_EXISTING_LINES
}
