import { expect, it } from 'vitest';
import { neutralInput } from '../../src/input/types';
import { applySnap, packState, sanitizeInput } from '../../src/net/snapshot';
import { createGame, step } from '../../src/simulation/state';

it('roundtrips the visual state used by online snapshots', () => {
  const game = createGame();
  const forward = { ...neutralInput(), right: true, buttons: 1, taps: 1 };
  for (let i = 0; i < 20; i++) step(game, [forward, neutralInput()]);
  const snap = packState(game, { st: 10, waiting: false, names: ['A', 'B'], seats: [true, true] });
  const shell = createGame();
  applySnap(shell, snap);
  expect(shell.frame).toBe(game.frame);
  expect(shell.fighters[0].x).toBe(game.fighters[0].x);
  expect(shell.fighters[0].state).toBe(game.fighters[0].state);
  expect(shell.fighters[0].vx).toBe(game.fighters[0].vx);
  expect(shell.round.timer).toBe(game.round.timer);
  expect(shell.fighters[0].resources.special.current).toBe(game.fighters[0].resources.special.current);
  expect(snap.names).toEqual(['A', 'B']);
});

it('clamps online button bits and ignores malformed input', () => {
  expect(sanitizeInput({ left: 1, right: false, up: 0, down: true, b: 9999, tap: 3 }).buttons).toBe(9999 & 511);
  expect(sanitizeInput(null)).toEqual({ left: false, right: false, up: false, down: false, buttons: 0, taps: 0 });
});
