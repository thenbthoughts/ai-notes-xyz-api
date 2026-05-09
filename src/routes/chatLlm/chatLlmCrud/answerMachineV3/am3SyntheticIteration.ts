import mongoose from 'mongoose';

/** Stable iteration grouping id for AM3 stream UI: `synth-{requestId}-{outerIteration}`. */
export function am3SyntheticIterationDocId(
    answerMachineRequestV3Id: mongoose.Types.ObjectId | string,
    answerMachineIteration: number
): string {
    return `synth-${answerMachineRequestV3Id}-${answerMachineIteration}`;
}
