import { createFoundationSnapshot } from './core/index.js';
import { Q16_ONE } from './core/numeric.js';
import { createRendererDemoSimulation } from './demo.js';
import { RendererUnavailableError, createWebGL2Renderer } from './renderer/index.js';
import { mountApplicationShell } from './ui/shell.js';
import { APP_VERSION } from './version.js';

function bootstrap() {
  const root = document.querySelector('#app');
  if (!root) throw new Error('FIELDWEAVER application root #app was not found.');

  document.documentElement.dataset.fieldweaverVersion = APP_VERSION;
  const shell = mountApplicationShell(root, createFoundationSnapshot());
  const demo = createRendererDemoSimulation();
  const canonicalResultHash = demo.simulation.resultHash();

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

  const render = () => {
    try {
      const diagnostics = renderer.render({
        depositions: demo.simulation.depositions,
        fieldCollection: demo.fieldCollection,
        emitters: demo.emitters,
        showOverlays: true
      });
      if (demo.simulation.resultHash() !== canonicalResultHash) {
        throw new Error('Renderer mutated canonical simulation state; refusing to continue preview.');
      }
      shell.updateRendererDiagnostics(diagnostics);
    } catch (error) {
      shell.setRendererError(`Preview stopped: ${error.message}`);
    }
  };

  let dragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  shell.canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    shell.canvas.setPointerCapture?.(event.pointerId);
  });
  shell.canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    renderer.panByPixels(dx, dy);
    render();
  });
  const stopDragging = (event) => {
    dragging = false;
    shell.canvas.releasePointerCapture?.(event.pointerId);
  };
  shell.canvas.addEventListener('pointerup', stopDragging);
  shell.canvas.addEventListener('pointercancel', stopDragging);
  shell.canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    renderer.zoomBy(Math.exp(-event.deltaY * 0.001));
    render();
  }, { passive: false });

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(render);
  }, { passive: true });

  render();
}

bootstrap();
