export type Position = { x: number; y: number };
type Item = { id: number; details: { matrixPosition: Position | null } };
export function matrixLayout(items: Item[], width: number, height = 300) {
  const count = Math.max(1, items.length);
  let columns = 1, best = 0;
  for (let candidate = 1; candidate <= count; candidate++) {
    const rows = Math.ceil(count / candidate);
    const scale = Math.min(width / candidate / 104, height / rows / 88);
    if (scale > best) { best = scale; columns = candidate; }
  }
  const rows = Math.max(1, Math.ceil(items.length / columns));
  const occupied = new Set<number>();
  const slots = new Map<number, number>();
  for (const item of [...items].sort((a, b) => a.id - b.id)) {
    const preferred = item.details.matrixPosition;
    const available = Array.from({ length: columns * rows }, (_, i) => i).filter(i => !occupied.has(i));
    const slot = preferred ? available.sort((a, b) => distance(a, preferred, columns, rows) - distance(b, preferred, columns, rows) || a - b)[0]! : available[0]!;
    occupied.add(slot); slots.set(item.id, slot);
  }
  return { columns, rows, slots, cellHeight: height / rows };
}
function distance(slot: number, position: Position, columns: number, rows: number) {
  return (slot % columns - position.x * (columns - 1)) ** 2 + (Math.floor(slot / columns) - position.y * (rows - 1)) ** 2;
}
export function snapSlot(layout: ReturnType<typeof matrixLayout>, movingId: number, x: number, y: number) {
  const occupied = new Set([...layout.slots].filter(([id]) => id !== movingId).map(([, slot]) => slot));
  const rows = Math.max(layout.rows, Math.ceil((occupied.size + 1) / layout.columns));
  const candidates = Array.from({ length: rows * layout.columns }, (_, slot) => slot).filter(slot => !occupied.has(slot));
  const slot = candidates.sort((a, b) => ((a % layout.columns - x) ** 2 + (Math.floor(a / layout.columns) - y) ** 2) - ((b % layout.columns - x) ** 2 + (Math.floor(b / layout.columns) - y) ** 2) || a - b)[0]!;
  return { x: (slot % layout.columns) / Math.max(1, layout.columns - 1), y: Math.floor(slot / layout.columns) / Math.max(1, rows - 1) };
}
