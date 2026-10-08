export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024

export const UPLOAD_ALLOWED_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.mp4', '.webm', '.pdf',
]

export const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif',
])

export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.avif', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp4', '.webm', '.mov', '.avi', '.mkv',
  '.mp3', '.wav', '.ogg', '.flac', '.m4a',
  '.pdf', '.zip', '.gz', '.tar', '.rar', '.7z', '.jar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.class', '.pyc',
  '.db', '.sqlite', '.lockb', '.psd', '.ai', '.sketch',
])

const TEXT_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.js', '.mjs', '.cjs',
  '.jsx', '.ts', '.tsx', '.json', '.md', '.markdown', '.txt', '.xml', '.svg',
  '.csv', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.env', '.log',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.py', '.rb', '.php',
  '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.sql', '.vue',
  '.svelte', '.astro', '.graphql', '.prisma', '.dockerfile', '.gitignore',
  '.editorconfig', '.prettierrc', '.eslintrc',
])

export function extensionOf(filePath) {
  const value = String(filePath ?? '')
  const base = value.slice(value.lastIndexOf('/') + 1)
  const index = base.lastIndexOf('.')
  if (index <= 0) return ''
  return base.slice(index).toLowerCase()
}

export function isImagePath(filePath) {
  return IMAGE_EXTENSIONS.has(extensionOf(filePath))
}

export function isSvgPath(filePath) {
  return extensionOf(filePath) === '.svg'
}

export function isBinaryPath(filePath) {
  const extension = extensionOf(filePath)
  if (!extension) return false
  if (BINARY_EXTENSIONS.has(extension)) return true
  if (TEXT_EXTENSIONS.has(extension)) return false
  return true
}

export function isUploadAllowed(file) {
  const name = String(file?.name ?? '')
  const extension = extensionOf(name)
  if (!UPLOAD_ALLOWED_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      reason: `“${name}” is not an allowed file type. Allowed: PNG, JPG, JPEG, GIF, WEBP, SVG, ICO, AVIF, WOFF, WOFF2, TTF, MP4, WEBM and PDF.`,
    }
  }
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    return { ok: false, reason: `“${name}” is larger than 10 MB and was not uploaded.` }
  }
  return { ok: true }
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
