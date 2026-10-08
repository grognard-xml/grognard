import { DEFAULT_AI_API_SETTINGS, parseAppPrefs, sanitizeRecentProjectFiles } from './projectPrefs';

jest.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
  },
}));

describe('parseAppPrefs', () => {
  it('keeps entityDbFolder when lastProjectFile is null', () => {
    const prefs = parseAppPrefs({
      lastProjectFile: null,
      entityDbFolder: '/Users/me/entity-db',
    });

    expect(prefs.entityDbFolder).toBe('/Users/me/entity-db');
    expect(prefs.lastProjectFile).toBeNull();
  });

  it('keeps entityDbFolder when only entityDbFolder is stored', () => {
    const prefs = parseAppPrefs({
      entityDbFolder: '/Users/me/entity-db',
    });

    expect(prefs.entityDbFolder).toBe('/Users/me/entity-db');
    expect(prefs.lastProjectFile).toBeNull();
  });

  it('keeps entityDbFolder alongside lastProjectFile', () => {
    const prefs = parseAppPrefs({
      lastProjectFile: '/Users/me/project/jean-baptiste.project.json',
      entityDbFolder: '/Users/me/entity-db',
    });

    expect(prefs.lastProjectFile).toBe('/Users/me/project/jean-baptiste.project.json');
    expect(prefs.entityDbFolder).toBe('/Users/me/entity-db');
  });

  it('migrates lastRootPath and keeps entityDbFolder', () => {
    const prefs = parseAppPrefs({
      lastRootPath: '/Users/me/project',
      entityDbFolder: '/Users/me/entity-db',
    });

    expect(prefs.lastProjectFile).toBe('/Users/me/project/jean-baptiste.project.json');
    expect(prefs.entityDbFolder).toBe('/Users/me/entity-db');
    expect(prefs.recentProjectFiles).toEqual(['/Users/me/project/jean-baptiste.project.json']);
  });

  it('seeds recent projects from lastProjectFile when missing', () => {
    const prefs = parseAppPrefs({
      lastProjectFile: '/Users/me/tibet/jean-baptiste.project.json',
    });

    expect(prefs.recentProjectFiles).toEqual(['/Users/me/tibet/jean-baptiste.project.json']);
  });

  it('defaults aiApi.alwaysOn to false when absent', () => {
    const prefs = parseAppPrefs({
      aiApi: {
        ...DEFAULT_AI_API_SETTINGS,
        model: 'test-model',
        verifiedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(prefs.aiApi.alwaysOn).toBe(false);
  });

  it('preserves aiApi.alwaysOn when explicitly saved', () => {
    const prefs = parseAppPrefs({
      aiApi: {
        ...DEFAULT_AI_API_SETTINGS,
        model: 'test-model',
        alwaysOn: true,
        verifiedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(prefs.aiApi.alwaysOn).toBe(true);
  });

  it('defaults concurrency to automatic (0) and reasoning effort to none sent', () => {
    const { concurrency: _c, reasoningEffort: _r, ...legacy } = DEFAULT_AI_API_SETTINGS;
    // Saved before these settings existed: the fields are absent at runtime.
    const prefs = parseAppPrefs({ aiApi: legacy as typeof DEFAULT_AI_API_SETTINGS });

    expect(prefs.aiApi.concurrency).toBe(0);
    expect(prefs.aiApi.reasoningEffort).toBe('');
  });

  it('clamps concurrency to 0-16, floors it, and rejects non-numbers', () => {
    const concurrencyFor = (value: unknown) =>
      parseAppPrefs({
        aiApi: { ...DEFAULT_AI_API_SETTINGS, concurrency: value as number },
      }).aiApi.concurrency;

    expect(concurrencyFor(6)).toBe(6);
    expect(concurrencyFor(6.9)).toBe(6);
    expect(concurrencyFor(99)).toBe(16);
    expect(concurrencyFor(-3)).toBe(0);
    expect(concurrencyFor('8')).toBe(0);
    expect(concurrencyFor(Number.NaN)).toBe(0);
  });

  it('trims and lowercases reasoning effort', () => {
    const prefs = parseAppPrefs({
      aiApi: { ...DEFAULT_AI_API_SETTINGS, reasoningEffort: '  Minimal ' },
    });

    expect(prefs.aiApi.reasoningEffort).toBe('minimal');
  });
});

describe('sanitizeRecentProjectFiles', () => {
  it('deduplicates, trims, and caps the list', () => {
    const recent = sanitizeRecentProjectFiles([
      ' /a/jean-baptiste.project.json ',
      '/b/jean-baptiste.project.json',
      '/a/jean-baptiste.project.json',
      '/c/jean-baptiste.project.json',
      '/d/jean-baptiste.project.json',
      '/e/jean-baptiste.project.json',
      '/f/jean-baptiste.project.json',
      '/g/jean-baptiste.project.json',
      '/h/jean-baptiste.project.json',
      '/i/jean-baptiste.project.json',
      '/j/jean-baptiste.project.json',
      '/k/jean-baptiste.project.json',
    ]);

    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe('/a/jean-baptiste.project.json');
    expect(recent).not.toContain('/k/jean-baptiste.project.json');
  });
});
