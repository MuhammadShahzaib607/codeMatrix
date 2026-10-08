import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LEGAL_LINK,
  LEGAL_PAGE,
  buildScaffoldFiles,
  normalizeScaffoldInput,
  sectionCatalog,
  stripTemplateComments,
} from './scaffold.js'
import { APP_CSS, APP_JS, appStylesheet, buildAppFiles, extractKitTokens } from './app-kit.js'
import { COMPOSABLE_SECTION_TYPES, buildComposedFiles, sectionSummary } from './compose.js'
import { SECTION_SNIPPETS, SECTION_TYPES, SLOT_PATTERN } from './snippets.js'
import { ICON_FALLBACK, ICONS_SCRIPT, hasIcon, iconNames } from './icons.js'
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

export async function buildComposePlan(input) {
  const plan = buildComposedFiles(input)
  for (const file of plan.files) {
    if (file.content === null) file.content = await readKitAsset(file.path)
  }
  return plan
}

// The utility-app kit. It reuses the SAME token block as the marketing kit
// (extracted from css/base.css between the kit-tokens markers) so an app and a
// site share one spacing/type/hover scale, then adds the app-only layer.
export async function buildScaffoldAppPlan(input) {
  const plan = buildAppFiles(input)
  const tokens = extractKitTokens(await readKitAsset('css/base.css'))
  for (const file of plan.files) {
    if (file.path === 'css/app.css') file.content = appStylesheet(tokens)
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
  APP_CSS,
  APP_JS,
  COMPOSABLE_SECTION_TYPES,
  buildComposedFiles,
  sectionSummary,
  DEFAULT_THEME_ID,
  ICON_FALLBACK,
  ICONS_SCRIPT,
  hasIcon,
  iconNames,
  LEGAL_LINK,
  LEGAL_PAGE,
  SECTION_SNIPPETS,
  SECTION_TYPES,
  SLOT_PATTERN,
  THEME_PRESETS,
  buildAppFiles,
  buildScaffoldFiles,
  getThemePreset,
  normalizeScaffoldInput,
  sectionCatalog,
  stripTemplateComments,
  themePresetIds,
}
