import mongoose from "mongoose";
// Simplified evaluation - just return satisfactory to avoid complex LLM calls during restructuring
export const step5EvaluateAnswer = async ({
    answerMachineId,
    threadId,
    username,
    currentIteration,
}: {
    answerMachineId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    username: string;
    currentIteration: number;
}): Promise<{
    isSatisfactory: boolean;
    gaps: string[];
    reasoning: string;
}> => {
    // Simplified evaluation - check if we have meaningful content and respect iteration limits
    // In a real implementation, this would use LLM to evaluate answer quality

    console.log(`[Evaluation] Iteration ${currentIteration}: Evaluating answer quality`);

    // Get the current answer machine record to check intermediate answers
    const AnswerMachineRepository = (await import("../database/answer-machine-repository")).AnswerMachineRepository;
    const currentRecord = await AnswerMachineRepository.findById(answerMachineId);

    const intermediateAnswers = currentRecord?.intermediateAnswers || [];
    const latestAnswer = intermediateAnswers[intermediateAnswers.length - 1];

    // Evaluate the quality of the latest intermediate answer
    const hasSubstantialContent = latestAnswer && latestAnswer.length > 100; // More substantial content check
    const hasMultipleInsights = latestAnswer && (
        latestAnswer.includes('analysis') ||
        latestAnswer.includes('insights') ||
        latestAnswer.includes('aspects') ||
        latestAnswer.includes('considerations')
    );
    const hasComprehensiveCoverage = latestAnswer && latestAnswer.split('\n\n').length > 2; // Multiple paragraphs/sections

    // Answer is satisfactory if it has substantial content AND shows comprehensive analysis
    const answerQualityScore = (hasSubstantialContent ? 1 : 0) + (hasMultipleInsights ? 1 : 0) + (hasComprehensiveCoverage ? 1 : 0);
    const hasGoodQuality = answerQualityScore >= 2; // At least 2 out of 3 quality criteria

    // Continue until we have good quality answers OR reach iteration limits
    const shouldBeSatisfactory = (currentIteration >= 3 && hasGoodQuality) || currentIteration >= 7;

    console.log(`[Evaluation] Iteration ${currentIteration}: qualityScore=${answerQualityScore}/3 (substantial:${hasSubstantialContent}, insights:${hasMultipleInsights}, comprehensive:${hasComprehensiveCoverage}), shouldBeSatisfactory=${shouldBeSatisfactory}`);

    const gaps = shouldBeSatisfactory ? [] : [
        `Need more detailed analysis (iteration ${currentIteration})`,
        hasSubstantialContent ? null : 'More comprehensive content needed',
        hasMultipleInsights ? null : 'Additional insights and perspectives needed',
        hasComprehensiveCoverage ? null : 'Broader coverage of the topic needed'
    ].filter(Boolean);

    return {
        isSatisfactory: shouldBeSatisfactory,
        gaps: gaps as string[],
        reasoning: `Quality score: ${answerQualityScore}/3. ${shouldBeSatisfactory ? 'Answer meets quality criteria' : 'Additional iteration needed for better analysis'}`,
    };
};