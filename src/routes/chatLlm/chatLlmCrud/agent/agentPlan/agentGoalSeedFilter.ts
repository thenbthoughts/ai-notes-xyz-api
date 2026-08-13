export type AgentGoalSeed = { title: string; description: string };

const blobOf = (title: string, description: string): string =>
    `${title}\n${description}`.toLowerCase();

export const goalSeedCreates = (title: string, description: string): boolean =>
    /\b(create|write|save|generate|convert|build|produce|edit|append|render|merge|join|export|transform|parse|extract|count|summarize|filter)\b/.test(
        blobOf(title, description)
    );

/** Print path/size is part of creating the file — not its own goal. */
export const isPrintMetadataOnlyGoal = (title: string, description: string): boolean => {
    const titleL = title.toLowerCase();
    // Title like "Report file metadata" is enough — descriptions often say
    // "print path of the newly created file", which must not keep this as a sibling goal.
    if (/\b(report|print|show|display)\b/.test(titleL) && /\b(metadata|path|size)\b/.test(titleL)) {
        return true;
    }
    const blob = blobOf(title, description);
    const printish = /\b(report|print|retrieve|show|display)\b/.test(blob);
    const metaish =
        /\b(file metadata|created file metadata|absolute paths?|file sizes?|path and size|path \+ size|file details)\b/.test(
            blob
        );
    return printish && metaish && !goalSeedCreates(title, description);
};

/** Searching the whole container for an uploaded fixture is not a goal. */
export const isLocateOnlyGoal = (title: string, description: string): boolean => {
    const blob = blobOf(title, description);
    const locateish = /\b(locate|find the|search for|discover the path|where is|system-wide)\b/.test(
        blob
    );
    return locateish && !goalSeedCreates(title, description);
};

/** Read/inspect inputs belongs in the same script as writing the output. */
export const isInspectOnlyGoal = (title: string, description: string): boolean => {
    const blob = blobOf(title, description);
    const inspectish = /\b(inspect|read|explore|examine|look at|determine|understand|locate|find the)\b/.test(
        blob
    );
    return inspectish && !goalSeedCreates(title, description);
};

/** Over-verify / restating constraints is not a separate goal. */
export const isVerifyOnlyGoal = (title: string, description: string): boolean => {
    const blob = blobOf(title, description);
    const bare = /^(verify|check|validate)(\s+\w+){0,2}$/i.test(title.trim());
    const constraintEcho =
        /\b(verify|ensure|confirm)\b/.test(blob) &&
        /\b(constraints?|git push|send email|workspace outputs|task is completed)\b/.test(blob);
    return (bare || constraintEcho) && !goalSeedCreates(title, description);
};

/** Drop print-metadata, inspect-prelude, and verify-only micro-steps when a sibling creates the file. */
export const dropMicroStepGoalSeeds = (seeds: AgentGoalSeed[]): AgentGoalSeed[] => {
    const withoutMeta = seeds.filter(
        (s) =>
            !isPrintMetadataOnlyGoal(s.title, s.description) &&
            !isLocateOnlyGoal(s.title, s.description)
    );
    const hasWork = withoutMeta.some((s) => goalSeedCreates(s.title, s.description));
    if (!hasWork) return withoutMeta;
    return withoutMeta.filter(
        (s) => !isInspectOnlyGoal(s.title, s.description) && !isVerifyOnlyGoal(s.title, s.description)
    );
};
