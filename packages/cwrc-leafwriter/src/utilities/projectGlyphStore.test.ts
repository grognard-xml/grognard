import type Writer from '../js/Writer';
import type { GlyphwikiCandidate } from './glyphwikiIndex';
import {
  addProjectGlyph,
  emptyProjectGlyphRegistry,
  type ProjectGlyph,
} from './projectGlyphRegistry';
import {
  adoptGlyphwikiCandidateAndInsert,
  composeAndInsertProjectGlyph,
  previewComposition,
  resolveComponentInput,
} from './projectGlyphStore';

jest.mock('./glyphwikiIndex', () => ({
  findGlyphwikiCandidates: jest.fn((a: string, b: string) => {
    if ([a, b].sort().join(',') === 'u67d0,u8a00') {
      return [
        {
          name: 'someuser_g001',
          kageData: '99:0:0:0:0:200:100:u8a00:0:0:0$99:0:0:0:100:200:200:u67d0:0:0:0',
          componentA: 'u8a00',
          componentB: 'u67d0',
        },
      ];
    }
    return [];
  }),
}));

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

  it('zero-pads a low-codepoint character to match GlyphWiki\'s naming (e.g. "5" -> "u0035", not "u35")', () => {
    expect(resolveComponentInput('5', registry)).toEqual({ name: 'u0035', kind: 'unicode' });
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

  it('flags an existing Unicode character for a composition with a standard decomposition on record (real bundled IDS index, not mocked)', () => {
    const preview = previewComposition('⿰', '言', '某', emptyProjectGlyphRegistry());
    expect(preview.existingUnicodeChar).toBe('謀');
  });

  it('reports no existing Unicode character for a composition with no standard decomposition on record', () => {
    const preview = previewComposition('⿰', '牙', '齒', emptyProjectGlyphRegistry());
    expect(preview.existingUnicodeChar).toBeNull();
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

  it('surfaces GlyphWiki candidates for the pair, independent of the chosen operator', () => {
    const preview = previewComposition('⿱', '言', '某', emptyProjectGlyphRegistry());
    expect(preview.glyphwikiCandidates).toHaveLength(1);
    expect(preview.glyphwikiCandidates[0].name).toBe('someuser_g001');
  });

  it('reports no candidates for a pair GlyphWiki has no compound of', () => {
    const preview = previewComposition('⿰', '一', '二', emptyProjectGlyphRegistry());
    expect(preview.glyphwikiCandidates).toEqual([]);
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

describe('adoptGlyphwikiCandidateAndInsert', () => {
  const candidate: GlyphwikiCandidate = {
    name: 'someuser_g001',
    kageData: '99:0:0:0:0:200:100:u8a00:0:0:0$99:0:0:0:100:200:200:u67d0:0:0:0',
    componentA: 'u8a00',
    componentB: 'u67d0',
  };

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
      tagger: { ADD: 'ADD', addStructureTag, processNewContent: () => {} },
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

  it('adopts a candidate as a project glyph, keeping its GlyphWiki id as provenance', async () => {
    const files = new Map<string, string>();
    installFakeProjectApi(files);
    const { writer, addStructureTag } = makeFakeWriter();
    window.__desktopStoredDocumentXml = `<?xml version="1.0"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>T</title></titleStmt><publicationStmt><p>U</p></publicationStmt><sourceDesc><p>N</p></sourceDesc></fileDesc></teiHeader>
  <text><body><p>Hi</p></body></text>
</TEI>`;

    const result = await adoptGlyphwikiCandidateAndInsert(writer, candidate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.glyph.sourceType).toBe('glyphwiki');
    expect(result.glyph.glyphwikiId).toBe('someuser_g001');
    expect(result.glyph.kage).toBe(candidate.kageData);
    expect(files.get('/project/project-glyphs.json')).toContain('someuser_g001');
    expect(addStructureTag).toHaveBeenCalledWith(
      expect.objectContaining({
        tagName: 'g',
        attributes: expect.objectContaining({ ref: '#chhiv-0001' }),
      }),
    );

    window.__desktopStoredDocumentXml = undefined;
  });

  it('refuses to adopt a candidate whose components are not actually resolvable', async () => {
    const files = new Map<string, string>();
    installFakeProjectApi(files);
    const { writer } = makeFakeWriter();

    const brokenCandidate: GlyphwikiCandidate = {
      name: 'someuser_g002',
      kageData: '99:0:0:0:0:200:100:not-a-real-component:0:0:0$99:0:0:0:100:200:200:u67d0:0:0:0',
      componentA: 'not-a-real-component',
      componentB: 'u67d0',
    };
    const result = await adoptGlyphwikiCandidateAndInsert(writer, brokenCandidate);
    expect(result.ok).toBe(false);
    expect(files.size).toBe(0);
  });
});
