import { createFoundationSnapshot } from './core/index.js';
import { translateWorldPosition } from './core/coordinates.js';
import { Q16_ONE } from './core/numeric.js';
import { EditorSession, worldPositionFromUnits, worldPositionToUnits } from './editor/index.js';
import { RendererUnavailableError, createWebGL2Renderer, worldToCanvas } from './renderer/index.js';
import { mountApplicationShell } from './ui/shell.js';
import { APP_VERSION } from './version.js';

const BASE_TICKS_PER_SECOND = 60;
const MAX_TICKS_PER_FRAME = 16;

function capturePointerIfAvailable(canvas, pointerId) {
  try { canvas.setPointerCapture?.(pointerId); } catch (error) { if (error?.name !== 'NotFoundError') throw error; }
}

function releasePointerIfCaptured(canvas, pointerId) {
  try { if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture?.(pointerId); } catch (error) { if (error?.name !== 'NotFoundError') throw error; }
}

function isTextInput(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

function bootstrap() {
  const root = document.querySelector('#app');
  if (!root) throw new Error('FIELDWEAVER application root #app was not found.');

  document.documentElement.dataset.fieldweaverVersion = APP_VERSION;
  const shell = mountApplicationShell(root, createFoundationSnapshot());
  const editor = new EditorSession();

  let renderer;
  try {
    renderer = createWebGL2Renderer(shell.canvas, {
      maxPreviewDepositions: 100_000,
      viewport: {
        widthCssPx: Math.max(1, shell.canvas.clientWidth || 960),
        heightCssPx: Math.max(1, shell.canvas.clientHeight || 640),
        devicePixelRatio: window.devicePixelRatio || 1,
        zoom: 3.25,
        center: worldPositionFromUnits(132, 128)
      }
    });
  } catch (error) {
    if (error instanceof RendererUnavailableError) {
      shell.setRendererError(error.message);
      shell.updateEditorState(editor.snapshot());
      return;
    }
    throw error;
  }

  let renderFrame = 0;
  let renderRequestCount = 0;
  let renderExecutionCount = 0;
  let schedulerBacklogTicks = 0;
  let schedulerFraction = 0;
  let lastSchedulerTime = performance.now();
  let editorError = '';

  const publishRenderCounters = () => {
    document.documentElement.dataset.fieldweaverRenderRequests = String(renderRequestCount);
    document.documentElement.dataset.fieldweaverRenderExecutions = String(renderExecutionCount);
  };

  const publishEditorIdentity = () => {
    const hash = editor.authoringHash();
    document.documentElement.dataset.fieldweaverCanonicalRecipeHash = hash;
    // Retain the pre-editor dataset name for renderer-isolation acceptance compatibility.
    document.documentElement.dataset.fieldweaverCanonicalResultHash = hash;
  };

  const canvasPointToWorld = (clientX, clientY) => {
    const rect = shell.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const view = renderer.view;
    const deltaXQ16 = Math.round(((x - view.widthCssPx / 2) / view.zoom) * Q16_ONE);
    const deltaYQ16 = Math.round((-(y - view.heightCssPx / 2) / view.zoom) * Q16_ONE);
    return translateWorldPosition(view.center, deltaXQ16, deltaYQ16);
  };

  const syncOverlaySize = () => {
    const dpr = renderer.view.devicePixelRatio;
    const width = Math.max(1, Math.round(renderer.view.widthCssPx * dpr));
    const height = Math.max(1, Math.round(renderer.view.heightCssPx * dpr));
    if (shell.overlayCanvas.width !== width) shell.overlayCanvas.width = width;
    if (shell.overlayCanvas.height !== height) shell.overlayCanvas.height = height;
  };

  const drawOverlay = () => {
    syncOverlaySize();
    const ctx = shell.overlayCanvas.getContext('2d');
    if (!ctx) return;
    const dpr = renderer.view.devicePixelRatio;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, renderer.view.widthCssPx, renderer.view.heightCssPx);

    const selectedLayer = editor.selectedFieldId === null ? null : editor.fieldCollection.getLayer(editor.selectedFieldId);
    if (selectedLayer) {
      const serialized = selectedLayer.toCanonical();
      const cellSpanUnits = 256 / selectedLayer.cellsPerChunk;
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = 'rgb(87 221 126)';
      for (const chunk of serialized.chunks) {
        for (const cell of chunk.cells) {
          const linear = cell[0];
          const cellX = linear % selectedLayer.cellsPerChunk;
          const cellY = Math.floor(linear / selectedLayer.cellsPerChunk);
          const world = worldPositionFromUnits(
            chunk.chunkX * 256 + (cellX + 0.5) * cellSpanUnits,
            chunk.chunkY * 256 + (cellY + 0.5) * cellSpanUnits
          );
          const point = worldToCanvas(world, renderer.view);
          const size = Math.max(1, cellSpanUnits * renderer.view.zoom);
          if (point.x + size < 0 || point.y + size < 0 || point.x - size > renderer.view.widthCssPx || point.y - size > renderer.view.heightCssPx) continue;
          ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;
    }

    for (const layer of editor.fieldCollection.orderedLayers()) {
      const point = worldToCanvas(layer.transform.origin, renderer.view);
      ctx.strokeStyle = layer.id === editor.selectedFieldId ? 'rgb(255 201 104)' : 'rgb(112 232 142)';
      ctx.lineWidth = layer.id === editor.selectedFieldId ? 2 : 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, layer.id === editor.selectedFieldId ? 9 : 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText(`F${layer.id}`, point.x + 11, point.y - 7);
    }

    const state = editor.snapshot(schedulerBacklogTicks);
    for (const emitter of state.emitters) {
      const point = worldToCanvas(emitter.origin, renderer.view);
      ctx.strokeStyle = emitter.id === state.selectedEmitterId ? 'rgb(255 255 255)' : 'rgb(185 194 178)';
      ctx.lineWidth = emitter.id === state.selectedEmitterId ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(point.x - 7, point.y);
      ctx.lineTo(point.x + 7, point.y);
      ctx.moveTo(point.x, point.y - 7);
      ctx.lineTo(point.x, point.y + 7);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText(`E${emitter.id}`, point.x + 9, point.y + 12);
    }
  };

  const updateEditorUi = () => {
    publishEditorIdentity();
    shell.updateEditorState(editor.snapshot(schedulerBacklogTicks));
    if (editorError) document.querySelector('#canvas-status').textContent = editorError;
  };

  const render = () => {
    renderExecutionCount += 1;
    publishRenderCounters();
    try {
      const diagnostics = renderer.render({
        depositions: editor.simulation.depositions,
        fieldCollection: editor.fieldCollection,
        emitters: editor.simulation.emitters,
        showOverlays: true
      });
      shell.updateRendererDiagnostics(diagnostics);
      drawOverlay();
      updateEditorUi();
    } catch (error) {
      editor.pause();
      shell.setRendererError(`Preview stopped: ${error.message}`);
      updateEditorUi();
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

  const resetSchedulerDebt = () => {
    schedulerBacklogTicks = 0;
    schedulerFraction = 0;
    lastSchedulerTime = performance.now();
  };

  const action = (callback, { authoring = false } = {}) => {
    try {
      editorError = '';
      const result = callback();
      if (authoring) resetSchedulerDebt();
      updateEditorUi();
      scheduleRender();
      return result;
    } catch (error) {
      editorError = error?.message ?? String(error);
      editor.pause();
      updateEditorUi();
      return null;
    }
  };

  const controls = shell.controls;
  for (const [tool, control] of Object.entries(controls.toolButtons)) {
    control.addEventListener('click', () => action(() => editor.setTool(tool)));
  }
  controls.runButton.addEventListener('click', () => action(() => {
    const running = editor.toggleRun();
    if (running) lastSchedulerTime = performance.now();
    else resetSchedulerDebt();
  }));
  controls.stepButton.addEventListener('click', () => action(() => { resetSchedulerDebt(); editor.singleStep(); }));
  controls.multiStepButton.addEventListener('click', () => action(() => { resetSchedulerDebt(); editor.multiStep(); }));
  controls.resetButton.addEventListener('click', () => action(() => { resetSchedulerDebt(); editor.resetSimulation(); }));
  controls.speedSelect.addEventListener('change', () => action(() => editor.setSpeedMultiplier(Number(controls.speedSelect.value))));
  controls.multiStepInput.addEventListener('change', () => action(() => editor.setMultiStepCount(Number(controls.multiStepInput.value))));

  controls.fieldList.addEventListener('click', (event) => {
    const target = event.target.closest('[data-field-id]');
    if (target) action(() => editor.selectField(Number(target.dataset.fieldId)));
  });
  controls.addFieldButton.addEventListener('click', () => action(() => editor.createField(controls.newFieldOperator.value), { authoring: true }));
  controls.deleteFieldButton.addEventListener('click', () => action(() => editor.deleteField(), { authoring: true }));
  controls.fieldUpButton.addEventListener('click', () => action(() => editor.moveSelectedFieldBy(-1), { authoring: true }));
  controls.fieldDownButton.addEventListener('click', () => action(() => editor.moveSelectedFieldBy(1), { authoring: true }));
  controls.fieldEnabled.addEventListener('change', () => action(() => editor.setFieldEnabled(editor.selectedFieldId, controls.fieldEnabled.checked), { authoring: true }));
  controls.fieldParamGrid.addEventListener('change', (event) => {
    const input = event.target.closest('[data-field-param]');
    if (input) action(() => editor.updateSelectedFieldParameter(input.dataset.fieldParam, Number(input.value)), { authoring: true });
  });

  const updateBrush = () => action(() => editor.setBrush({
    radius: Number(controls.brushRadius.value),
    valueXQ16: Math.round(Number(controls.brushX.value) * Q16_ONE),
    valueYQ16: Math.round(Number(controls.brushY.value) * Q16_ONE)
  }));
  controls.brushRadius.addEventListener('input', updateBrush);
  controls.brushX.addEventListener('change', updateBrush);
  controls.brushY.addEventListener('change', updateBrush);
  controls.undoButton.addEventListener('click', () => action(() => editor.undoAuthoring(), { authoring: true }));
  controls.redoButton.addEventListener('click', () => action(() => editor.redoAuthoring(), { authoring: true }));

  controls.emitterSelect.addEventListener('change', () => action(() => editor.selectEmitter(Number(controls.emitterSelect.value))));
  controls.emitterMaterial.addEventListener('change', () => action(() => editor.updateSelectedEmitter({ materialId: Number(controls.emitterMaterial.value) }), { authoring: true }));
  controls.emitterRate.addEventListener('change', () => action(() => editor.updateSelectedEmitter({ rate: Number(controls.emitterRate.value) }), { authoring: true }));
  controls.emitterAdd.addEventListener('click', () => action(() => editor.addEmitter(renderer.view.center), { authoring: true }));
  controls.emitterDelete.addEventListener('click', () => action(() => editor.deleteEmitter(), { authoring: true }));

  controls.materialSelect.addEventListener('change', () => action(() => editor.selectMaterial(Number(controls.materialSelect.value))));
  const updateMaterial = () => action(() => editor.updateSelectedMaterial({
    lifetimeTicks: Number(controls.materialLifetime.value),
    depositEvery: Number(controls.materialDepositEvery.value),
    steeringNumerator: Number(controls.materialSteering.value)
  }), { authoring: true });
  controls.materialLifetime.addEventListener('change', updateMaterial);
  controls.materialDepositEvery.addEventListener('change', updateMaterial);
  controls.materialSteering.addEventListener('change', updateMaterial);

  controls.seedApply.addEventListener('click', () => action(() => editor.setRootSeed(Number(controls.seedInput.value)), { authoring: true }));
  controls.seedRandom.addEventListener('click', () => action(() => {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    editor.setRootSeed(values[0]);
  }, { authoring: true }));

  let dragging = false;
  let pointerMode = null;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let strokePoints = [];
  let dragDestination = null;

  shell.canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    pointerMode = editor.tool;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    strokePoints = [];
    dragDestination = canvasPointToWorld(event.clientX, event.clientY);
    capturePointerIfAvailable(shell.canvas, event.pointerId);

    if (pointerMode === 'paint' || pointerMode === 'erase') strokePoints.push(dragDestination);
    else if (pointerMode === 'place-emitter') {
      action(() => editor.addEmitter(dragDestination), { authoring: true });
      dragging = false;
      releasePointerIfCaptured(shell.canvas, event.pointerId);
    }
  });

  shell.canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    if (pointerMode === 'pan') {
      const dx = event.clientX - lastPointerX;
      const dy = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      renderer.panByPixels(dx, dy);
      scheduleRender();
      return;
    }
    dragDestination = canvasPointToWorld(event.clientX, event.clientY);
    if (pointerMode === 'paint' || pointerMode === 'erase') strokePoints.push(dragDestination);
  });

  const stopDragging = (event) => {
    if (!dragging) return;
    const completedMode = pointerMode;
    const destination = dragDestination;
    dragging = false;
    pointerMode = null;
    releasePointerIfCaptured(shell.canvas, event.pointerId);
    if ((completedMode === 'paint' || completedMode === 'erase') && strokePoints.length > 0) {
      action(() => editor.paintStroke(strokePoints, completedMode === 'erase' ? 'erase' : 'set'), { authoring: true });
    } else if (completedMode === 'move-field' && destination) {
      action(() => editor.moveSelectedFieldOrigin(destination), { authoring: true });
    } else if (completedMode === 'move-emitter' && destination) {
      action(() => editor.moveSelectedEmitter(destination), { authoring: true });
    }
    strokePoints = [];
  };
  shell.canvas.addEventListener('pointerup', stopDragging);
  shell.canvas.addEventListener('pointercancel', stopDragging);

  shell.canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    renderer.zoomBy(Math.exp(-event.deltaY * 0.001));
    scheduleRender();
  }, { passive: false });

  window.addEventListener('resize', scheduleRender, { passive: true });

  window.addEventListener('keydown', (event) => {
    if (isTextInput(event.target)) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      action(() => event.shiftKey ? editor.redoAuthoring() : editor.undoAuthoring(), { authoring: true });
      return;
    }
    if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      action(() => editor.redoAuthoring(), { authoring: true });
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      action(() => { const running = editor.toggleRun(); if (running) lastSchedulerTime = performance.now(); else resetSchedulerDebt(); });
      return;
    }
    if (event.key === '.') {
      event.preventDefault();
      action(() => { resetSchedulerDebt(); if (event.shiftKey) editor.multiStep(); else editor.singleStep(); });
      return;
    }
    const toolKey = { p: 'pan', b: 'paint', e: 'erase', v: 'move-field', n: 'place-emitter', m: 'move-emitter' }[event.key.toLowerCase()];
    if (toolKey) { event.preventDefault(); action(() => editor.setTool(toolKey)); return; }
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); action(() => { resetSchedulerDebt(); editor.resetSimulation(); }); return; }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); renderer.zoomBy(1.12); scheduleRender(); return; }
    if (event.key === '-' || event.key === '_') { event.preventDefault(); renderer.zoomBy(1 / 1.12); scheduleRender(); return; }
    const pan = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] }[event.key];
    if (pan) { event.preventDefault(); renderer.panByPixels(pan[0], pan[1]); scheduleRender(); }
  });

  const schedulerFrame = (now) => {
    const elapsedMs = Math.max(0, now - lastSchedulerTime);
    lastSchedulerTime = now;
    if (editor.running) {
      schedulerFraction += (elapsedMs / 1000) * BASE_TICKS_PER_SECOND * editor.speedMultiplier;
      const due = Math.floor(schedulerFraction);
      if (due > 0) {
        schedulerFraction -= due;
        schedulerBacklogTicks += due;
      }
      if (schedulerBacklogTicks > 0) {
        const batch = Math.min(MAX_TICKS_PER_FRAME, schedulerBacklogTicks);
        try {
          editor.runTicks(batch);
          schedulerBacklogTicks -= batch;
          scheduleRender();
        } catch (error) {
          editorError = error?.message ?? String(error);
          editor.pause();
          resetSchedulerDebt();
          updateEditorUi();
        }
      } else {
        updateEditorUi();
      }
    }
    requestAnimationFrame(schedulerFrame);
  };

  publishRenderCounters();
  publishEditorIdentity();
  updateEditorUi();
  render();
  requestAnimationFrame(schedulerFrame);
}

bootstrap();
