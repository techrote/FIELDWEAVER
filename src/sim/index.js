export {
  SIMULATION_VERSION,
  MATERIAL_KINDS,
  EMITTER_GEOMETRIES,
  MAX_SPEED_Q16,
  MAX_STEP_DISPLACEMENT_Q16,
  MAX_MATERIAL_INTERACTION_RADIUS_Q16,
  MAX_EMITTER_JITTER_Q16,
  MAX_EMITTER_EXTENT_Q16,
  createBaselineMaterials,
  AgentStore,
  DeterministicAgentSimulation
} from './model.js';

export {
  GPU_RESEARCH_VERSION,
  GPU_TRANSLATION_KERNEL_VERSION,
  GPU_TRANSLATION_INPUT_STRIDE,
  GPU_TRANSLATION_OUTPUT_STRIDE,
  GPU_TRANSLATION_WORKGROUP_SIZE,
  CANONICAL_GPU_ACCELERATION_ENABLED,
  GPU_RESEARCH_INT_LIMITS,
  CpuTranslationCandidate,
  WebGpuTranslationCandidate,
  packTranslationRecords,
  unpackTranslationOutput,
  translatePackedCpu,
  createWebGpuTranslationCandidate,
  runTranslationShadowConformance,
  benchmarkTranslationCandidate,
  evaluateCanonicalGpuAcceleration,
  gpuArithmeticAudit
} from './gpu-research.js';
