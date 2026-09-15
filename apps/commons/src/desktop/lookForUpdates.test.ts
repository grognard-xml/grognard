import { everythingIsUpToDate, type LookForUpdatesReport } from './lookForUpdates';

const base = (): LookForUpdatesReport => ({
  app: { status: 'current' },
  authority: null,
  authorityApplied: null,
  pluginsApplied: null,
  schema: null,
});

describe('everythingIsUpToDate', () => {
  it('is true when every channel is current or N/A', () => {
    expect(everythingIsUpToDate(base())).toBe(true);
    expect(
      everythingIsUpToDate({
        ...base(),
        app: { status: 'unsupported' },
        authority: {
          enabled: true,
          updateAvailable: false,
        } as LookForUpdatesReport['authority'],
        pluginsApplied: { updated: [], failed: [] },
        schema: { status: 'skipped', reason: 'Not a catalog-installed schema' },
      }),
    ).toBe(true);
  });

  it('is false when authority packs need a refresh', () => {
    expect(
      everythingIsUpToDate({
        ...base(),
        authority: {
          enabled: true,
          updateAvailable: true,
        } as LookForUpdatesReport['authority'],
      }),
    ).toBe(false);
  });

  it('is false when plugins updated, failed to update, or the app needs attention', () => {
    expect(
      everythingIsUpToDate({
        ...base(),
        pluginsApplied: { updated: [{ id: 'daozang-import', from: '0.1.0', to: '0.1.1' }], failed: [] },
      }),
    ).toBe(false);
    expect(
      everythingIsUpToDate({
        ...base(),
        pluginsApplied: { updated: [], failed: [{ id: 'daozang-import', error: 'boom' }] },
      }),
    ).toBe(false);
    expect(
      everythingIsUpToDate({
        ...base(),
        app: { status: 'updateAvailable', version: '1.2.3' },
      }),
    ).toBe(false);
  });
});
