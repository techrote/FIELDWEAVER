import {
  DEFAULT_MAX_PREVIEW_DEPOSITIONS,
  PreviewAccumulator,
  VERTEX_FLOATS,
  createViewport,
  panViewport,
  prepareFrameModel,
  zoomViewport
} from './prepare.js';

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
in vec4 a_color;
in float a_pointSize;
out vec4 v_color;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  gl_PointSize = a_pointSize;
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
    this.view = createViewport(options.viewport ?? {});
    this.showOverlays = options.showOverlays ?? true;
    this.lastConsumedDepositionCount = 0;
    this.lastDiagnostics = Object.freeze({ state: 'initializing' });
    this._contextLost = false;

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
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    if (!this.buffer || !this.vao) throw new RendererUnavailableError('WebGL2 could not allocate renderer buffers.');

    this.locations = Object.freeze({
      position: attributeLocation(gl, this.program, 'a_position'),
      color: attributeLocation(gl, this.program, 'a_color'),
      pointSize: attributeLocation(gl, this.program, 'a_pointSize'),
      pointMode: uniformLocation(gl, this.program, 'u_pointMode')
    });

    this._onContextLost = (event) => {
      event.preventDefault();
      this._contextLost = true;
      this.lastDiagnostics = Object.freeze({ ...this.lastDiagnostics, state: 'context-lost' });
    };
    this._onContextRestored = () => {
      this._contextLost = false;
      this.lastDiagnostics = Object.freeze({ ...this.lastDiagnostics, state: 'context-restored-reload-required' });
    };
    this.canvas.addEventListener?.('webglcontextlost', this._onContextLost, false);
    this.canvas.addEventListener?.('webglcontextrestored', this._onContextRestored, false);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.035, 0.043, 0.031, 1.0);
    this._configureVertexArray();
  }

  _configureVertexArray() {
    const gl = this.gl;
    const stride = VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.locations.color);
    gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
    gl.enableVertexAttribArray(this.locations.pointSize);
    gl.vertexAttribPointer(this.locations.pointSize, 1, gl.FLOAT, false, stride, 6 * Float32Array.BYTES_PER_ELEMENT);
    gl.bindVertexArray(null);
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
    this.lastConsumedDepositionCount = 0;
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  rebuildPreview(depositions) {
    this.accumulator.rebuild(depositions);
    this.lastConsumedDepositionCount = depositions.length;
  }

  _synchronizeDepositions(depositions) {
    if (!Array.isArray(depositions)) throw new TypeError('depositions must be an array.');
    if (depositions.length < this.lastConsumedDepositionCount) {
      this.rebuildPreview(depositions);
      return;
    }
    this.accumulator.appendMany(depositions, this.lastConsumedDepositionCount);
    this.lastConsumedDepositionCount = depositions.length;
  }

  _draw(vertices, mode, pointMode) {
    if (vertices.length === 0) return 0;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.uniform1i(this.locations.pointMode, pointMode ? 1 : 0);
    gl.drawArrays(mode, 0, vertices.length / VERTEX_FLOATS);
    return 1;
  }

  render({ depositions = [], fieldCollection = null, emitters = [], showOverlays = this.showOverlays } = {}) {
    if (this._contextLost) throw new RendererUnavailableError('WebGL2 context is currently lost; canonical simulation state was not modified.');
    const started = clockNow();
    this.resize();
    this._synchronizeDepositions(depositions);
    const records = this.accumulator.snapshot();
    const frame = prepareFrameModel({ depositions: records, fieldCollection, emitters }, this.view);
    const preparedAt = clockNow();

    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    let drawCalls = 0;
    drawCalls += this._draw(frame.artwork.lines, gl.LINES, false);
    drawCalls += this._draw(frame.artwork.points, gl.POINTS, true);
    if (showOverlays) {
      drawCalls += this._draw(frame.overlays.fieldPoints, gl.POINTS, true);
      drawCalls += this._draw(frame.overlays.emitterPoints, gl.POINTS, true);
    }
    gl.bindVertexArray(null);
    const ended = clockNow();
    const accumulation = this.accumulator.diagnostics();

    this.lastDiagnostics = Object.freeze({
      state: 'ready',
      frameMs: ended - started,
      prepareMs: preparedAt - started,
      submitMs: ended - preparedAt,
      drawCalls,
      pointVertices: frame.artwork.pointCount,
      lineVertices: frame.artwork.lineVertexCount,
      overlayVertices: showOverlays ? frame.overlays.emitterCount + frame.overlays.fieldCount : 0,
      bufferBytes: frame.artwork.byteLength + (showOverlays ? frame.overlays.byteLength : 0),
      previewDepositions: accumulation.size,
      previewDropped: accumulation.totalDropped,
      previewCapacity: accumulation.capacity,
      previewTruncated: accumulation.truncated,
      viewport: frame.viewport,
      framebuffer: Object.freeze({ width: this.canvas.width, height: this.canvas.height }),
      renderer: String(gl.getParameter(gl.RENDERER) ?? 'unknown'),
      vendor: String(gl.getParameter(gl.VENDOR) ?? 'unknown')
    });
    return this.lastDiagnostics;
  }

  diagnostics() {
    return this.lastDiagnostics;
  }

  dispose() {
    this.canvas.removeEventListener?.('webglcontextlost', this._onContextLost, false);
    this.canvas.removeEventListener?.('webglcontextrestored', this._onContextRestored, false);
    if (this.gl.isBuffer(this.buffer)) this.gl.deleteBuffer(this.buffer);
    if (this.gl.isVertexArray(this.vao)) this.gl.deleteVertexArray(this.vao);
    if (this.gl.isProgram(this.program)) this.gl.deleteProgram(this.program);
  }
}

export function createWebGL2Renderer(canvas, options = {}) {
  return new WebGL2PreviewRenderer(canvas, options);
}
