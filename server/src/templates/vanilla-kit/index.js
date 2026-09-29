import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildScaffoldFiles, normalizeScaffoldInput, sectionCatalog } from './scaffold.js'
import { SECTION_SNIPPETS, SECTION_TYPES, SLOT_PATTERN } from './snippets.js'
import { DEFAULT_THEME_ID, THEME_PRESETS, getThemePreset, themePresetIds } from './themes.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export const KIT_ASSET_PATHS = ['css/base.css', 'js/main.js']

export async function readKitAsset(relativePath) {
  return fs.readFile(path.join(here, String(relativePath).replace(/\//g, path.sep)), 'utf8')
}

export async function buildScaffoldPlan(input) {
  const plan = buildScaffoldFiles(input)
  for (const file of plan.files) {
    if (file.content === null) file.content = await readKitAsset(file.path)
  }
  return plan
}

let kitClassesCache = null

export async function loadKitClasses() {
  if (kitClassesCache) return kitClassesCache
  const classes = new Set()
  const sources = [await readKitAsset('css/base.css'), ...Object.values(SECTION_SNIPPETS)]
  for (const source of sources) {
    for (const match of String(source).matchAll(/\.([A-Za-z_][\w-]*)/g)) classes.add(match[1])
  }
  for (const name of [
    'container',
    'site-header',
    'site-nav',
    'site-footer',
    'skip-link',
    'sr-only',
    'reveal',
    'in-view',
    'is-open',
    'is-active',
    'is-scrolled',
    'is-visible',
    'is-invalid',
    'is-valid',
  ]) {
    classes.add(name)
  }
  kitClassesCache = classes
  return classes
}

export function kitClassList() {
  return [...(kitClassesCache ?? new Set())].sort()
}

export {
  DEFAULT_THEME_ID,
  SECTION_SNIPPETS,
  SECTION_TYPES,
  SLOT_PATTERN,
  THEME_PRESETS,
  buildScaffoldFiles,
  getThemePreset,
  normalizeScaffoldInput,
  sectionCatalog,
  themePresetIds,
}
