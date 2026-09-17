import { createWebGL2Renderer as createWebGL2RendererInternal } from './webgl2.js';

export {
  RENDERER_VERSION,
  DEFAULT_MAX_PREVIEW_DEPOSITIONS,
  MAX_PREVIEW_DEPOSITIONS,
  VERTEX_FLOATS,
  MATERIAL_PREVIEW_STYLES,
  PreviewAccumulator,
  PreviewGeometryCache,
  createViewport,
  createViewportTransform,
  worldToCanvas,
  worldToClip,
  panViewport,
  zoomViewport,
  prepareDepositionGeometry,
  prepareOverlayGeometry,
  prepareFrameModel
} from './prepare.js';
export {
  RendererUnavailableError,
  WebGL2PreviewRenderer
} from './webgl2.js';

let activeWebGL2Renderer = null;

export function createWebGL2Renderer(...args) {
  const renderer = createWebGL2RendererInternal(...args);
  activeWebGL2Renderer = renderer;
  return renderer;
}

export function getActiveWebGL2Renderer() {
  return activeWebGL2Renderer;
}
