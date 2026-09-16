import { createFoundationSnapshot } from './core/index.js';
import { Q16_ONE } from './core/numeric.js';
import { createRendererDemoSimulation } from './demo.js';
import { RendererUnavailableError, createWebGL2Renderer } from './renderer/index.js';
import { mountApplicationShell } from './ui/shell.js';
import { APP_VERSION } from './version.js';

function capturePointerIfAvailable(canvas, pointerId) {
  try {
    canvas.setPointerCapture?.(pointerId);
  } catch (error) {
    if (error?.name !== 'NotFoundError') throw error;
  }
}

function releasePointerIfCaptured(canvas, pointerId) {
  try {
    if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture?.(pointerId);
  } catch (error) {
    if (error?.name !== 'NotFoundError') throw error;
  }
}

function bootstrap() {
  const root = document.querySelector('#app');
  if (!root) throw new Error('FIELDWEAVER application root #app was not found.');

  document.documentElement.dataset.fieldweaverVersion = APP_VERSION;
  const shell = mountApplicationShell(root, createFoundationSnapshot());
  const demo = createRendererDemoSimulation();
  const canonicalResultHash = demo.simulation.resultHash();
  const previewDepositions = Object.freeze([...demo.simulation.depositions]);
  document.documentElement.dataset.fieldweaverCanonicalResultHash = canonicalResultHash;

  let renderer;
  try {
    renderer = createWebGL2Renderer(shell.canvas, {
      maxPreviewDepositions: 100_000,
      viewport: {
        widthCssPx: Math.max(1, shell.canvas.clientWidth || 960),
        heightCssPx: Math.max(1, shell.canvas.clientHeight || 640),
        devicePixelRatio: window.devicePixelRatio || 1,
        zoom: 3.25,
        center: { chunkX: 0, chunkY: 0, localX: 132 * Q16_ONE, localY: 128 * Q16_ONE }
      }
    });
  } catch (error) {
    if (error instanceof RendererUnavailableError) {
      shell.setRendererError(error.message);
      return;
    }
    throw error;
  }

  let renderFrame = 0;
  let renderRequestCount = 0;
  let renderExecutionCount = 0;
  const publishRenderCounters = () => {
    document.documentElement.dataset.fieldweaverRenderRequests = String(renderRequestCount);
    document.documentElement.dataset.fieldweaverRenderExecutions = String(renderExecutionCount);
  };

  const render = () => {
    renderExecutionCount += 1;
    publishRenderCounters();
    try {
      const diagnostics = renderer.render({
        depositions: previewDepositions,
        fieldCollection: demo.fieldCollection,
        emitters: demo.emitters,
        showOverlays: true
      });
      shell.updateRendererDiagnostics(diagnostics);
    } catch (error) {
      shell.setRendererError(`Preview stopped: ${error.message}`);
    }
  };

  const scheduleRender = () => {
    renderRequestCount += 1;
    publishRenderCounters();
    if (renderFrame !== 0) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      render();
    });
  };

  let dragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  shell.canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    capturePointerIfAvailable(shell.canvas, event.pointerId);
  });
  shell.canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    renderer.panByPixels(dx, dy);
    scheduleRender();
  });
  const stopDragging = (event) => {
    dragging = false;
    releasePointerIfCaptured(shell.canvas, event.pointerId);
  };
  shell.canvas.addEventListener('pointerup', stopDragging);
  shell.canvas.addEventListener('pointercancel', stopDragging);
  shell.canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    renderer.zoomBy(Math.exp(-event.deltaY * 0.001));
    scheduleRender();
  }, { passive: false });

  window.addEventListener('resize', scheduleRender, { passive: true });

  publishRenderCounters();
  render();
}

bootstrap();
