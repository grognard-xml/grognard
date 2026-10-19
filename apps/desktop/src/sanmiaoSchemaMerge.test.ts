import {
  buildSanmiaoMergedSchemaFiles,
  extractDateAttributeRefs,
  generateSanmiaoHelperDefines,
  isCurrentSanmiaoMergeVersion,
  kanripoGOverrideHasDuplicateType,
  isFlatRelaxNgGrammar,
  isSanmiaoMergedWrapper,
  isTeiRelaxNgSchema,
  shouldMergeSanmiaoDates,
} from './sanmiaoSchemaMerge';

const SAMPLE_TEI_DATE = `
<define name="date">
  <element name="date">
    <zeroOrMore><choice><text/><ref name="model.phrase"/></choice></zeroOrMore>
    <ref name="att.global.attributes"/>
    <ref name="att.datable.attributes"/>
    <empty/>
  </element>
</define>
`;

const MINIMAL_TEI = `<?xml version="1.0"?>
<grammar xmlns="http://relaxng.org/ns/structure/1.0">
  <a:documentation xmlns:a="http://relaxng.org/ns/compatibility/annotations/1.0">TEI Edition: P5 Version 4.9.0</a:documentation>
  <define name="model.phrase"><choice><ref name="persName"/><ref name="date"/></choice></define>
  ${SAMPLE_TEI_DATE}
  <define name="att.global.attributes">
    <optional><attribute name="n"><text/></attribute></optional>
  </define>
  <define name="att.typed.attributes"><empty/></define>
  <define name="persName"><element name="persName"/></define>
  <define name="respStmt"><element name="respStmt"/></define>
  <define name="model.biblPart"><choice><ref name="persName"/></choice></define>
</grammar>`;

describe('sanmiaoSchemaMerge', () => {
  it('extracts att refs from stock TEI date', () => {
    expect(extractDateAttributeRefs(MINIMAL_TEI)).toEqual([
      'att.global.attributes',
      'att.datable.attributes',
    ]);
  });

  it('generates helper defines with sanmiao children and resolution attrs but no date define', () => {
    const helpers = generateSanmiaoHelperDefines();
    expect(helpers).toContain('grognard.sanmiao.dyn');
    expect(helpers).toContain('name="era_id"');
    expect(helpers).toContain('name="jdn"');
    expect(helpers).toContain('<element name="rel">');
    expect(helpers).toContain('<define name="grognard.sanmiao.int">');
    expect(helpers).toContain('<element name="int">');
    expect(helpers).toMatch(/<define name="grognard\.sanmiao\.int">[\s\S]*<text\/>/);
    expect(helpers).not.toContain(
      '<define name="grognard.sanmiao.int">\n    <element name="int">\n      <empty/>',
    );
    expect(helpers).toContain('<define name="grognard.kanripo.graphic">');
    expect(helpers).not.toContain('<grammar');
    expect(helpers).not.toContain('<define name="date">');
  });

  it('builds a flat merged schema with sanmiao date override and helper defines', () => {
    const merged = buildSanmiaoMergedSchemaFiles(MINIMAL_TEI, 'tei_all.rng');
    expect(merged.teiCoreFileName).toBe('tei_all.tei.rng');
    expect(merged.flatRng).toContain('ns="http://www.tei-c.org/ns/1.0"');
    expect(merged.flatRng).not.toContain('<include');
    expect(merged.flatRng).not.toContain('grognard-sanmiao-dates.rng');
    expect(merged.flatRng).not.toContain('<except>');
    expect(merged.flatRng).toContain('ref name="att.datable.attributes"');
    expect(merged.flatRng).toContain('grognard.sanmiao.date.parts');
    expect(merged.flatRng).toContain('<define name="grognard.sanmiao.date.parts">');
    expect(merged.flatRng).toContain('ref name="persName"');
    expect(merged.flatRng).toContain('ref name="grognard.nobleTitle"');
    // <bibl> may carry <respStmt> via model.biblPart (stock TEI only allows it in biblStruct).
    expect(merged.flatRng).toMatch(
      /<define name="model\.biblPart">[\s\S]*?<ref name="respStmt"\/>[\s\S]*?<\/define>/,
    );
    // <dynasty> is an Grognard element, not TEI: allowing it inside <nobleTitle>
    // means defining it here as well as referencing it.
    expect(merged.flatRng).toContain('<define name="grognard.dynasty">');
    expect(merged.flatRng).toContain('<element name="dynasty">');
    const nobleTitleDefine = merged.flatRng.match(
      /<define name="grognard\.nobleTitle">[\s\S]*?<\/define>/,
    )?.[0];
    expect(nobleTitleDefine).toContain('ref name="grognard.dynasty"');
    // nobleTitle is an Grognard element, so it has no attributes unless declared —
    // and the auto-tagger writes @dynasty, @ref, @resp, @source and @when.
    // @resp/@source come from att.global, @ref from att.personal, @when from
    // att.datable; only @dynasty has to be spelled out.
    expect(nobleTitleDefine).toContain('ref name="att.global.attributes"');
    expect(nobleTitleDefine).toContain('ref name="att.personal.attributes"');
    expect(nobleTitleDefine).toContain('ref name="att.datable.attributes"');
    expect(nobleTitleDefine).toContain('<attribute name="dynasty">');
    expect(merged.flatRng).toContain('grognard.kanripo.graphic');
    expect(merged.flatRng).toContain('type=kanripo');
    expect(merged.flatRng).not.toMatch(/<attribute name="n">[\s\S]*?<attribute name="n">/);
    const kanripoBranch = merged.flatRng.match(
      /<attribute name="type"><value>kanripo<\/value><\/attribute>([\s\S]*?)<empty\/>/,
    )?.[1];
    expect(kanripoBranch).toBeDefined();
    expect(kanripoBranch).not.toContain('att.typed.attributes');
    expect(merged.flatRng).toContain('persName');
    expect(isFlatRelaxNgGrammar(merged.flatRng)).toBe(true);
    expect(isSanmiaoMergedWrapper(merged.flatRng)).toBe(true);
    expect(isCurrentSanmiaoMergeVersion(merged.flatRng)).toBe(true);
  });

  it('flags v1 wrappers as outdated', () => {
    const v1Wrapper = `<grammar><a:documentation>Grognard: TEI + sanmiao East Asian date extension</a:documentation><include href="tei_all.tei.rng"><except><define name="date"/></except></include><include href="grognard-sanmiao-dates.rng"/></grammar>`;
    expect(isSanmiaoMergedWrapper(v1Wrapper)).toBe(true);
    expect(isCurrentSanmiaoMergeVersion(v1Wrapper)).toBe(false);
  });

  it('rejects merged schemas with duplicate @type on Kanripo g even when marker matches', () => {
    const merged = buildSanmiaoMergedSchemaFiles(MINIMAL_TEI, 'tei_all.rng');
    const broken = merged.flatRng.replace(
      '<ref name="grognard.kanripo.graphic"/>',
      '<ref name="grognard.kanripo.graphic"/><ref name="att.typed.attributes"/>',
    );
    expect(kanripoGOverrideHasDuplicateType(broken)).toBe(true);
    expect(isCurrentSanmiaoMergeVersion(broken)).toBe(false);
  });

  it('detects TEI schemas and merge need', () => {
    expect(isTeiRelaxNgSchema(MINIMAL_TEI)).toBe(true);
    expect(shouldMergeSanmiaoDates('teiAll', MINIMAL_TEI)).toBe(true);
    expect(
      shouldMergeSanmiaoDates(
        'teiAll',
        buildSanmiaoMergedSchemaFiles(MINIMAL_TEI, 'tei_all.rng').flatRng,
      ),
    ).toBe(false);
  });
});
