const LANGUAGE_BY_EXTENSION = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'plaintext',
  py: 'python',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  env: 'ini',
  toml: 'ini',
}

export function getLanguageFromFilename(filename = '') {
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex <= 0) return 'plaintext'
  const extension = filename.slice(dotIndex + 1).toLowerCase()
  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext'
}
