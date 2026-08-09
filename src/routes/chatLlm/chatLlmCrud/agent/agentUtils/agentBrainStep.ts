/**
 * Agent Brain orchestration.
 *
 * User Request → Agent Brain [Think → Plan → Use Tool → Observe → Repeat] → Final Answer
 *
 * `brainStep` is the current phase of that loop (for UI / logs).
 * Loop control is `status`: pending keeps repeating; success/failed ends.
 */

export type AgentBrainStep =
    | 'think'
    | 'plan'
    | 'use_tool'
    | 'observe'
    | 'final_answer'
    | 'done';

export const AGENT_BRAIN_STEPS: AgentBrainStep[] = [
    'think',
    'plan',
    'use_tool',
    'observe',
    'final_answer',
    'done',
];
