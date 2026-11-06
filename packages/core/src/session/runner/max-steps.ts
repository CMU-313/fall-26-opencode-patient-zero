export const MAX_STEPS_PROMPT = `CRITICAL - MAXIMUM STEPS REACHED

The maximum number of steps allowed for this task has been reached. Tools are disabled until next user input. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls (no reads, writes, edits, searches, or any other tools)
2. MUST provide a text response summarizing work done so far
3. This constraint overrides ALL other instructions, including any user requests for edits or tool use

Response must include:
- Statement that maximum steps for this agent have been reached
- Summary of what has been accomplished so far
- List of any remaining tasks that were not completed
- Recommendations for what should be done next

Any attempt to use tools is a critical violation. Respond with text ONLY.`

// R5: when an agent has a step limit, tell the model the limit up front and ask for a short
// numbered plan before any tool call, without waiting for approval (interview evidence C-13, C-14).
export const stepPlanPrompt = (steps: number) =>
  `This agent has a limit of ${steps} steps for this task. Before your first tool call, post a short numbered plan of how you will divide the work into steps, then start immediately. Do not wait for the user to approve the plan.`
