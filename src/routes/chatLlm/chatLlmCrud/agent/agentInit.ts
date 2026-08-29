/**
 * Agent init entry — creates the run (brainStep=think), then enqueues brain ticks.
 * Plan/Work live in sibling folders; tick dispatcher is agentProcessTick.
 */
export { default, default as agentInit } from './agentCrud/agentInitiateFunc';
export { default as agentInitiateFunc } from './agentCrud/agentInitiateFunc';
