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
