import {
    AnswerMachineKbKnowledgeTypeV3,
    AnswerMachineSubQuestionKindV3,
} from '../../../../types/typesSchema/typesChatLlm/typesAnswerMachine/SchemaAnswerMachineSubQuestionV3.types';

function looksLikeArithmeticComputation(text: string): boolean {
    if (!text.trim()) return false;
    const t = text
        .replace(/\u00d7/g, '*')
        .replace(/\u2212/g, '-')
        .replace(/\u2215/g, '/')
        .replace(/,/g, '');
    if (/\d\s*[\+\-\*\/%^]\s*\d/.test(t)) return true;
    if (/\d\s*[×÷]\s*\d/.test(text)) return true;
    if (/\*\*\s*\d|\d\s*\*\*/.test(t)) return true;
    if (/\d+\s*!/.test(t)) return true;
    if (/\d\s*(?:>|<|>=|<=)\s*\d/.test(t)) return true;
    if (
        /\b(sqrt|cbrt|sin|cos|tan|asin|acos|atan|log10|log2|ln|exp|abs|floor|ceil|round|trunc)\s*\(/i.test(t) &&
        /\d/.test(t)
    )
        return true;
    return false;
}

function looksLikeHeadlessPageCaptureRequest(text: string): boolean {
    if (!text.trim()) return false;
    const t = text.trim();
    const low = t.toLowerCase();
    if (/\bscreenshot\b|\bscreen\s*[- ]?\s*shot\b/i.test(t)) return true;
    if (/\bcapture\b.+\b(page|site|website|url|webpage|homepage)\b/i.test(low)) return true;
    if (/\b(full[\s-]?page|viewport)\b.+\b(png|jpeg|jpg|image|capture|screenshot|shot)\b/i.test(low)) return true;
    if (/\bheadless\b.+\b(chromium|chrome|browser)\b/i.test(low)) return true;
    if (/\b(puppeteer|playwright)\b/i.test(low) && /\b(page|browser|url|site)\b/i.test(low)) return true;
    if (
        /https?:\/\/[^\s]+/i.test(t) &&
        /\b(look\s+like|render|visualize|preview|screenshot|capture|how\s+does).{0,40}\b/i.test(low)
    )
        return true;
    return false;
}

export type PlannedAm3Step = {
    question: string;
    kind: AnswerMachineSubQuestionKindV3;
    kbKnowledgeTypes: AnswerMachineKbKnowledgeTypeV3[];
};

/** Align planner output with hard routing rules (math / screenshot → shell). */
export function coercePlannedAm3Step(planned: PlannedAm3Step, lastUserPlain: string): PlannedAm3Step {
    let { question, kind, kbKnowledgeTypes } = planned;
    const questionNeedsShell =
        kind !== 'shell' &&
        (looksLikeArithmeticComputation(question) || looksLikeHeadlessPageCaptureRequest(question));
    if (questionNeedsShell) {
        return { question, kind: 'shell', kbKnowledgeTypes: [] };
    }

    const userNeedsSandbox =
        looksLikeArithmeticComputation(lastUserPlain) || looksLikeHeadlessPageCaptureRequest(lastUserPlain);
    if (userNeedsSandbox && kind !== 'shell') {
        return {
            question: lastUserPlain.slice(0, 2000),
            kind: 'shell',
            kbKnowledgeTypes: [],
        };
    }

    return { question, kind, kbKnowledgeTypes };
}
