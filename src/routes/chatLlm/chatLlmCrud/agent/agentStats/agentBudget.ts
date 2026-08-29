export const AGENT_DEFAULT_MIN_BUDGET_TOKENS = 1;
export const AGENT_DEFAULT_MAX_BUDGET_TOKENS = 1_000_000;
export const AGENT_DEFAULT_MIN_ITERATIONS = 1;
export const AGENT_DEFAULT_MAX_ITERATIONS = 100;

export type AgentBudgetLimits = {
    minBudgetTokens: number;
    maxBudgetTokens: number;
    minNumberOfIterations: number;
    maxNumberOfIterations: number;
};

export type AgentBudgetDimensionStatus = {
    used: number;
    min: number;
    max: number;
    remaining: number;
    pctUsed: number;
    pctRemaining: number;
    minMet: boolean;
    maxExceeded: boolean;
};

export type AgentBudgetStatus = {
    tokens: AgentBudgetDimensionStatus;
    iterations: AgentBudgetDimensionStatus;
    minsMet: boolean;
    maxExceeded: boolean;
    nearMax: boolean;
};

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n * 100) / 100));

const dimensionStatus = (used: number, min: number, max: number): AgentBudgetDimensionStatus => {
    const safeMax = Math.max(1, max);
    const safeUsed = Math.max(0, used);
    const remaining = Math.max(0, safeMax - safeUsed);
    const pctUsed = clampPct((safeUsed / safeMax) * 100);
    const pctRemaining = clampPct(100 - pctUsed);
    return {
        used: safeUsed,
        min: Math.max(0, min),
        max: safeMax,
        remaining,
        pctUsed,
        pctRemaining,
        minMet: safeUsed >= Math.max(0, min),
        maxExceeded: safeUsed >= safeMax,
    };
};

export const normalizeAgentBudgetLimits = (
    partial?: Partial<AgentBudgetLimits> | null
): AgentBudgetLimits => {
    let minTokens = Math.round(Number(partial?.minBudgetTokens));
    let maxTokens = Math.round(Number(partial?.maxBudgetTokens));
    let minIter = Math.round(Number(partial?.minNumberOfIterations));
    let maxIter = Math.round(Number(partial?.maxNumberOfIterations));

    if (!Number.isFinite(minTokens) || minTokens < 1) minTokens = AGENT_DEFAULT_MIN_BUDGET_TOKENS;
    if (!Number.isFinite(maxTokens) || maxTokens < 1) maxTokens = AGENT_DEFAULT_MAX_BUDGET_TOKENS;
    minTokens = Math.min(AGENT_DEFAULT_MAX_BUDGET_TOKENS, Math.max(1, minTokens));
    maxTokens = Math.min(AGENT_DEFAULT_MAX_BUDGET_TOKENS, Math.max(1, maxTokens));
    if (minTokens > maxTokens) {
        minTokens = maxTokens;
    }

    if (!Number.isFinite(minIter) || minIter < 1) minIter = AGENT_DEFAULT_MIN_ITERATIONS;
    if (!Number.isFinite(maxIter) || maxIter < 1) maxIter = AGENT_DEFAULT_MAX_ITERATIONS;
    minIter = Math.min(AGENT_DEFAULT_MAX_ITERATIONS, Math.max(1, minIter));
    maxIter = Math.min(AGENT_DEFAULT_MAX_ITERATIONS, Math.max(1, maxIter));
    if (minIter > maxIter) {
        minIter = maxIter;
    }

    return {
        minBudgetTokens: minTokens,
        maxBudgetTokens: maxTokens,
        minNumberOfIterations: minIter,
        maxNumberOfIterations: maxIter,
    };
};

export const computeAgentBudgetStatus = (params: {
    totalTokens: number;
    tickCount: number;
    limits: AgentBudgetLimits;
}): AgentBudgetStatus => {
    const limits = normalizeAgentBudgetLimits(params.limits);
    const tokens = dimensionStatus(params.totalTokens || 0, limits.minBudgetTokens, limits.maxBudgetTokens);
    const iterations = dimensionStatus(
        params.tickCount || 0,
        limits.minNumberOfIterations,
        limits.maxNumberOfIterations
    );
    const minsMet = tokens.minMet && iterations.minMet;
    const maxExceeded = tokens.maxExceeded || iterations.maxExceeded;
    const nearMax = tokens.pctUsed >= 85 || iterations.pctUsed >= 85;
    return { tokens, iterations, minsMet, maxExceeded, nearMax };
};

/** Structured budget block for planner / verify / synthesize LLM context. */
export const formatAgentBudgetContext = (status: AgentBudgetStatus): Record<string, unknown> => ({
    tokens: {
        used: status.tokens.used,
        min: status.tokens.min,
        max: status.tokens.max,
        remaining: status.tokens.remaining,
        pctUsed: status.tokens.pctUsed,
        pctRemaining: status.tokens.pctRemaining,
        minMet: status.tokens.minMet,
        maxExceeded: status.tokens.maxExceeded,
    },
    iterations: {
        used: status.iterations.used,
        min: status.iterations.min,
        max: status.iterations.max,
        remaining: status.iterations.remaining,
        pctUsed: status.iterations.pctUsed,
        pctRemaining: status.iterations.pctRemaining,
        minMet: status.iterations.minMet,
        maxExceeded: status.iterations.maxExceeded,
    },
    minsMet: status.minsMet,
    maxExceeded: status.maxExceeded,
    nearMax: status.nearMax,
    instruction: status.maxExceeded
        ? 'The token or iteration maximum has been reached. Use mode=final_answer immediately with the best evidence available.'
        : !status.minsMet
          ? 'The minimum token and iteration budgets are not met yet. Do not use mode=final_answer until both minima are met, unless the maximum is about to be reached.'
          : status.nearMax
            ? 'The budget is nearly exhausted. Prefer mode=final_answer soon, and avoid expensive exploratory steps.'
            : 'The budget is still healthy. Continue Think → Plan → Use Tool → Observe, and use mode=final_answer when the evidence is sufficient and both minima are met.',
});

export const budgetLimitsFromAgentDoc = (agent: {
    minBudgetTokens?: number;
    maxBudgetTokens?: number;
    minNumberOfIterations?: number;
    maxNumberOfIterations?: number;
}): AgentBudgetLimits =>
    normalizeAgentBudgetLimits({
        minBudgetTokens: agent.minBudgetTokens,
        maxBudgetTokens: agent.maxBudgetTokens,
        minNumberOfIterations: agent.minNumberOfIterations,
        maxNumberOfIterations: agent.maxNumberOfIterations,
    });
