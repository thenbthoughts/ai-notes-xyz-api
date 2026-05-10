import mongoose from 'mongoose';

/** Stable iteration grouping id for AM4 stream UI: `synth-{requestId}-{outerIteration}`. */
export function am4SyntheticIterationDocId(
    answerMachineRequestV4Id: mongoose.Types.ObjectId | string,
    answerMachineIteration: number
): string {
    return `synth-v4-${String(answerMachineRequestV4Id)}-${answerMachineIteration}`;
}
