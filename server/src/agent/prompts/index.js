import { BASE_PROMPT } from './base.js'
import { buildContextBlock } from './context.js'
import { UPDATE_WORKFLOW_SECTION } from './projectSnapshot.js'
import { buildStrictRulesBlock } from '../../services/strictRules.js'
import { angularPrompt } from './stacks/angular.js'
import { expressPrompt } from './stacks/express.js'
import { nestPrompt } from './stacks/nest.js'
import { nextPrompt } from './stacks/next.js'
import { nuxtPrompt } from './stacks/nuxt.js'
import { reactPrompt } from './stacks/react.js'
import {
  vanillaCompactDesignSystem,
  vanillaCompactPrompt,
  vanillaFullDesignSystem,
  vanillaPrompt,
} from './stacks/vanilla.js'
import { vuePrompt } from './stacks/vue.js'

export const VANILLA_FRAMEWORK_ID = 'html'
export const COMPACT_TPM_THRESHOLD = 20000

export const PROMPT_TIERS = { FULL: 'full', COMPACT: 'compact' }

const STACKS = {
  html: {
    label: 'HTML/CSS/JS (Vanilla)',
    full: vanillaPrompt,
    compact: vanillaCompactPrompt,
    designSystem: vanillaFullDesignSystem,
    compactDesignSystem: vanillaCompactDesignSystem,
  },
  react: { label: 'React', full: reactPrompt },
  next: { label: 'Next.js', full: nextPrompt },
  vue: { label: 'Vue', full: vuePrompt },
  nuxt: { label: 'Nuxt', full: nuxtPrompt },
  angular: { label: 'Angular', full: angularPrompt },
  express: { label: 'Express/Node', full: expressPrompt },
  nest: { label: 'NestJS', full: nestPrompt },
}

const UNKNOWN_STACK_PROMPT =
  'STACK: choose the tooling that fits the request, state what you chose in the plan, and stay consistent.'

export function isVanillaFramework(framework) {
  return String(framework ?? '').trim() === VANILLA_FRAMEWORK_ID
}

export function stackLabel(framework) {
  return STACKS[String(framework ?? '').trim()]?.label ?? null
}

export function resolveTier(limits = null, { vanilla = false } = {}) {
  // The vanilla blueprint is deliberately kept to ONE tight prompt, so it is
  // compact on every provider — a 500K-tpm Mistral key burning the long prompt
  // on 30 turns of a build was the single biggest token cost we measured.
  if (vanilla) return PROMPT_TIERS.COMPACT
  const tpm = Number(limits?.tpm ?? 0)
  return tpm > 0 && tpm < COMPACT_TPM_THRESHOLD ? PROMPT_TIERS.COMPACT : PROMPT_TIERS.FULL
}

export function buildSystemPrompt({
  framework = null,
  tier = PROMPT_TIERS.FULL,
  now = new Date(),
  projectStructure = null,
  projectSnapshot = null,
  projectMemory = null,
  updateWorkflow = false,
  strictRules = [],
} = {}) {
  const stack = STACKS[String(framework ?? '').trim()] ?? null
  const compact = tier === PROMPT_TIERS.COMPACT
  const sections = [BASE_PROMPT]
  const rulesBlock = buildStrictRulesBlock(strictRules)
  if (rulesBlock) sections.push(rulesBlock)
  sections.push(buildContextBlock(now))

  if (!stack) {
    sections.push(UNKNOWN_STACK_PROMPT)
  } else {
    sections.push(`SELECTED STACK: ${stack.label}.`)
    sections.push(compact ? stack.compact ?? stack.full : stack.full)
    const designSystem = compact ? stack.compactDesignSystem ?? stack.designSystem : stack.designSystem
    if (designSystem) sections.push(designSystem)
  }

  if (projectSnapshot) {
    if (updateWorkflow) sections.push(UPDATE_WORKFLOW_SECTION)
    sections.push(projectSnapshot)
  } else if (projectStructure) {
    sections.push(`PROJECT STRUCTURE\n${projectStructure}`)
  }

  // The project's own work log, only when the user opted in. It sits AFTER the
  // snapshot: the snapshot describes what the files ARE, the log describes what
  // earlier runs DID and decided.
  if (projectMemory) {
    sections.push(
      `PROJECT HISTORY (AGENT.md — earlier runs in this project, newest last; treat it as context, not as truth about the current files):\n${projectMemory}`,
    )
  }

  return sections.join('\n\n')
}

export const __testables = { STACKS }
