import $ from 'jquery';
import type { AnnotationHasBody } from '../../entities/types';
import { getAttributeString, getTagAndDefaultAttributes } from '../mapper';
import type { EntityMappingProps, SchemaMappingProps } from '../types';
import { handleGraphics, refreshGraphicsInBody } from './utitlities';

const person: EntityMappingProps = {
  label: 'Person',
  mapping: {
    certainty: '@cert',
    lemma: '@key',
    uri: '@ref',
  },
  parentTag: 'persName',
  types: ['cwrc:NaturalPerson', 'schema:Person', 'cwrc:FictionalPerson'],
  annotation: (annotationsManager, entity) => {
    let types: string | string[];
    const type = entity.getAttribute('type');

    switch (type) {
      case 'real':
        types = 'cwrc:NaturalPerson';
        break;
      case 'fictional':
        types = ['schema:Person', 'cwrc:FictionalPerson'];
        break;
      case 'identifiable':
        types = [
          'cwrc:NaturalPerson',
          'schema:Person',
          'http://id.lincsproject.ca/edit/modeIdentifiable',
        ];
        break;
      default:
        types = 'cwrc:NaturalPerson';
        break;
    }
    return annotationsManager.commonAnnotation(entity, types);
  },
};

const place: EntityMappingProps = {
  label: 'Place',
  mapping: {
    certainty: '@cert',
    customValues: {
      precision: 'precision/@precision',
    },
    lemma: '@key',
    uri: '@ref',
  },
  parentTag: 'placeName',
  types: ['cwrc:RealPlace'],
  mappingFunction: (entity) => {
    const startTag = getTagAndDefaultAttributes(entity);

    let endTag = '';
    const precision = entity.getCustomValue('precision');
    if (precision) {
      endTag += `<precision match="@ref" precision="${precision}" />`;
    }
    const tag = entity.getTag();
    endTag += `</${tag}>`;

    return [startTag, endTag];
  },
  annotation: (annotationsManager, entity) => {
    const anno = annotationsManager.commonAnnotation(entity, 'cwrc:RealPlace');
    const precision = entity.getCustomValue('precision');
    if (precision) {
      anno['cwrc:hasPrecision'] = `cwrc:${precision}Certainty`;
    }
    return anno;
  },
};

const organization: EntityMappingProps = {
  label: 'Organization',
  mapping: {
    certainty: '@cert',
    lemma: '@key',
    uri: '@ref',
  },
  parentTag: 'orgName',
  types: ['org:Organization'],
  annotation: (annotationsManager, entity) => {
    return annotationsManager.commonAnnotation(entity, 'org:Organization');
  },
};

const work: EntityMappingProps = {
  label: 'Work',
  mapping: {
    certainty: '@cert',
    lemma: '@key',
    uri: '@ref',
  },
  parentTag: 'title',
  types: ['bf:Title'],
  annotation: (annotationsManager, entity) => {
    return annotationsManager.commonAnnotation(entity, 'bf:Title');
  },
};

const thing: EntityMappingProps = {
  label: 'Thing',
  mapping: {
    certainty: '@cert',
    lemma: '@key',
    uri: '@ref',
  },
  parentTag: 'rs',
  types: ['owl:Thing'],
  annotation: (annotationsManager, entity) => {
    let type = entity.getAttribute('type');
    if (!type || type === '') type = 'owl:Thing';
    type = type.replace('http://sparql.cwrc.ca/ontology/cwrc#', 'cwrc:');
    return annotationsManager.commonAnnotation(entity, type);
  },
};

const citation: EntityMappingProps = {
  isNote: true,
  label: 'Citation',
  mapping: {
    certainty: '@cert',
    noteContent: 'bibl/text()',
    uri: 'bibl/ref/@target',
  },
  parentTag: 'note',
  requiresSelection: false,
  textTag: 'bibl',
  types: ['cito:Citation'],
  xpathSelector: 'self::note[@type="citation"]/bibl',
  mappingFunction: (entity) => {
    let startTag = `${getTagAndDefaultAttributes(entity)}<bibl>`;
    const lookupId = entity.getURI();
    if (lookupId) startTag += `<ref target="${lookupId}"/>`;
    const endTag = '</bibl></note>';
    return [startTag, endTag];
  },
  annotation: (annotationsManager, entity) => {
    const anno = annotationsManager.commonAnnotation(entity, 'cito:Citation', 'cwrc:citing');
    if (entity.getURI()) {
      //add citation body
      const hasBodyCitation: AnnotationHasBody = {
        '@id': `${anno.id}#Cites`,
        '@type': 'cito:Citation',
        'cito:hasCitingEntity': anno.id,
        'cito:hasCitedEntity': entity.getURI(),
        'cito:hasCitationEvent': 'cito:cites',
      };

      anno['oa:hasBody'] = Array.isArray(anno['oa:hasBody'])
        ? [...anno['oa:hasBody'], hasBodyCitation]
        : [anno['oa:hasBody'], hasBodyCitation];

      anno['@context'].cito = 'http://purl.org/spar/cito/';
    }
    return anno;
  },
};

// TODO add resp for note type entities

const note: EntityMappingProps = {
  isNote: true,
  label: 'Note',
  mapping: {
    noteContent: '.',
  },
  parentTag: 'note',
  requiresSelection: false,
  types: ['cwrc:NoteInternal', 'cwrc:NoteScholarly', 'oa:TextualBody', 'cwrc:Note'],
  xpathSelector: 'self::note[not(@type="citation")]',
  annotation: (annotationsManager, entity) => {
    let types: string;
    const type = entity.getAttribute('type');

    switch (type) {
      case 'researchNote':
        types = 'cwrc:NoteInternal';
        break;
      case 'scholarNote':
        types = 'cwrc:NoteScholarly';
        break;
      case 'annotation':
        types = 'oa:TextualBody';
        break;
      default:
        types = 'cwrc:Note';
        break;
    }
    return annotationsManager.commonAnnotation(entity, types, 'oa:describing');
  },
};

const date: EntityMappingProps = {
  label: 'Date',
  parentTag: 'date',
  types: ['xsd:date'],
  annotation: (annotationsManager, entity) => {
    const anno = annotationsManager.commonAnnotation(entity, 'xsd:date');
    const when = entity.getAttribute('when');
    const date = when ? when : `${entity.getAttribute('from')}/${entity.getAttribute('to')}`;

    //! Assumption: rdf:value was been added to hasBody.
    // Now that it hasBody is defined to be either a single instance or multiple instances of hasBody
    // we can't just add 'value' if has body has multiple instances.
    // Option 1: only add it when has body is a single instance
    // Option 2: If multiple instances, add it to the first instance
    // Option 3: If multiple instances, added to all of them
    // Option 4: If multiple instances, create new instance to add value.
    //? We are using option 1 for now and all places this happens
    if (!Array.isArray(anno['oa:hasBody'])) anno['oa:hasBody']['rdf:value'] = date;
    return anno;
  },
};

const correction: EntityMappingProps = {
  label: 'Correction',
  mapping: {
    customValues: {
      sicText: 'sic/text()',
      corrText: 'corr/text()',
    },
  },
  parentTag: ['choice', 'corr', 'supplied', 'surplus'],
  requiresSelection: false,
  textTag: 'sic',
  types: ['fabio:Correction'],
  xpathSelector: 'self::choice|self::corr|self::supplied|self::surplus',
  mappingFunction: (entity) => {
    const tag = entity.getTag();
    if (tag === 'supplied' || tag === 'surplus') {
      return [`<${tag}${getAttributeString(entity.getAttributes())}>`, `</${tag}>`];
    }

    const corrText = entity.getCustomValue('corrText');
    const sicText = entity.getCustomValue('sicText');

    const choiceTag = sicText ? 'choice' : 'corr';

    let startTag = `<${choiceTag}${getAttributeString(entity.getAttributes())}>`;
    let endTag: string;

    if (sicText) {
      startTag += '<sic>';
      endTag = `</sic><corr>${corrText}</corr></choice>`;
    } else {
      endTag = `</${choiceTag}>`;
    }

    return [startTag, endTag];
  },
  annotation: (annotationsManager, entity) => {
    const anno = annotationsManager.commonAnnotation(entity, 'fabio:Correction', 'oa:editing');
    anno['oa:hasBody'] = {
      '@type': 'fabio:Correction',
      'dc:format': 'text/xml',
      'rdf:value': entity.getCustomValue('corrText'),
    };
    return anno;
  },
};

const keyword: EntityMappingProps = {
  isNote: true,
  label: 'Keyword',
  mapping: {
    noteContent: 'term/text()',
  },
  parentTag: 'seg',
  requiresSelection: false,
  textTag: 'term',
  types: ['fabio:ControlledVocabulary', 'fabio:UncontrolledVocabulary'],
  xpathSelector: 'self::seg/term',
  mappingFunction: (entity) => {
    const startTag = `${getTagAndDefaultAttributes(entity)}<term>`;
    const endTag = '</term></seg>';
    return [startTag, endTag];
  },
  annotation: (annotationsManager, entity) => {
    let types: string;
    let motivations: string;
    const ana = entity.getAttribute('ana');
    const hasAna = !!ana;
    const hasRef = hasAna && ana.indexOf('http') === 0;

    if (hasRef) {
      types = 'fabio:ControlledVocabulary';
      motivations = 'oa:classifying';
    } else {
      types = 'fabio:UncontrolledVocabulary';
      motivations = 'oa:tagging';
    }

    const anno = annotationsManager.commonAnnotation(entity, types, motivations);

    if (hasRef) {
      anno['oa:hasBody'] = [
        {
          '@type': 'fabio:ControlledVocabulary',
          'rdf:value': ana,
        },
        {
          'dc:format': 'text/xml',
          'skos:altLabel': entity.getContent(),
        },
      ];
      anno['@context'].skos = 'http://www.w3.org/2004/02/skos/';
    } else if (hasAna) {
      anno['oa:hasBody'] = [
        {
          '@type': 'fabio:UncontrolledVocabulary',
          'rdf:value': ana,
        },
        {
          'dc:format': 'text/xml',
          'skos:altLabel': entity.getContent(),
        },
      ];
      anno['@context'].skos = 'http://www.w3.org/2004/02/skos/';
    } else {
      anno['oa:hasBody'] = {
        '@type': 'fabio:UncontrolledVocabulary',
        'dc:format': 'text/xml',
        'rdf:value': entity.getContent(),
      };
    }

    return anno;
  },
};

const link: EntityMappingProps = {
  label: 'Link',
  parentTag: 'ref',
  types: ['cnt:ContentAsText'],
  annotation: (annotationsManager, entity) => {
    const anno = annotationsManager.commonAnnotation(entity, 'cnt:ContentAsText', 'oa:linking');
    anno['oa:hasBody'] = {
      '@id': entity.getAttribute('target'),
      '@type': 'cnt:ContentAsText',
    };
    return anno;
  },
};

export const tei: SchemaMappingProps = {
  blockElements: [
    'argument',
    'back',
    'bibl',
    'biblFull',
    'biblScope',
    'body',
    'byline',
    'category',
    'change',
    'cit',
    'classCode',
    'elementSpec',
    'macroSpec',
    'classSpec',
    'closer',
    'creation',
    'date',
    'distributor',
    'div',
    'div1',
    'div2',
    'div3',
    'div4',
    'div5',
    'div6',
    'div7',
    'docAuthor',
    'edition',
    'editionStmt',
    'editor',
    'eg',
    'epigraph',
    'extent',
    'figure',
    'front',
    'funder',
    'group',
    'head',
    'dateline',
    'idno',
    'item',
    'keywords',
    'l',
    'label',
    'langUsage',
    'lb',
    'lg',
    'list',
    'listBibl',
    'note',
    'noteStmt',
    'opener',
    'p',
    'principal',
    'publicationStmt',
    'publisher',
    'pubPlace',
    'q',
    'rendition',
    'resp',
    'respStmt',
    'salute',
    'samplingDecl',
    'seriesStmt',
    'signed',
    'sp',
    'sponsor',
    'tagUsage',
    'taxonomy',
    'textClass',
    'titlePage',
    'titlePart',
    'trailer',
    'TEI',
    'teiHeader',
    'text',
    'authority',
    'availability',
    'fileDesc',
    'sourceDesc',
    'revisionDesc',
    'catDesc',
    'encodingDesc',
    'profileDesc',
    'projectDesc',
    'docDate',
    'docEdition',
    'docImprint',
    'docTitle',
  ],
  header: 'teiHeader',
  headings: ['head'],
  id: 'xml:id',
  namespace: 'http://www.tei-c.org/ns/1.0',
  responsibility: 'resp',
  rdfParentSelector: '/TEI/teiHeader/fileDesc/following-sibling::xenoData',
  root: ['TEI', 'teiCorpus'],
  urlAttributes: ['ref', 'target'],
  entities: new Map([
    ['person', person],
    ['place', place],
    ['organization', organization],
    ['work', work],
    ['thing', thing],
    ['citation', citation],
    ['note', note],
    ['date', date],
    ['correction', correction],
    ['keyword', keyword],
    ['link', link],
  ]),
  listeners: {
    tagAdded: (tag) => {
      const $tag = $(tag);
      if ($tag.attr('_tag') === 'graphic') handleGraphics($tag);
    },
    tagEdited: (tag) => {
      const $tag = $(tag);
      if ($tag.attr('_tag') === 'graphic') handleGraphics($tag);
    },
    documentLoaded: (_success, body) => {
      refreshGraphicsInBody(body, {
        documentFilePath: window.__leafWriterProject?.getActiveFilePath?.() ?? null,
      });
    },
  },
};

export default tei;
