/**
 * The agent's PRIMARY Groq model. This mirrors TOOL_CAPABLE_MODELS[0] in
 * server/src/services/agentService.js; it is only used as the label the AI panel
 * shows before the first run has reported a resolved model. Once a run starts,
 * the real (possibly fallen-back) model id streams over the socket and replaces
 * this default.
 */
export const DEFAULT_AGENT_MODEL = 'llama-3.1-8b-instant'
