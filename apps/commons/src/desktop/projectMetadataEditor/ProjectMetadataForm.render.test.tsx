import { render } from '@testing-library/react';
import { ProjectMetadataForm } from './ProjectMetadataForm';

/**
 * Render smoke test for the project-metadata form.
 *
 * This is the component the editor package renders through
 * `registerProjectSettingsPanel` — the seam introduced when
 * `@cwrc/leafwriter` stopped importing the app. A break here shows up as a
 * missing Settings tab rather than an error, so mounting it is worth pinning.
 */

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

jest.mock('@src/overmind', () => {
  const m = jest.requireActual('../../../test/mocks/overmind');
  const state = m.appState();
  const acts = m.actions();
  return { useAppState: () => state, useActions: () => acts };
});

const pedbIo = {
  load: jest.fn().mockResolvedValue(undefined),
  save: jest.fn().mockResolvedValue(undefined),
  hasToken: jest.fn().mockResolvedValue(false),
  setToken: jest.fn().mockResolvedValue(undefined),
  testConnection: jest.fn().mockResolvedValue({ ok: true }),
  migrateLocalData: jest.fn().mockResolvedValue({ ok: true, tables: 0, rows: 0 }),
};

const io = {
  loadState: jest.fn().mockResolvedValue(null),
  saveMetadata: jest.fn().mockResolvedValue({ ok: true }),
  nameTypePolicy: {
    load: jest.fn().mockResolvedValue(null),
    persist: jest.fn().mockResolvedValue(undefined),
  },
  thingTypePolicy: {
    load: jest.fn().mockResolvedValue(null),
    persist: jest.fn().mockResolvedValue(undefined),
  },
  pedb: pedbIo,
  onCancel: jest.fn(),
  onSaved: jest.fn(),
};

const loadedNameTypePolicy = {
  load: jest.fn().mockResolvedValue({
    buckets: {},
    customTypes: [],
    artMinCodePoints: 0,
    sourceLanguage: null,
  }),
  persist: jest.fn().mockResolvedValue(undefined),
};

const loadedThingTypePolicy = {
  load: jest.fn().mockResolvedValue({ customTypes: [] }),
  persist: jest.fn().mockResolvedValue(undefined),
};

describe('ProjectMetadataForm', () => {
  it('mounts in panel layout', () => {
    expect(() => render(<ProjectMetadataForm io={io} layout="panel" />)).not.toThrow();
  });

  it('mounts in page layout', () => {
    expect(() => render(<ProjectMetadataForm io={io} layout="page" />)).not.toThrow();
  });

  it('mounts the Turso shared-database section once real state has loaded', async () => {
    const loadedIo = {
      ...io,
      nameTypePolicy: loadedNameTypePolicy,
      thingTypePolicy: loadedThingTypePolicy,
      loadState: jest.fn().mockResolvedValue({
        mode: 'edition',
        fields: [],
        values: {},
        custom: [],
        translation: { locked: false, alignmentUnit: 'p', languages: [] },
        syncToCentral: false,
      }),
    };

    const { findByText } = render(<ProjectMetadataForm io={loadedIo} layout="panel" />);

    expect(await findByText('LWC.desktop.project.shared_database')).toBeTruthy();
    expect(pedbIo.load).toHaveBeenCalled();
  });
});
