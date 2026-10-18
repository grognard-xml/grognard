import { buildSkeletonForCatalog } from './schemaTemplates';
import { cbetaFamilyTitleStmt } from './cbetaFamilyMarkup';
import { norbertPersonRef, wikidataEntityRef } from './kanripoImportXml';
import { cbetaCanonEdition } from './cbetaCanons';
import { editionDateAttrs } from './sourceDescription';
import type { ProjectFileConfig } from './projectTypes';

/** DILA Buddhist Studies Authority person id (``A012345``) → TEI ``@ref`` token. */
export const dilaPersonRef = (value?: string | null): string | undefined => {
  const id = (value ?? '').trim();
  return /^[A-Z]\d{4,}$/.test(id) ? `DILA:${id}` : undefined;
};

export const cbetaAuthorAuthorityRef = (row: {
  wikidata_qid?: string | null;
  norbert_id?: string | null;
  dila_id?: string | null;
}): string | undefined =>
  wikidataEntityRef(row.wikidata_qid) ??
  norbertPersonRef(row.norbert_id) ??
  dilaPersonRef(row.dila_id);

export interface CbetaAuthorshipMeta {
  person_name?: string;
  /** CBETA ``cb:type``: Author | Translator | Editor | Collector … */
  role?: string;
  dila_id?: string;
  norbert_id?: string;
  wikidata_qid?: string;
  dates?: string;
}

export interface CbetaTeiMeta {
  title: string;
  /** CBETA work id, e.g. ``T01n0001`` (also ``T0001``). */
  work_id: string;
  canon: string;
  taisho_vol?: string;
  taisho_no?: string;
  dynasty?: string;
  /** 部類 classification. */
  category?: string;
  /** Set when this file is one juan of a multi-juan work. */
  juan_n?: string;
  juan_title?: string;
  /** Sequential section number when ``split_unit`` is ``mulu``. */
  section_n?: string;
  section_title?: string;
  /** ``juan`` (default for CBETA-schema) or ``mulu`` (section headings). */
  split_unit?: 'juan' | 'mulu';
  stem: string;
  source: string;
  /** Pinned CBETA data-version tag (provenance). */
  data_version?: string;
  git_commit?: string;
  authorship?: CbetaAuthorshipMeta[];
  work_qid?: string;
  /** Extra provenance appended to ``<revisionDesc><change>``. */
  importNotes?: string;
}

const escapeXmlText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeXmlAttr = (value: string): string => escapeXmlText(value).replace(/"/g, '&quot;');
const isoDate = (d = new Date()): string => d.toISOString().slice(0, 10);

const authorBlocks = (meta: CbetaTeiMeta, indent = '      '): string =>
  (meta.authorship ?? [])
    .map((row) => {
      const name = escapeXmlText(row.person_name ?? '');
      if (!name) return '';
      const ref = cbetaAuthorAuthorityRef(row);
      const attrs = [
        ref ? ` ref="${escapeXmlAttr(ref)}"` : '',
        row.role ? ` role="${escapeXmlAttr(row.role.trim())}"` : '',
      ].join('');
      return `${indent}<author${attrs}>${name}</author>`;
    })
    .filter(Boolean)
    .join('\n');

const titleBlock = (title: string, workQid?: string, indent = '      '): string => {
  const ref = wikidataEntityRef(workQid);
  return `${indent}<title${ref ? ` ref="${escapeXmlAttr(ref)}"` : ''}>${title}</title>`;
};

const idnoBlocks = (meta: CbetaTeiMeta): string => {
  const rows = [
    meta.work_id ? `<idno type="CBETA">${escapeXmlText(meta.work_id)}</idno>` : '',
    meta.taisho_vol && meta.taisho_no
      ? `<idno type="Taisho">${escapeXmlText(`${meta.taisho_vol}.${meta.taisho_no}`)}</idno>`
      : '',
    meta.work_qid
      ? `<idno type="URI">https://www.wikidata.org/entity/${escapeXmlText(meta.work_qid)}</idno>`
      : '',
  ].filter(Boolean);
  return rows.length ? `        ${rows.join('\n        ')}\n` : '';
};

/**
 * `<edition>` + `<imprint><date>` derived from the CBETA canon code (`meta.canon`
 * — the `T` in `T01n0001`). The `<date>` carries `@when` for a single-year canon
 * or `@from`/`@to` for one printed over a span, matching the metadata panel's
 * own output. Canons with no table entry keep the skeleton's empty `<date/>`.
 */
const editionImprintBlocks = (meta: CbetaTeiMeta, indent = '          '): string => {
  const canonEd = cbetaCanonEdition(meta.canon);
  if (!canonEd) return `${indent}<imprint><date/></imprint>`;
  const attrs = editionDateAttrs(canonEd.editionDate);
  const dateAttr = attrs.when
    ? ` when="${escapeXmlAttr(attrs.when)}"`
    : `${attrs.from ? ` from="${escapeXmlAttr(attrs.from)}"` : ''}${
        attrs.to ? ` to="${escapeXmlAttr(attrs.to)}"` : ''
      }`;
  return (
    `${indent}<edition>${escapeXmlText(canonEd.edition)}</edition>\n` +
    `${indent}<imprint><date${dateAttr}>${escapeXmlText(canonEd.editionDate)}</date></imprint>`
  );
};

/**
 * Wrap one juan of CBETA-converted TEI in the project skeleton with provenance.
 *
 * ``bodyXml`` is the ``<text><body>…</body></text>`` fragment from the Python
 * ``convert`` op (juan_split.serialize_juan_body). Its ``<body>`` children are
 * spliced into the skeleton wrapped in ``<div type="juan" n="…">``.
 *
 * TODO(cbeta-import-planning §4, §5.8): most of the header fill still comes from
 * the (stubbed) Python ``metadata_xml`` — this only handles what ``meta`` carries.
 */
export const wrapCbetaTeiDocument = ({
  config,
  meta,
  bodyXml,
  importedAt,
}: {
  config: ProjectFileConfig;
  meta: CbetaTeiMeta;
  bodyXml: string;
  importedAt?: Date;
}): string => {
  const catalogId = config.schema?.catalogId ?? '';
  if (catalogId === 'orlando' || catalogId === 'jTei') {
    throw new Error('CBETA import currently supports TEI projects (not Orlando or jTEI).');
  }
  // A CBETA-family project keeps `<cb:div>` / `<cb:tt>` / juan milestones verbatim
  // (Python `cross_family: false`); a TEI catalog gets the downgraded `<div>` tree.
  const isCbetaFamily = catalogId === 'cbeta';

  // The `<titleStmt>` / `<monogr>` title is the *work* title. A juan or section
  // heading (`section_title` / `juan_title`) is a sub-unit label, not the work —
  // it belongs in the body `<head>` (added below), never here. Mixing them up is
  // how "1 譯經" ended up in the metadata panel's "work title" field.
  const title = escapeXmlText(meta.title || meta.stem || 'Untitled');
  const when = isoDate(importedAt);
  // CBETA P5 `<author>` takes no `@role` (and `<title>` no `@type`).
  const authorList = (indent?: string) => {
    const block = authorBlocks(meta, indent);
    return isCbetaFamily ? cbetaFamilyTitleStmt(block) : block;
  };

  let xml = buildSkeletonForCatalog(config);

  xml = xml.replace(
    /<titleStmt>\s*<title>[\s\S]*?<\/title>\s*<\/titleStmt>/,
    `<titleStmt>\n${titleBlock(title, meta.work_qid)}\n${authorList()}\n    </titleStmt>`,
  );

  const sourcePara = `${escapeXmlText(meta.source)}; CBETA work ${escapeXmlText(meta.work_id)}${
    meta.split_unit === 'mulu' && meta.section_n
      ? ` section ${escapeXmlText(meta.section_n)}`
      : meta.juan_n
        ? ` 卷${escapeXmlText(meta.juan_n)}`
        : ''
  }${meta.data_version ? `; data ${escapeXmlText(meta.data_version)}` : ''}${
    meta.git_commit ? ` (${escapeXmlText(meta.git_commit.slice(0, 12))})` : ''
  }`;
  xml = xml.replace(
    /<sourceDesc>[\s\S]*?<\/sourceDesc>/,
    `<sourceDesc>
      <biblStruct>
        <monogr>
${authorList('          ')}
${titleBlock(title, meta.work_qid, '          ')}
${idnoBlocks(meta)}${editionImprintBlocks(meta)}
        </monogr>
      <note>${sourcePara}.</note>
      </biblStruct>
    </sourceDesc>`,
  );

  // CBETA's schema forbids `<origDate>` in `<creation>` (its `creation` model is
  // `macro.phraseSeq.limited`) and requires `<keywords>` to carry `@scheme`;
  // CBETA files themselves use neither block. Keep the structured `<profileDesc>`
  // only for the TEI-catalog (cross-family) path.
  if (!isCbetaFamily) {
    const creation: string[] = [];
    if (meta.dynasty) creation.push(`<origDate>${escapeXmlText(meta.dynasty)}</origDate>`);
    if (creation.length) {
      xml = xml.replace(
        /<\/fileDesc>/,
        `  </fileDesc>\n  <profileDesc>\n      <creation>\n        ${creation.join(
          '\n        ',
        )}\n      </creation>${
          meta.category
            ? `\n      <textClass>\n        <keywords>\n          <term>${escapeXmlText(meta.category)}</term>\n        </keywords>\n      </textClass>`
            : ''
        }\n  </profileDesc>`,
      );
    } else if (meta.category) {
      xml = xml.replace(
        /<\/fileDesc>/,
        `  </fileDesc>\n  <profileDesc>\n      <textClass>\n        <keywords>\n          <term>${escapeXmlText(meta.category)}</term>\n        </keywords>\n      </textClass>\n  </profileDesc>`,
      );
    }
  }

  const provenanceExtras = isCbetaFamily
    ? [
        meta.dynasty ? `Dynasty: ${meta.dynasty}.` : '',
        meta.category ? `Classification: ${meta.category}.` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : '';
  const change = `Imported from CBETA (${escapeXmlText(meta.work_id)}) with plugin cbeta-import.${
    provenanceExtras ? ` ${escapeXmlText(provenanceExtras)}` : ''
  }${meta.importNotes ? ` ${escapeXmlText(meta.importNotes)}` : ''}`;
  xml = xml.replace(
    /<\/teiHeader>/,
    `<revisionDesc>\n    <change when="${when}">${change}</change>\n  </revisionDesc>\n</teiHeader>`,
  );

  const doc = new (domImpl().DOMParser)().parseFromString(bodyXml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('CBETA conversion returned malformed juan XML.');
  }
  const body = doc.getElementsByTagName('body')[0];
  const inner = body ? Array.from(body.childNodes).map(nodeToString).join('') : '';
  if (!inner.trim()) throw new Error('CBETA conversion returned an empty juan body.');
  const isSection = meta.split_unit === 'mulu';

  if (isCbetaFamily && !isSection) {
    // Juan split: the CBETA source's own body markup (`<milestone unit="juan"/>`,
    // `<cb:div>`, `<cb:juan fun="open">`, …) already carries a valid division
    // structure — splice it straight into `<body>`.
    xml = xml.replace(/<div type="text">[\s\S]*?<\/div>/, inner);
  } else if (isCbetaFamily) {
    // Mulu split: `split_body_into_mulu` cut the source *inside* its division
    // structure, so `inner` is a loose run of `<head>`/`<p>`/`<lb>`/`<pb>`/… that
    // `<body>` will not take directly. Wrap the whole slice in one `<cb:div>`
    // (every one of those elements is allowed inside `<cb:div>`), and re-add the
    // section title — which lived in the split-point `<cb:mulu>` and survives
    // only in `meta.section_title` — as its leading `<head>` unless `inner`
    // already opens with one.
    const sectionHead =
      meta.section_title && !/^\s*<head[\s/>]/.test(inner)
        ? `<head>${escapeXmlText(meta.section_title)}</head>`
        : '';
    xml = xml.replace(
      /<div type="text">[\s\S]*?<\/div>/,
      `<cb:div type="其他">${sectionHead}${inner}</cb:div>`,
    );
  } else {
    const divType = isSection ? 'section' : 'juan';
    const divN = isSection ? meta.section_n : meta.juan_n;
    const divAttrs = divN ? ` n="${escapeXmlAttr(divN)}"` : '';
    const headTitle = isSection ? meta.section_title : meta.juan_title;
    const bodyDiv = `<div type="${divType}"${divAttrs}>${
      headTitle ? `<head>${escapeXmlText(headTitle)}</head>` : ''
    }${inner}</div>`;

    // Skeleton body division: `<div type="text">…` for TEI catalogs.
    xml = xml.replace(/<div(?:\s+type="(?:text|juan|section)")?\s*>[\s\S]*?<\/div>/, bodyDiv);
  }

  // Carry the per-juan apparatus (planning §5.5) into <text><back>.
  const back = doc.getElementsByTagName('back')[0];
  const backXml = back ? nodeToString(back) : '';
  if (backXml.trim()) {
    xml = xml.replace(/([ \t]*)<\/body>\s*<\/text>/, `$1</body>\n$1${backXml}\n</text>`);
  }
  return xml;
};

/**
 * The browser's DOM in the renderer; `@xmldom/xmldom` where there is none (the background import
 * job runs in Electron's main process, which has no `DOMParser`). The main process registers it
 * with `setCbetaDomImpl`.
 */
interface DomImpl {
  DOMParser: new () => { parseFromString: (xml: string, type: string) => Document };
  XMLSerializer: new () => { serializeToString: (node: Node) => string };
}
let injectedDom: DomImpl | null = null;
export const setCbetaDomImpl = (impl: DomImpl): void => {
  injectedDom = impl;
};
const domImpl = (): DomImpl =>
  injectedDom ??
  (typeof DOMParser !== 'undefined'
    ? { DOMParser: DOMParser as DomImpl['DOMParser'], XMLSerializer }
    : (() => {
        throw new Error('No XML parser is available for the CBETA import.');
      })());

const nodeToString = (node: Node): string =>
  new (domImpl().XMLSerializer)().serializeToString(node);

const joinPath = (...parts: string[]): string =>
  parts.filter(Boolean).join('/').replace(/\/+/g, '/');

/** Unique ``imported/cbeta/<canon>/<vol>/<stem>_<juan>.xml`` path. */
export const uniqueCbetaXmlPath = (
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
