import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
let bad = 0

function countWord(src, word) {
  let count = 0
  let at = src.indexOf(word)
  while (at !== -1) {
    const before = at === 0 ? '' : src[at - 1]
    const after = src[at + word.length] ?? ''
    const isWord = (ch) => /[A-Za-z0-9_$]/.test(ch)
    if (!isWord(before) && !isWord(after)) count += 1
    at = src.indexOf(word, at + 1)
  }
  return count
}

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const names = new Set()
  let m
  const named = /import\s+([\s\S]*?)\s+from\s+['"]/g
  while ((m = named.exec(src))) {
    const clause = m[1].trim()
    const braces = clause.match(/\{([\s\S]*)\}/)
    if (braces) {
      for (const part of braces[1].split(',')) {
        const id = part.trim().split(/\s+as\s+/).pop().trim()
        if (id) names.add(id)
      }
    }
    const head = clause.split('{')[0].replace(/,\s*$/, '').trim()
    if (head) names.add(head)
  }
  for (const name of names) {
    if (countWord(src, name) <= 1) {
      console.log(`UNUSED  ${file}  ${name}`)
      bad += 1
    }
  }
}

console.log(bad === 0 ? 'no unused imports' : `${bad} unused import(s)`)
process.exit(bad === 0 ? 0 : 1)
