/** Extra worker task kinds for the research scripts. */
import { attributionCheck, calibrationSample, counterfactualCheck } from '../../src/sim/research';
import { evaluatePolicy } from '../../src/sim/train';

export const handlers: Record<string, (task: never) => unknown> = {
  cfcheck: counterfactualCheck,
  attrcheck: attributionCheck,
  calib: calibrationSample,
  learnedEval: evaluatePolicy,
};
