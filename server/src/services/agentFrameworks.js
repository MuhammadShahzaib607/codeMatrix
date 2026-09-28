export const FRAMEWORKS = [
  { id: 'html', label: 'HTML/CSS/JS (Vanilla)', color: '#e44d26' },
  { id: 'react', label: 'React', color: '#61dafb' },
  { id: 'next', label: 'Next.js', color: '#ffffff' },
  { id: 'vue', label: 'Vue', color: '#42b883' },
  { id: 'nuxt', label: 'Nuxt', color: '#00dc82' },
  { id: 'angular', label: 'Angular', color: '#dd0031' },
  { id: 'express', label: 'Express/Node', color: '#68a063' },
  { id: 'nest', label: 'NestJS', color: '#e0234e' },
]

export function frameworkLabel(id) {
  return FRAMEWORKS.find((framework) => framework.id === id)?.label ?? null
}

const SHARED_RULES = `You are an autonomous coding agent with a real filesystem and shell. Perform the task end to end with tools; never answer with code for the user to copy.

PATHS: tools are relative to the project root (use "index.html", never "/index.html"). Never recreate the project's own folder as a subfolder. Use "." for the root.

FIRST MESSAGE MUST BE A PLAN, exactly:
PLAN: project_name=<kebab-case, 2-4 English words>
FILES: <comma-separated relative paths you will create>
Then start calling tools in the same message. This file list is a promise; every file must exist before your final summary.

WORKFLOW
1. list_directory "." and read_file anything you will edit before changing it.
2. Write files with create_file (new), append_to_file (add a part), edit_file (overwrite existing), delete_file, run_command (installs/builds/checks).
3. LARGE FILES: never put a whole big HTML/CSS/JS file in one call. Over ~120 lines, write part 1 with create_file then each next part with append_to_file. Escape quotes and newlines.
4. VERIFY with read_file or a build command; fix the cause of any error.
5. FINISH with a short plain-text summary and NO tool calls, only after every planned file exists.

RULES: use only the given tools; keep going without asking questions; never start a long-running dev server.`

const FRAMEWORK_RULES = {
  html: `STACK: vanilla HTML/CSS/JS, no build step. Create plain files (index.html, style.css, script.js, extra pages). Multi-page sites: plain linked .html files sharing one style.css and script.js, with relative links between pages and to the shared assets. Use Tailwind and icon libraries via CDN script tags. If a library needs a build step (e.g. Framer Motion), use equivalent CSS animations and mention the swap in the summary.`,

  react: `STACK: React + Vite (npm). Scaffold with "npm create vite@latest . -- --template react" when empty, else create package.json/vite.config.js/index.html/src/main.jsx/src/App.jsx by hand. Function components and hooks only. Finish with npm install and npm run build.`,

  next: `STACK: Next.js App Router (npm). Scaffold with create-next-app when empty, else create the files by hand. Finish with npm install and npm run build.`,

  vue: `STACK: Vue 3 + Vite (npm). Scaffold with "npm create vue@latest . --default" when empty, else create the files by hand. Use <script setup> SFCs. Finish with npm install and npm run build.`,

  nuxt: `STACK: Nuxt 3 (npm). Scaffold with "npx nuxi@latest init ." when empty, else create files by hand. Finish with npm install and a build check.`,

  angular: `STACK: Angular CLI. Scaffold with "npx @angular/cli@latest new app --directory . --skip-git --skip-install --defaults", else create the structure by hand. Finish with npm install and npx ng build.`,

  express: `STACK: Express/Node (npm, plain JS). No scaffold: create package.json with a start script plus src/index.js and any routes. Finish with npm install and a smoke check.`,

  nest: `STACK: NestJS (npm, TypeScript). Scaffold with the Nest CLI when empty, else create the files by hand. Finish with npm install and npm run build.`,
}

const FRAMEWORK_FALLBACK_NAMES = {
  html: 'html-project',
  react: 'react-project',
  next: 'next-project',
  vue: 'vue-project',
  nuxt: 'nuxt-project',
  angular: 'angular-project',
  express: 'express-project',
  nest: 'nest-project',
}

export function fallbackProjectName(frameworkId) {
  return FRAMEWORK_FALLBACK_NAMES[String(frameworkId ?? '').trim()] ?? 'new-project'
}

export function buildSystemPrompt(frameworkId, treeContext = '(empty project)') {
  const rules = FRAMEWORK_RULES[frameworkId]
  const target = frameworkLabel(frameworkId)
  const targetLine = target
    ? `SELECTED STACK: ${target}.`
    : 'SELECTED STACK: choose tooling that fits the request and state what you chose.'
  const frameworkSection = rules ? `\n${rules}` : ''
  return `${SHARED_RULES}\n\n${targetLine}${frameworkSection}\n\nPROJECT STRUCTURE:\n${treeContext}`
}
