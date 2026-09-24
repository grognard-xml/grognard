import type Writer from '../js/Writer';
import {
  addProjectGlyph,
  emptyProjectGlyphRegistry,
  type ProjectGlyph,
} from './projectGlyphRegistry';
import {
  composeAndInsertProjectGlyph,
  previewComposition,
  resolveComponentInput,
} from './projectGlyphStore';

const composedGlyph: ProjectGlyph = {
  id: 'chhiv-0001',
  ids: '⿱一二',
  kage: '99:0:0:0:0:200:100:u4e00:0:0:0$99:0:0:0:100:200:200:u4e8c:0:0:0',
  svgRelativeUrl: '_glyphs/chhiv-0001.svg',
  sourceType: 'composed',
  createdAt: '2026-09-24T00:00:00.000Z',
};

describe('resolveComponentInput', () => {
  const registry = addProjectGlyph(emptyProjectGlyphRegistry(), composedGlyph);

  it('converts a single typed/pasted Unicode character to its bundled name', () => {
    expect(resolveComponentInput('言', registry)).toEqual({ name: 'u8a00', kind: 'unicode' });
  });

  it('treats a known project glyph id as-is', () => {
    expect(resolveComponentInput('chhiv-0001', registry)).toEqual({
      name: 'chhiv-0001',
      kind: 'project-glyph',
    });
  });

  it('reports an unrecognized multi-character string as unknown', () => {
    expect(resolveComponentInput('chhiv-9999', registry)).toEqual({
      name: 'chhiv-9999',
      kind: 'unknown',
    });
  });
});

describe('previewComposition', () => {
  it('renders a live preview for two ordinary bundled characters with no unresolved components', () => {
    const preview = previewComposition('⿰', '言', '某', emptyProjectGlyphRegistry());
    expect(preview.unresolvedComponents).toEqual([]);
    expect(preview.svg).toContain('<svg');
    expect(preview.ids).toBe('⿰言某');
  });

  it('can compose using an already-composed project glyph as a component', () => {
    const registry = addProjectGlyph(emptyProjectGlyphRegistry(), composedGlyph);
    const preview = previewComposition('⿰', '言', 'chhiv-0001', registry);
    expect(preview.unresolvedComponents).toEqual([]);
    expect(preview.ids).toBe('⿰言chhiv-0001');
  });

  it('reports an unresolved component rather than silently dropping it', () => {
    const preview = previewComposition('⿰', '言', 'nope', emptyProjectGlyphRegistry());
    expect(preview.unresolvedComponents).toEqual(['nope']);
  });
});

describe('composeAndInsertProjectGlyph', () => {
  const makeFakeWriter = (): { writer: Writer; addStructureTag: jest.Mock } => {
    const addStructureTag = jest.fn(({ tagName }: { tagName: string }) => ({
      id: `${tagName}-1`,
      isConnected: true,
    }));
    const editor = {
      selection: {
        getBookmark: () => ({ id: 'bookmark' }),
        setRng: () => {},
        setContent: () => {},
      },
      dom: { createRng: () => ({ setStartAfter: () => {}, collapse: () => {} }) },
      getBody: () => ({}),
      focus: () => {},
    };
    const writer = {
      editor,
      tagger: {
        ADD: 'ADD',
        addStructureTag,
        processNewContent: () => {},
      },
      schemaManager: { getCurrentSchema: () => ({ mapping: 'teiAll' }) },
      event: () => ({ publish: jest.fn() }),
      overmindState: { document: { xml: '<TEI/>' } },
      overmindActions: { document: { updateXMLHeader: () => {}, setDocumentXml: () => {} } },
    } as unknown as Writer;
    return { writer, addStructureTag };
  };

  const installFakeProjectApi = (files: Map<string, string>) => {
    window.__leafWriterProject = {
      getProjectRootPath: () => '/project',
    } as unknown as typeof window.__leafWriterProject;
    window.electronAPI = {
      pathExists: async (path: string) => files.has(path),
      readFile: async (path: string) => files.get(path) ?? '',
      writeFile: async (path: string, content: string) => {
        files.set(path, content);
      },
      ensureDirectory: async () => {},
    } as unknown as typeof window.electronAPI;
  };

  afterEach(() => {
    window.__leafWriterProject = undefined;
    window.electronAPI = undefined;
  });

  it('composes, persists the registry and SVG, and inserts a <g ref> into the document', async () => {
    const files = new Map<string, string>();
    installFakeProjectApi(files);
    const { writer, addStructureTag } = makeFakeWriter();
    window.__desktopStoredDocumentXml = `<?xml version="1.0"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>T</title></titleStmt><publicationStmt><p>U</p></publicationStmt><sourceDesc><p>N</p></sourceDesc></fileDesc></teiHeader>
  <text><body><p>Hi</p></body></text>
</TEI>`;

    const result = await composeAndInsertProjectGlyph(writer, '⿰', '言', '某');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.glyph.id).toBe('chhiv-0001');
    expect(result.glyph.ids).toBe('⿰言某');
    expect(files.get('/project/project-glyphs.json')).toContain('chhiv-0001');
    expect(files.get('/project/_glyphs/chhiv-0001.svg')).toContain('<svg');
    expect(addStructureTag).toHaveBeenCalledWith(
      expect.objectContaining({
        tagName: 'g',
        attributes: expect.objectContaining({ ref: '#chhiv-0001' }),
      }),
    );

    window.__desktopStoredDocumentXml = undefined;
  });

  it('refuses to save when a component is unresolved, without touching disk', async () => {
    const files = new Map<string, string>();
    installFakeProjectApi(files);
    const { writer } = makeFakeWriter();

    const result = await composeAndInsertProjectGlyph(writer, '⿰', '言', 'not-a-real-thing');
    expect(result.ok).toBe(false);
    expect(files.size).toBe(0);
  });
});
