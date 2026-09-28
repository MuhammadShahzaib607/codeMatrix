// The AI panel's framework selector options. IDs must match the server's stack
// prompts (server/src/agent/prompts/stacks/) — the selected id travels with
// every task and picks the agent's system prompt.
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
