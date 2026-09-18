import { buildSkeletonForCatalog } from './schemaTemplates';
import { cbetaFamilyBodyFragment, cbetaFamilyTitleStmt } from './cbetaFamilyMarkup';
import { teiDateLiteral } from './sourceDescription';
import type { ProjectFileConfig } from './projectTypes';

export type KanripoNormalizeMode = 'off' | 'dpm';

export interface KanripoAuthorshipMeta {
  author_index?: string;
  person_name?: string;
  person_id?: string;
  wikidata_qid?: string;
  function?: string;
  time_dynasty?: string;
  author_dates?: string;
  date_not_before?: string;
  date_not_after?: string;
}

export interface KanripoTeiMeta {
  title: string;
  kanripo_id: string;
  juan: string;
  source: string;
  dzid: string;
  normalize: KanripoNormalizeMode;
  stem: string;
  vols?: string;
  juan_count?: string;
  catalog_source?: string;
  edition_profile?: string;
  edition_label?: string;
  edition_date?: string;
  source_locator?: string;
  cbeta_id?: string;
  time_dynasty?: string;
  date_not_before?: string;
  date_not_after?: string;
  author_dates?: string;
  authorship?: KanripoAuthorshipMeta[];
  work_qid?: string;
  edition_qid?: string;
  ws_page?: string;
  ws_url?: string;
  wikidata_primary_name?: string;
  wikidata_aliases?: string[];
}

const escapeXmlText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeXmlAttr = (value: string): string => escapeXmlText(value).replace(/"/g, '&quot;');

const isoDate = (d = new Date()): string => d.toISOString().slice(0, 10);

/** Wikidata Q-id or entity URL → ``https://www.wikidata.org/entity/Q…`` for TEI ``@ref``. */
export const wikidataEntityRef = (value?: string | null): string | undefined => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  const qid = trimmed.match(
    /^(?:https?:\/\/(?:www\.)?wikidata\.org\/(?:wiki|entity)\/)?(Q\d+)$/i,
  )?.[1];
  return qid ? `https://www.wikidata.org/entity/${qid.toUpperCase()}` : undefined;
};

/** Norbert person id → ``NORBERT:person-…`` for TEI ``@ref``. */
export const norbertPersonRef = (value?: string | null): string | undefined => {
  const id = (value ?? '').trim();
  if (!id || !/^\d+$/.test(id)) return undefined;
  return `NORBERT:person-${id}`;
};

export const authorAuthorityRef = (row: {
  wikidata_qid?: string | null;
  norbert_id?: string | null;
  person_id?: string | null;
}): string | undefined =>
  wikidataEntityRef(row.wikidata_qid) ?? norbertPersonRef(row.norbert_id ?? row.person_id);

const authorBlocks = (meta: KanripoTeiMeta, indent = '      '): string => {
  const rows = meta.authorship ?? [];
  if (!rows.length) return '';
  return rows
    .map((row) => {
      const name = escapeXmlText(row.person_name ?? '');
      const authorityRef = authorAuthorityRef(row);
      const fn = (row.function ?? '').trim();
      const attrs = [
        authorityRef ? ` ref="${escapeXmlAttr(authorityRef)}"` : '',
        fn ? ` role="${escapeXmlAttr(fn)}"` : '',
      ].join('');
      return name ? `${indent}<author${attrs}>${name}</author>` : '';
    })
    .filter(Boolean)
    .join('\n');
};

const titleBlock = (title: string, workQid?: string, indent = '      '): string => {
  const authorityRef = wikidataEntityRef(workQid);
  const attrs = authorityRef ? ` ref="${escapeXmlAttr(authorityRef)}"` : '';
  return `${indent}<title${attrs}>${title}</title>`;
};

const monogrIdnoBlocks = (meta: KanripoTeiMeta): string => {
  const krId = escapeXmlText(meta.kanripo_id);
  const rows = [
    krId ? `<idno type="Kanripo">${krId}</idno>` : '',
    meta.cbeta_id ? `<idno type="CBETA">${escapeXmlText(meta.cbeta_id)}</idno>` : '',
    meta.dzid ? `<idno type="DZID">${escapeXmlText(meta.dzid)}</idno>` : '',
    meta.work_qid
      ? `<idno type="URI">https://www.wikidata.org/entity/${escapeXmlText(meta.work_qid)}</idno>`
      : '',
    meta.edition_qid && meta.edition_qid !== meta.work_qid
      ? `<idno type="URI" subtype="edition">https://www.wikidata.org/entity/${escapeXmlText(meta.edition_qid)}</idno>`
      : '',
    meta.ws_url ? `<idno type="URI" subtype="wikisource">${escapeXmlText(meta.ws_url)}</idno>` : '',
  ].filter(Boolean);
  return rows.length ? `        ${rows.join('\n        ')}\n` : '';
};

export interface ParallelProvenanceSource {
  label: string;
  url?: string;
  kind?: string;
}

/** Human-readable note for ``revisionDesc`` when parallel punctuation was applied. */
export const formatParallelProvenance = (
  sources: ParallelProvenanceSource[],
  alignMode: 'tape' | 'segmented',
): string => {
  const used = sources.filter((source) => source.label.trim());
  const sourceBits = used.map((source) => {
    if (source.url) return `${source.label} (${source.url})`;
    return source.label;
  });
  const sourceNote = sourceBits.length ? sourceBits.join('; ') : 'paste/file';
  return `parallel punctuation (${alignMode}); sources: ${sourceNote}`;
};

/** Append a ``revisionDesc/change`` entry, creating ``revisionDesc`` if needed. */
export const appendTeiRevisionChange = (xml: string, change: string, importedAt?: Date): string => {
  const when = isoDate(importedAt);
  const escaped = escapeXmlText(change);
  if (/<revisionDesc\b/.test(xml)) {
    return xml.replace(
      /<\/revisionDesc>/,
      `    <change when="${when}">${escaped}</change>\n  </revisionDesc>`,
    );
  }
  return xml.replace(
    /<\/teiHeader>/,
    `<revisionDesc>\n    <change when="${when}">${escaped}</change>\n  </revisionDesc>\n</teiHeader>`,
  );
};

/** Wrap a Kanripo body ``div`` in the project TEI skeleton with provenance. */
export const wrapKanripoTeiDocument = ({
  config,
  meta,
  bodyXml,
  metadataXml,
  githubUrl,
  importedAt,
  punctNote,
}: {
  config: ProjectFileConfig;
  meta: KanripoTeiMeta;
  bodyXml: string;
  metadataXml?: string;
  githubUrl?: string;
  importedAt?: Date;
  punctNote?: string;
}): string => {
  const catalogId = config.schema?.catalogId ?? '';
  if (catalogId === 'orlando' || catalogId === 'jTei') {
    throw new Error('Kanripo import currently supports TEI projects (not Orlando or jTEI).');
  }
  // CBETA P5 target: body divisions must be `<cb:div>` (not TEI `<div>`), carry
  // no CJK `@n`, and `<author>` takes no `@role`. TEI-ALL / TEI-Lite is unchanged.
  const isCbetaFamily = catalogId === 'cbeta';
  const authorList = (indent?: string) =>
    isCbetaFamily ? cbetaFamilyTitleStmt(authorBlocks(meta, indent)) : authorBlocks(meta, indent);

  const title = escapeXmlText(meta.title || meta.kanripo_id || meta.stem || 'Untitled');
  const krId = escapeXmlText(meta.kanripo_id);
  const juan = escapeXmlText(meta.juan);
  const when = isoDate(importedAt);
  const url = githubUrl ?? (meta.kanripo_id ? `https://github.com/kanripo/${meta.kanripo_id}` : '');
  const authors = authorList();
  const titleXml = titleBlock(title, meta.work_qid);

  let xml = buildSkeletonForCatalog(config);

  xml = xml.replace(
    /<titleStmt>\s*<title>[\s\S]*?<\/title>\s*<\/titleStmt>/,
    `<titleStmt>\n${titleXml}\n${authors}\n    </titleStmt>`,
  );

  const sourceBits = ['Kanseki Repository (Kanripo)'];
  if (krId) sourceBits.push(krId);
  if (juan) sourceBits.push(`juan ${juan}`);
  if (meta.source) sourceBits.push(`witness ${escapeXmlText(meta.source)}`);
  const locator = (meta.source_locator ?? '').trim();
  if (locator) {
    sourceBits.push(`locator ${escapeXmlText(locator)}`);
  } else if (meta.catalog_source) {
    sourceBits.push(`catalog ${escapeXmlText(meta.catalog_source)}`);
  }
  const sourceNote = escapeXmlText(sourceBits.join(', '));
  const monogrAuthors = authorList('        ');
  const editionLabel = (meta.edition_label ?? '').trim();
  const editionDate = (meta.edition_date ?? '').trim();
  const editionBlock = editionLabel
    ? `          <edition>${escapeXmlText(editionLabel)}</edition>\n`
    : '';
  const editionDateLiteral = teiDateLiteral(editionDate);
  const imprintDate = editionDate
    ? `<date${editionDateLiteral ? ` when="${escapeXmlAttr(editionDateLiteral)}"` : ''}>${escapeXmlText(editionDate)}</date>`
    : '<date/>';
  const biblNotes = [
    `<note>${sourceNote}.</note>`,
    url ? `<note type="kanripo-github">${escapeXmlText(url)}</note>` : '',
  ]
    .filter(Boolean)
    .join('\n      ');
  xml = xml.replace(
    /<sourceDesc>[\s\S]*?<\/sourceDesc>/,
    `<sourceDesc>
      <biblStruct>
        <monogr>
${monogrAuthors ? `${monogrAuthors}\n` : ''}${titleBlock(title, meta.work_qid, '          ')}
${monogrIdnoBlocks(meta)}${editionBlock}          <imprint>${imprintDate}</imprint>
        </monogr>
      ${biblNotes}
      </biblStruct>
    </sourceDesc>`,
  );

  const volLabel = meta.vols ?? meta.juan_count;
  if (volLabel) {
    xml = xml.replace(
      /<publicationStmt>/,
      `<extent>${escapeXmlText(volLabel)} 卷</extent>\n    <publicationStmt>`,
    );
  }

  const creationParts: string[] = [];
  if (meta.time_dynasty) {
    // `<date>` not `<origDate>` — CBETA P5 has no `origDate`, and TEI's `creation`
    // takes `<date>` fine.
    creationParts.push(`<date>${escapeXmlText(meta.time_dynasty)}</date>`);
  }
  const notBefore = teiDateLiteral(meta.date_not_before);
  const notAfter = teiDateLiteral(meta.date_not_after);
  if (notBefore || notAfter) {
    const dateAttrs = [
      notBefore ? ` notBefore="${escapeXmlAttr(notBefore)}"` : '',
      notAfter ? ` notAfter="${escapeXmlAttr(notAfter)}"` : '',
    ].join('');
    creationParts.push(`<date${dateAttrs}/>`);
  } else if (meta.author_dates) {
    creationParts.push(`<date>${escapeXmlText(meta.author_dates)}</date>`);
  }
  if (creationParts.length) {
    xml = xml.replace(
      /<\/fileDesc>/,
      `  </fileDesc>\n  <profileDesc>\n      <creation>\n        ${creationParts.join('\n        ')}\n      </creation>\n  </profileDesc>`,
    );
  }

  const change = `Imported from Kanripo with plugin kanripo-import; normalisation=${escapeXmlText(
    meta.normalize,
  )}${punctNote ? `; ${escapeXmlText(punctNote)}` : ''}.`;
  xml = xml.replace(
    /<\/teiHeader>/,
    `<revisionDesc>\n    <change when="${when}">${change}</change>\n  </revisionDesc>\n</teiHeader>`,
  );

  const trimmedBody = bodyXml.trim();
  if (!/<div[\s>]/.test(trimmedBody)) {
    throw new Error('Kanripo conversion did not return a TEI div.');
  }

  // DPM <metadata> fragments belong in the header, not the body (they are not valid TEI body content).
  void metadataXml;
  // CBETA target: TEI `<div>` → `<cb:div>`, drop the CJK `@n` (still in the
  // `<head>`, the filename and the document title).
  const bodyForSplice = isCbetaFamily ? cbetaFamilyBodyFragment(trimmedBody) : trimmedBody;
  xml = xml.replace(/<div type="text">[\s\S]*?<\/div>/, bodyForSplice);

  return xml;
};

const joinPath = (...parts: string[]): string =>
  parts.filter(Boolean).join('/').replace(/\/+/g, '/');

/** Unique ``imported/kanripo/<KR_ID>/<stem>.xml`` path, with ``-2`` suffixes like document import. */
export const uniqueKanripoXmlPath = (
  destinationDir: string,
  stem: string,
  used: Set<string>,
): string => {
  const safeStem = stem.replace(/[\\/]/g, '_') || 'untitled';
  let outputPath = joinPath(destinationDir, `${safeStem}.xml`);
  let suffix = 2;
  while (used.has(outputPath.replace(/\\/g, '/'))) {
    outputPath = joinPath(destinationDir, `${safeStem}-${suffix}.xml`);
    suffix += 1;
  }
  used.add(outputPath.replace(/\\/g, '/'));
  return outputPath;
};
