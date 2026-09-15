jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'temp' ? '/tmp' : '/tmp/userData'),
    getVersion: () => '0.1.0-test',
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
  dialog: {},
}));

import { selectSnapshotsToPrune, restoreSnapshot, __testing } from './entityDbBackup';

const { parseSnapshotKey, companionAchievementsKey, sqlStringLiteral } = __testing;

const PREFIX = 'entity-db-backups/snapshots/';
const LOGICAL_PREFIX = 'entity-db-backups/snapshots-logical/';
const keyAt = (iso: string, reason = 'timer') =>
  `${PREFIX}entities-${iso.replace(/[:-]|\.\d{3}/g, '')}-${reason}.sqlite.gz`;
const logicalKeyAt = (iso: string, reason = 'timer') =>
  `${LOGICAL_PREFIX}entities-${iso.replace(/[:-]|\.\d{3}/g, '')}-${reason}.sql.gz`;

describe('parseSnapshotKey', () => {
  it('recovers the timestamp from a well-formed key', () => {
    const parsed = parseSnapshotKey(keyAt('2026-09-01T20:30:15.000Z', 'quit'));
    expect(parsed?.date.toISOString()).toBe('2026-09-01T20:30:15.000Z');
  });

  it('rejects keys that are not snapshots', () => {
    expect(parseSnapshotKey(`${PREFIX}notes.txt`)).toBeNull();
    expect(parseSnapshotKey(`${PREFIX}entities-garbage.sqlite.gz`)).toBeNull();
  });

  it('also recovers the timestamp from a Turso logical-export key', () => {
    const parsed = parseSnapshotKey(logicalKeyAt('2026-09-01T20:30:15.000Z', 'quit'));
    expect(parsed?.date.toISOString()).toBe('2026-09-01T20:30:15.000Z');
  });
});

describe('companionAchievementsKey', () => {
  it('pairs an entity snapshot key with an achievements sidecar key', () => {
    const entityKey = keyAt('2026-09-01T20:30:15.000Z', 'manual');
    expect(companionAchievementsKey(entityKey)).toBe(
      `${PREFIX}achievements-20260901T203015Z-manual.json.gz`,
    );
  });

  it('returns null for non-entity keys', () => {
    expect(companionAchievementsKey(`${PREFIX}notes.txt`)).toBeNull();
  });

  it('also pairs a logical-export key with an achievements sidecar key', () => {
    const entityKey = logicalKeyAt('2026-09-01T20:30:15.000Z', 'manual');
    expect(companionAchievementsKey(entityKey)).toBe(
      `${LOGICAL_PREFIX}achievements-20260901T203015Z-manual.json.gz`,
    );
  });
});

describe('restoreSnapshot', () => {
  it('refuses to restore a Turso logical-export snapshot in place', async () => {
    await expect(restoreSnapshot(logicalKeyAt('2026-09-01T20:30:15.000Z'))).rejects.toThrow(
      /logical-export snapshot/,
    );
  });
});

describe('sqlStringLiteral', () => {
  it('single-quotes and doubles interior quotes', () => {
    expect(sqlStringLiteral("/tmp/a'b.sqlite")).toBe("'/tmp/a''b.sqlite'");
  });
});

describe('selectSnapshotsToPrune', () => {
  const now = new Date('2026-09-01T21:00:00.000Z');

  it('keeps everything when there are few snapshots', () => {
    const keys = [
      keyAt('2026-09-01T20:00:00Z'),
      keyAt('2026-09-01T19:00:00Z'),
      keyAt('2026-08-30T19:00:00Z'),
    ];
    expect(selectSnapshotsToPrune(keys, now)).toEqual([]);
  });

  it('keeps the newest 24 regardless of age', () => {
    const keys = Array.from({ length: 30 }, (_, i) => {
      const t = new Date(now.getTime() - i * 20 * 60 * 1000); // every 20 min going back
      return keyAt(t.toISOString());
    });
    const pruned = selectSnapshotsToPrune(keys, now);
    // 30 total, all within the same ~10h window (same 2 UTC days) → 24 recent
    // kept + one daily survivor per day already inside the recent set.
    expect(pruned).toHaveLength(6);
    // none of the 24 newest are pruned
    const newest24 = keys.slice(0, 24);
    expect(pruned.some((k) => newest24.includes(k))).toBe(false);
  });

  it('keeps one snapshot per day within the 14-day daily window, drops the rest', () => {
    const keys: string[] = [];
    // 20 days back, 3 snapshots per day
    for (let day = 0; day < 20; day += 1) {
      for (const hour of [8, 14, 20]) {
        const t = new Date(now.getTime() - day * 24 * 60 * 60 * 1000);
        t.setUTCHours(hour, 0, 0, 0);
        keys.push(keyAt(t.toISOString()));
      }
    }
    const pruned = new Set(selectSnapshotsToPrune(keys, now));
    const kept = keys.filter((k) => !pruned.has(k));

    // Group kept by day.
    const keptByDay = new Map<string, number>();
    for (const k of kept) {
      const day = parseSnapshotKey(k)!.date.toISOString().slice(0, 10);
      keptByDay.set(day, (keptByDay.get(day) ?? 0) + 1);
    }

    // Recent days (inside KEEP_RECENT=24 → 8 days at 3/day) keep all 3;
    // older days inside the 14-day window keep exactly 1; beyond 14 days keep 0.
    const dayCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const [day, count] of keptByDay) {
      expect(count).toBeGreaterThanOrEqual(1);
      expect(day >= dayCutoff).toBe(true);
    }
    // Everything older than 14 days is gone.
    const oldest = keys[keys.length - 1];
    expect(pruned.has(oldest)).toBe(true);
  });

  it('ignores unparseable keys rather than deleting them', () => {
    const keys = [`${PREFIX}README`, keyAt('2026-09-01T20:00:00Z')];
    expect(selectSnapshotsToPrune(keys, now)).toEqual([]);
  });
});
