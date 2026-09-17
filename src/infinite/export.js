import { createExportProvenance, encodePngRgba, EXPORT_PACKAGE_VERSION, serializeExportProvenance } from '../export/index.js';
import { createRecipe, recipeHash } from '../recipe/index.js';
import { SIMULATION_VERSION } from '../sim/index.js';
import { INFINITE_PLATE_METHOD, INFINITE_PLATE_VERSION, InfinitePlateEvaluator } from './model.js';

export const INFINITE_PLATE_EXPORT_VERSION = 'fw-infinite-plate-export-v1';

function sourceReplayAdapter(evaluation) {
  return Object.freeze({
    stateHash: () => evaluation.sourceStateHash,
    depositionHash: () => evaluation.sourceDepositionHash,
    resultHash: () => evaluation.sourceResultHash
  });
}

export function createInfinitePlateExport(recipeInput, options = {}) {
  const recipe = createRecipe(recipeInput);
  const evaluator = options.evaluator instanceof InfinitePlateEvaluator ? options.evaluator : new InfinitePlateEvaluator({ cacheChunks: options.cacheChunks });
  const evaluation = options.evaluation ?? evaluator.evaluate(recipe, options);
  if (evaluation.version !== INFINITE_PLATE_VERSION || evaluation.method !== INFINITE_PLATE_METHOD) {
    throw new RangeError('Infinite Plate export requires a compatible deterministic regional evaluation.');
  }
  const identity = recipeHash(recipe);
  if (evaluation.recipeHash !== identity) throw new RangeError('Infinite Plate evaluation recipe identity does not match export recipe.');
  const png = encodePngRgba(evaluation.rgba, evaluation.crop.widthPx, evaluation.crop.heightPx);
  const baseProvenance = createExportProvenance({
    recipe,
    crop: evaluation.crop,
    targetTick: evaluation.targetTick,
    rgbaHash: evaluation.rawRgbaHash,
    replay: sourceReplayAdapter(evaluation),
    backgroundRgba8: evaluation.backgroundRgba8
  });
  const provenance = Object.freeze({
    ...baseProvenance,
    infinitePlate: Object.freeze({
      version: INFINITE_PLATE_VERSION,
      exportVersion: INFINITE_PLATE_EXPORT_VERSION,
      method: evaluation.method,
      domainHash: evaluation.domainHash,
      causalHaloQ16: evaluation.causality.causalHaloQ16,
      regionalDepositionHash: evaluation.depositionHash,
      regionalResultHash: evaluation.resultHash,
      requestedChunks: evaluation.chunkCount,
      sourceDepositionCount: evaluation.sourceDepositionCount,
      regionalDepositionCount: evaluation.depositionCount
    })
  });
  return Object.freeze({
    version: EXPORT_PACKAGE_VERSION,
    infinitePlateExportVersion: INFINITE_PLATE_EXPORT_VERSION,
    infinitePlateVersion: INFINITE_PLATE_VERSION,
    method: evaluation.method,
    recipeHash: identity,
    targetTick: evaluation.targetTick,
    crop: evaluation.crop,
    rgba: evaluation.rgba,
    rawRgbaHash: evaluation.rawRgbaHash,
    png,
    provenance,
    provenanceJson: serializeExportProvenance(provenance),
    stateHash: evaluation.sourceStateHash,
    depositionHash: evaluation.sourceDepositionHash,
    resultHash: evaluation.sourceResultHash,
    regionalDepositionHash: evaluation.depositionHash,
    regionalResultHash: evaluation.resultHash,
    depositionCount: evaluation.depositionCount,
    simulationVersion: SIMULATION_VERSION,
    evaluation
  });
}
