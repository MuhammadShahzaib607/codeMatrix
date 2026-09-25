/**
 * Monaco's TypeScript/JavaScript language service runs inside a web worker that
 * cannot read the real project on disk. Out of the box it has no idea that
 * "@/components/Foo" means "./src/components/Foo", so every path-aliased import
 * — and plain JSX in a project without type roots — is underlined as an error.
 *
 * These helpers turn a project's tsconfig.json / jsconfig.json `compilerOptions`
 * into Monaco compiler options (paths, baseUrl, jsx, target, module, ...) and
 * push them into BOTH language services. Because the worker still cannot see the
 * unopened files or node_modules, module-resolution diagnostics Monaco cannot
 * possibly satisfy are additionally ignored — see DIAGNOSTIC_CODES_TO_IGNORE.
 */

export const TS_CONFIG_FILENAMES = ['tsconfig.json', 'jsconfig.json']

// Cannot-find-* diagnostics that are always false positives in this editor:
// the language service has no access to node_modules, type declarations or the
// files that are not currently open. Syntax errors and real local type/semantic
// errors are still reported.
const DIAGNOSTIC_CODES_TO_IGNORE = [
  2307, // Cannot find module '…' or its corresponding type declarations.
  2792, // Cannot find module. Did you mean to set the 'moduleResolution' option…?
  7016, // Could not find a declaration file for module '…'.
  2688, // Cannot find type definition file for '…'.
  2503, // Cannot find namespace 'React' (no @types/react available).
  2686, // 'React' refers to a UMD global, but the current file is a module.
  7026, // JSX element implicitly has type 'any' (no JSX.IntrinsicElements).
  17004, // Cannot use JSX unless the '--jsx' flag is provided.
]

// tsconfig string value -> monaco/TypeScript enum member name.
const SCRIPT_TARGETS = {
  es3: 'ES3',
  es5: 'ES5',
  es6: 'ES2015',
  es2015: 'ES2015',
  es2016: 'ES2016',
  es2017: 'ES2017',
  es2018: 'ES2018',
  es2019: 'ES2019',
  es2020: 'ES2020',
  es2021: 'ES2021',
  es2022: 'ES2022',
  es2023: 'ES2023',
  esnext: 'ESNext',
  latest: 'Latest',
}

const MODULES = {
  none: 'None',
  commonjs: 'CommonJS',
  amd: 'AMD',
  umd: 'UMD',
  system: 'System',
  es6: 'ES2015',
  es2015: 'ES2015',
  es2020: 'ES2020',
  es2022: 'ES2022',
  esnext: 'ESNext',
  node16: 'Node16',
  node18: 'Node18',
  nodenext: 'NodeNext',
  preserve: 'Preserve',
}

const MODULE_RESOLUTIONS = {
  classic: 'Classic',
  node: 'NodeJs',
  node10: 'Node10',
  nodejs: 'NodeJs',
  node16: 'Node16',
  nodenext: 'NodeNext',
  bundler: 'Bundler',
}

const JSX_EMITS = {
  preserve: 'Preserve',
  react: 'React',
  reactnative: 'ReactNative',
  'react-native': 'ReactNative',
  reactjsx: 'ReactJSX',
  'react-jsx': 'ReactJSX',
  reactjsxdev: 'ReactJSXDev',
  'react-jsxdev': 'ReactJSXDev',
}

/**
 * Removes // and /* *\/ comments while respecting string literals, so a URL or
 * glob inside a string is never mistaken for a comment.
 */
function stripJsonComments(text) {
  let out = ''
  let inString = false
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (inString) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        i += 1
      } else if (char === quote) {
        inString = false
      }
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      quote = char
      out += char
      continue
    }

    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      out += '\n'
      continue
    }

    if (char === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 1
      continue
    }

    out += char
  }
  return out
}

/** Parses a tsconfig/jsconfig file, tolerating comments and trailing commas. */
export function parseTsconfigJson(text) {
  const cleaned = stripJsonComments(String(text ?? '')).replace(/,(\s*[}\]])/g, '$1')
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

function normalizePaths(paths) {
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return null
  const result = {}
  for (const [alias, targets] of Object.entries(paths)) {
    const list = Array.isArray(targets) ? targets : [targets]
    const clean = list.filter((entry) => typeof entry === 'string')
    if (clean.length) result[alias] = clean
  }
  return Object.keys(result).length ? result : null
}

/**
 * Pulls the compiler options this module cares about out of a parsed tsconfig.
 * Kept as plain serializable data so it can live in Redux.
 */
export function extractCompilerOptions(config) {
  const options = config?.compilerOptions ?? {}
  const paths = normalizePaths(options.paths)
  const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl : null
  return {
    baseUrl,
    paths,
    jsx: typeof options.jsx === 'string' ? options.jsx : null,
    target: typeof options.target === 'string' ? options.target : null,
    module: typeof options.module === 'string' ? options.module : null,
    moduleResolution:
      typeof options.moduleResolution === 'string' ? options.moduleResolution : null,
  }
}

function enumMember(enumObject, name) {
  if (!enumObject || !name) return undefined
  return typeof enumObject[name] === 'number' ? enumObject[name] : undefined
}

/**
 * Builds the Monaco compiler options. Defaults target a modern React/Next.js
 * project (ESNext + Bundler resolution + react-jsx) so JSX and aliases behave
 * even when the project ships no tsconfig at all; anything the tsconfig does
 * specify overrides the default.
 */
export function buildMonacoCompilerOptions(monaco, compilerOptions = null) {
  const ts = monaco?.languages?.typescript
  const configured = compilerOptions ?? {}

  const options = {
    target:
      enumMember(ts?.ScriptTarget, SCRIPT_TARGETS[String(configured.target ?? '').toLowerCase()]) ??
      ts?.ScriptTarget?.ESNext,
    module:
      enumMember(ts?.ModuleKind, MODULES[String(configured.module ?? '').toLowerCase()]) ??
      ts?.ModuleKind?.ESNext,
    moduleResolution:
      enumMember(
        ts?.ModuleResolutionKind,
        MODULE_RESOLUTIONS[String(configured.moduleResolution ?? '').toLowerCase()],
      ) ??
      ts?.ModuleResolutionKind?.Bundler ??
      ts?.ModuleResolutionKind?.NodeJs,
    jsx:
      enumMember(ts?.JsxEmit, JSX_EMITS[String(configured.jsx ?? '').toLowerCase()]) ??
      ts?.JsxEmit?.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    isolatedModules: false,
    noEmit: true,
    resolveJsonModule: true,
    skipLibCheck: true,
  }

  if (configured.baseUrl) {
    options.baseUrl = configured.baseUrl
  } else if (configured.paths) {
    // A paths map only resolves relative to a baseUrl; ".", the tsconfig
    // default when a baseUrl is omitted, keeps "./src/*" style targets working.
    options.baseUrl = '.'
  }

  if (configured.paths) options.paths = configured.paths

  return options
}

/** Pushes the resolved compiler + diagnostics options into Monaco. */
export function applyMonacoTsConfig(monaco, compilerOptions = null) {
  const ts = monaco?.languages?.typescript
  if (!ts) return

  const built = buildMonacoCompilerOptions(monaco, compilerOptions)
  const diagnostics = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: DIAGNOSTIC_CODES_TO_IGNORE,
  }

  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    defaults?.setCompilerOptions(built)
    defaults?.setDiagnosticsOptions(diagnostics)
  }
}

export { DIAGNOSTIC_CODES_TO_IGNORE }
