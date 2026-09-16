import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  DeterministicSimulationKernel,
  FixedStepController,
  addSaturatedInt32
} from '../src/core/index.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/fw-002-golden.json', import.meta.url), 'utf8'));

function createFixtureKernel() {
  return new DeterministicSimulationKernel({
    rootSeed: fixture.rootSeed,
    streamId: fixture.streamId,
    tables: [{
      name: 'probes',
      capacity: 8,
      schema: { energy: 'u32', x: 'i32', y: 'i32' },
      initialRows: [
        { energy: 1, x: -10, y: 20 },
        { energy: 2, x: 30, y: -40 },
        { energy: 3, x: 0, y: 0 }
      ]
    }],
    tickHandler({ randomUint32, table }) {
      const probes = table('probes');
      probes.forEachOrdered((id) => {
        const dx = (randomUint32() & 0xffff) - 0x8000;
        const dy = (randomUint32() & 0xffff) - 0x8000;
        probes.set(id, 'x', addSaturatedInt32(probes.get(id, 'x'), dx));
        probes.set(id, 'y', addSaturatedInt32(probes.get(id, 'y'), dy));
        probes.set(id, 'energy', (probes.get(id, 'energy') + randomUint32()) >>> 0);
      });
    }
  });
}

test('repeated identical long runs reproduce the golden canonical hash', () => {
  const first = createFixtureKernel();
  const second = createFixtureKernel();
  first.advanceMany(fixture.ticks);
  second.advanceMany(fixture.ticks);

  assert.equal(first.hash(), fixture.hashAtTick);
  assert.equal(second.hash(), fixture.hashAtTick);
  assert.equal(first.serialize(), second.serialize());
});

test('reset recreates the identical initial canonical hash', () => {
  const kernel = createFixtureKernel();
  assert.equal(kernel.hash(), fixture.initialHash);
  kernel.advanceMany(250);
  assert.notEqual(kernel.hash(), fixture.initialHash);
  assert.equal(kernel.reset(), fixture.initialHash);
  assert.equal(kernel.tick, 0);
});

test('speed scheduling changes requested tick count only, not same-tick results', () => {
  const direct = createFixtureKernel();
  direct.advanceMany(120);

  const scheduled = createFixtureKernel();
  const controller = new FixedStepController(scheduled);
  controller.setSpeed(3, 2);
  controller.run();
  let executed = 0;
  for (let index = 0; index < 80; index += 1) {
    executed += controller.schedule(1);
  }

  assert.equal(executed, 120);
  assert.equal(scheduled.tick, direct.tick);
  assert.equal(scheduled.hash(), direct.hash());
});

test('pause, exact step, multi-step, and controller reset have explicit tick semantics', () => {
  const kernel = createFixtureKernel();
  const controller = new FixedStepController(kernel);
  assert.equal(controller.schedule(20), 0);
  assert.equal(kernel.tick, 0);
  assert.equal(controller.singleStep(), 1);
  assert.equal(controller.multiStep(9), 10);
  controller.run();
  controller.setSpeed(1, 2);
  assert.equal(controller.schedule(1), 0);
  assert.equal(controller.schedule(1), 1);
  assert.equal(kernel.tick, 11);
  assert.equal(controller.reset(), fixture.initialHash);
  assert.equal(controller.running, false);
});
