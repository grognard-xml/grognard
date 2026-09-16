/**
 * Standalone copy of the order-log union primitives from
 * `packages/cwrc-leafwriter/src/autoTagging/entityOrders.ts`, kept in sync by
 * hand rather than imported: that module's `EntityFileApi` type import drags
 * in `entityStore.ts`'s whole dependency graph (including `.txt` prompt
 * templates resolved only under that package's own tsconfig), which breaks
 * `apps/desktop`'s isolated `tsc` for a couple of pure JSON-line functions.
 * See the "Fixed `cwrc-leafwriter`'s `@src/*` cross-package-alias drift" entry
 * in CHANGELOG.md for the same class of problem.
 *
 * Used only by `main.ts`'s on-launch Time Machine restore, which restores the
 * central entity database's order log directly against the filesystem
 * (`TimeMachineDialog.tsx`'s `restoreCentralPreservingOrders` does the same
 * thing through IPC, for the interactive, project-already-open case).
 */

export const ORDERS_FILE = 'entity-orders.jsonl';

interface EntityOrder {
  id: string;
  when: string;
  dbId: string;
  remap: Record<string, string | null>;
}

function parseOrders(jsonl: string): EntityOrder[] {
  const orders: EntityOrder[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as EntityOrder;
      if (parsed && parsed.id && parsed.dbId && parsed.remap) orders.push(parsed);
    } catch {
      // skip corrupt lines rather than failing the whole log
    }
  }
  return orders;
}

function formatOrder(order: EntityOrder): string {
  return JSON.stringify(order);
}

function appendOrders(existing: string, orders: EntityOrder[]): string {
  if (orders.length === 0) return existing;
  const lines = orders.map(formatOrder);
  const base = existing.trimEnd();
  return base ? `${base}\n${lines.join('\n')}\n` : `${lines.join('\n')}\n`;
}

/** Union two order-log bodies by order id, oldest first — no order is lost. */
export function unionOrderLogs(a: string, b: string): string {
  const byId = new Map<string, EntityOrder>();
  for (const order of [...parseOrders(a), ...parseOrders(b)]) {
    if (!byId.has(order.id)) byId.set(order.id, order);
  }
  const merged = [...byId.values()].sort(
    (x, y) => x.when.localeCompare(y.when) || x.id.localeCompare(y.id),
  );
  return appendOrders('', merged);
}
