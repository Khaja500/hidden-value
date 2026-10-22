/** Extra worker task kinds for the research scripts. */
import { attributionCheck, calibrationSample, counterfactualCheck } from '../../src/sim/research';

export const handlers: Record<string, (task: never) => unknown> = {
  cfcheck: counterfactualCheck,
  attrcheck: attributionCheck,
  calib: calibrationSample,
};
