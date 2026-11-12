import { expect, test } from 'bun:test';
import { matrixLayout, snapSlot } from './matrix-layout';
const items = (count: number) => Array.from({ length: count }, (_, i) => ({ id: i + 1, details: { matrixPosition: { x: .5, y: .5 } } }));
test('colliding saved positions get distinct slots, independent of input order', () => {
  const projects = items(15);
  const layout = matrixLayout(projects, 420);
  expect(new Set(layout.slots.values()).size).toBe(15);
  expect([...matrixLayout([...projects].reverse(), 420).slots]).toEqual([...layout.slots]);
});
test('narrow quadrants keep a readable single column', () => {
  const layout = matrixLayout(items(10), 140);
  expect(layout.columns).toBe(1);
  expect(layout.rows).toBe(10);
  expect(new Set(layout.slots.values()).size).toBe(10);
});
test('dropping into a full quadrant adds an unoccupied row', () => {
  const projects = items(4);
  const layout = matrixLayout(projects, 208);
  const position = snapSlot(layout, 99, 0, 0);
  expect(position.y).toBe(1);
  const next = matrixLayout([...projects, { id: 99, details: { matrixPosition: position } }], 208);
  expect(new Set(next.slots.values()).size).toBe(5);
});
test('dropping on another project chooses a free cell', () => {
  const layout = matrixLayout(items(3), 208);
  const position = snapSlot(layout, 99, 0, 0);
  const slot = Math.round(position.y * (layout.rows - 1)) * layout.columns + Math.round(position.x * (layout.columns - 1));
  expect([...layout.slots.values()]).not.toContain(slot);
});
