import {
  DEFAULT_MAX_PREVIEW_DEPOSITIONS,
  PreviewAccumulator,
  PreviewGeometryCache,
  VERTEX_FLOATS,
  createViewport,
  createViewportTransform,
  panViewport,
  prepareOverlayGeometry,
  zoomViewport
} from './prepare.js';

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
in vec4 a_color;
in float a_pointSize;
uniform vec2 u_clipScale;
uniform vec2 u_clipOffset;
uniform float u_pointScale;
out vec4 v_color;
void main() {
  vec2 transformed = a_position * u_clipScale + u_clipOffset;
  gl_Position = vec4(transformed, 0.0, 1.0);
  gl_PointSize = clamp(max(1.0, a_pointSize * u_pointScale), 1.0, 128.0);
  v_color = a_color;
}`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
in vec4 v_color;
uniform int u_pointMode;
out vec4 outColor;
void main() {
  if (u_pointMode == 1) {
    vec2 delta = gl_PointCoord - vec2(0.5);
    if (dot(delta, delta) > 0.25) discard;
  }
  outColor = v_color;
}`;

export class RendererUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RendererUnavailableError';
  }
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new RendererUnavailableError('WebGL2 could not allocate a shader object.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'unknown shader compilation error';
    gl.deleteShader(shader);
    throw new RendererUnavailableError(`WebGL2 shader compilation failed: ${log}`);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
  const program = gl.createProgram();
  if (!program) throw new RendererUnavailableError('WebGL2 could not allocate a shader program.');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || 'unknown program link error';
    gl.deleteProgram(program);
    throw new RendererUnavailableError(`WebGL2 shader program link failed: ${log}`);
  }
  return program;
}

function attributeLocation(gl, program, name) {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) throw new RendererUnavailableError(`WebGL2 shader attribute ${name} is unavailable.`);
  return location;
}

function uniformLocation(gl, program, name) {
  const location = gl.getUniformLocation(program, name);
  if (location === null) throw new RendererUnavailableError(`WebGL2 shader uniform ${name} is unavailable.`);
  return location;
}

function clockNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function validateCanvas(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('WebGL2 renderer requires a canvas-like object with getContext().');
  }
  return canvas;
}

export class WebGL2PreviewRenderer {
  constructor(canvas, options = {}) {
    this.canvas = validateCanvas(canvas);
    this.maxPreviewDepositions = options.maxPreviewDepositions ?? DEFAULT_MAX_PREVIEW_DEPOSITIONS;
    this.accumulator = new PreviewAccumulator(this.maxPreviewDepositions);
    this.geometryCache = new PreviewGeometryCache();
    this.view = createViewport(options.viewport ?? {});
    this.showOverlays = options.showOverlays ?? true;
    this.lastConsumedDepositionCount = 0;
    this.lastConsumedRecord = null;
    this.lastDiagnostics = Object.freeze({ state: 'initializing' });
    this._contextLost = false;
    this._contextRequiresReload = false;

    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false
    });
    if (!gl) {
      throw new RendererUnavailableError(
        'WebGL2 is unavailable. Enable WebGL2 or use a current desktop Chromium/Firefox browser; canonical simulation state remains intact.'
      );
    }
    this.gl = gl;
    this.program = createProgram(gl);
    this.locations = Object.freeze({
      position: attributeLocation(gl, this.program, 'a_position'),
      color: attributeLocation(gl, this.program, 'a_color'),
      pointSize: attributeLocation(gl, this.program, 'a_pointSize'),
      pointMode: uniformLocation(gl, this.program, 'u_pointMode'),
      clipScale: uniformLocation(gl, this.program, 'u_clipScale'),
      clipOffset: uniformLocation(gl, this.program, 'u_clipOffset'),
      pointScale: uniformLocation(gl, this.program, 'u_pointScale')
    });
    this.slots = Object.freeze({
      artworkLines: this._createGeometrySlot(),
      artworkPoints: this._createGeometrySlot(),
      fieldPoints: this._createGeometrySlot(),
      emitterPoints: this._createGeometrySlot()
    });
    this.rendererName = String(gl.getParameter(gl.RENDERER) ?? 'unknown');
    this.vendorName = String(gl.getParameter(gl.VENDOR) ?? 'unknown');

    this._onContextLost = (event) => {
      event.preventDefault();
      this._contextLost = true;
      this.lastDiagnostics = Object.freeze({ ...this.lastDiagnostics, state: 'context-lost' });
    };
    this._onContextRestored = () => {
      this._contextLost = false;
      this._contextRequiresReload = true;
      this.lastDiagnostics = Object.freeze({ ...this.lastDiagnostics, state: 'context-restored-reload-required' });
    };
    this.canvas.addEventListener?.('webglcontextlost', this._onContextLost, false);
    this.canvas.addEventListener?.('webglcontextrestored', this._onContextRestored, false);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.035, 0.043, 0.031, 1.0);
  }

  _createGeometrySlot() {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!buffer || !vao) throw new RendererUnavailableError('WebGL2 could not allocate renderer buffers.');
    const stride = VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.locations.color);
    gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
    gl.enableVertexAttribArray(this.locations.pointSize);
    gl.vertexAttribPointer(this.locations.pointSize, 1, gl.FLOAT, false, stride, 6 * Float32Array.BYTES_PER_ELEMENT);
    gl.bindVertexArray(null);
    return { buffer, vao, vertexCount: 0, byteLength: 0 };
  }

  _uploadSlot(slot, vertices, usage) {
    if (!(vertices instanceof Float32Array)) throw new TypeError('renderer vertices must be Float32Array.');
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, slot.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, usage);
    slot.vertexCount = vertices.length / VERTEX_FLOATS;
    slot.byteLength = vertices.byteLength;
  }

  _setTransform(clipScaleX, clipScaleY, clipOffsetX, clipOffsetY, pointScale) {
    const gl = this.gl;
    gl.uniform2f(this.locations.clipScale, clipScaleX, clipScaleY);
    gl.uniform2f(this.locations.clipOffset, clipOffsetX, clipOffsetY);
    gl.uniform1f(this.locations.pointScale, pointScale);
  }

  _drawSlot(slot, mode, pointMode, transform, pointScale) {
    if (slot.vertexCount === 0) return 0;
    const gl = this.gl;
    this._setTransform(
      transform.clipScaleX,
      transform.clipScaleY,
      transform.clipOffsetX,
      transform.clipOffsetY,
      pointScale
    );
    gl.uniform1i(this.locations.pointMode, pointMode ? 1 : 0);
    gl.bindVertexArray(slot.vao);
    gl.drawArrays(mode, 0, slot.vertexCount);
    return 1;
  }

  resize(widthCssPx = this.canvas.clientWidth || 1, heightCssPx = this.canvas.clientHeight || 1, devicePixelRatio = globalThis.devicePixelRatio || 1) {
    const next = createViewport({ ...this.view, widthCssPx: Math.max(1, Math.round(widthCssPx)), heightCssPx: Math.max(1, Math.round(heightCssPx)), devicePixelRatio });
    this.view = next;
    const framebufferWidth = Math.max(1, Math.round(next.widthCssPx * next.devicePixelRatio));
    const framebufferHeight = Math.max(1, Math.round(next.heightCssPx * next.devicePixelRatio));
    if (this.canvas.width !== framebufferWidth) this.canvas.width = framebufferWidth;
    if (this.canvas.height !== framebufferHeight) this.canvas.height = framebufferHeight;
    this.gl.viewport(0, 0, framebufferWidth, framebufferHeight);
    return next;
  }

  setViewport(viewport) {
    this.view = createViewport({ ...this.view, ...viewport });
    return this.view;
  }

  panByPixels(deltaCssX, deltaCssY) {
    this.view = panViewport(this.view, deltaCssX, deltaCssY);
    return this.view;
  }

  zoomBy(factor) {
    this.view = zoomViewport(this.view, factor);
    return this.view;
  }

  resetPreview() {
    this.accumulator.reset();
    this.geometryCache.invalidate();
    this.lastConsumedDepositionCount = 0;
    this.lastConsumedRecord = null;
    this.slots.artworkLines.vertexCount = 0;
    this.slots.artworkPoints.vertexCount = 0;
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  rebuildPreview(depositions) {
    this.accumulator.rebuild(depositions);
    this.geometryCache.invalidate();
    this.lastConsumedDepositionCount = depositions.length;
    this.lastConsumedRecord = depositions.length === 0 ? null : depositions[depositions.length - 1];
  }

  _synchronizeDepositions(depositions) {
    if (!Array.isArray(depositions)) throw new TypeError('depositions must be an array.');
    const priorTailStillMatches = this.lastConsumedDepositionCount === 0 ||
      depositions[this.lastConsumedDepositionCount - 1] === this.lastConsumedRecord;
    if (depositions.length < this.lastConsumedDepositionCount || !priorTailStillMatches) {
      this.rebuildPreview(depositions);
      return;
    }
    this.accumulator.appendMany(depositions, this.lastConsumedDepositionCount);
    this.lastConsumedDepositionCount = depositions.length;
    this.lastConsumedRecord = depositions.length === 0 ? null : depositions[depositions.length - 1];
  }

  render({ depositions = [], fieldCollection = null, emitters = [], showOverlays = this.showOverlays } = {}) {
    if (this._contextLost) throw new RendererUnavailableError('WebGL2 context is currently lost; canonical simulation state was not modified.');
    if (this._contextRequiresReload) throw new RendererUnavailableError('WebGL2 context was restored, but renderer resources must be reinitialized by reloading the local app; canonical state remains intact.');
    const started = clockNow();
    this.resize();
    this._synchronizeDepositions(depositions);

    const revision = this.accumulator.revision;
    let geometryState = this.geometryCache.snapshot(false);
    let geometryRebuilt = false;
    let geometryBuildMs = 0;
    if (!this.geometryCache.matches(revision)) {
      const buildStarted = clockNow();
      geometryState = this.geometryCache.rebuild(this.accumulator.snapshot(), revision, this.view);
      geometryBuildMs = clockNow() - buildStarted;
      geometryRebuilt = true;
    }
    if (!geometryState) throw new RendererUnavailableError('Preview geometry cache did not initialize.');

    const transform = createViewportTransform(geometryState.referenceViewport, this.view);
    const overlays = prepareOverlayGeometry({ fieldCollection, emitters }, this.view);
    const preparedAt = clockNow();

    const gl = this.gl;
    if (geometryRebuilt) {
      this._uploadSlot(this.slots.artworkLines, geometryState.artwork.lines, gl.STATIC_DRAW);
      this._uploadSlot(this.slots.artworkPoints, geometryState.artwork.points, gl.STATIC_DRAW);
    }
    if (showOverlays) {
      this._uploadSlot(this.slots.fieldPoints, overlays.fieldPoints, gl.DYNAMIC_DRAW);
      this._uploadSlot(this.slots.emitterPoints, overlays.emitterPoints, gl.DYNAMIC_DRAW);
    } else {
      this.slots.fieldPoints.vertexCount = 0;
      this.slots.emitterPoints.vertexCount = 0;
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    let drawCalls = 0;
    drawCalls += this._drawSlot(this.slots.artworkLines, gl.LINES, false, transform, transform.artworkPointScale);
    drawCalls += this._drawSlot(this.slots.artworkPoints, gl.POINTS, true, transform, transform.artworkPointScale);
    if (showOverlays) {
      const overlayTransform = { clipScaleX: 1, clipScaleY: 1, clipOffsetX: 0, clipOffsetY: 0 };
      drawCalls += this._drawSlot(this.slots.fieldPoints, gl.POINTS, true, overlayTransform, transform.overlayPointScale);
      drawCalls += this._drawSlot(this.slots.emitterPoints, gl.POINTS, true, overlayTransform, transform.overlayPointScale);
    }
    gl.bindVertexArray(null);
    const ended = clockNow();
    const accumulation = this.accumulator.diagnostics();
    const artworkBytes = geometryState.artwork.byteLength;
    const overlayBytes = showOverlays ? overlays.byteLength : 0;

    this.lastDiagnostics = Object.freeze({
      state: 'ready',
      frameMs: ended - started,
      prepareMs: preparedAt - started,
      submitMs: ended - preparedAt,
      geometryRebuilt,
      geometryBuildMs,
      geometryRebuildCount: geometryState.rebuildCount,
      geometryRevision: geometryState.revision,
      drawCalls,
      pointVertices: geometryState.artwork.pointCount,
      lineVertices: geometryState.artwork.lineVertexCount,
      overlayVertices: showOverlays ? overlays.emitterCount + overlays.fieldCount : 0,
      bufferBytes: artworkBytes + overlayBytes,
      cachedArtworkBytes: artworkBytes,
      overlayBufferBytes: overlayBytes,
      gpuUploadBytes: (geometryRebuilt ? artworkBytes : 0) + overlayBytes,
      previewDepositions: accumulation.size,
      previewDropped: accumulation.totalDropped,
      previewCapacity: accumulation.capacity,
      previewTruncated: accumulation.truncated,
      viewport: this.view,
      framebuffer: Object.freeze({ width: this.canvas.width, height: this.canvas.height }),
      renderer: this.rendererName,
      vendor: this.vendorName
    });
    return this.lastDiagnostics;
  }

  diagnostics() {
    return this.lastDiagnostics;
  }

  dispose() {
    this.canvas.removeEventListener?.('webglcontextlost', this._onContextLost, false);
    this.canvas.removeEventListener?.('webglcontextrestored', this._onContextRestored, false);
    for (const slot of Object.values(this.slots)) {
      if (this.gl.isBuffer(slot.buffer)) this.gl.deleteBuffer(slot.buffer);
      if (this.gl.isVertexArray(slot.vao)) this.gl.deleteVertexArray(slot.vao);
    }
    if (this.gl.isProgram(this.program)) this.gl.deleteProgram(this.program);
  }
}

export function createWebGL2Renderer(canvas, options = {}) {
  return new WebGL2PreviewRenderer(canvas, options);
}
