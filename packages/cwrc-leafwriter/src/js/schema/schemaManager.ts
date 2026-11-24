import CSS from 'css';
import $ from 'jquery';
import { nanoid } from 'nanoid';
import type { Schema, SchemaMappingType } from '../../types';
import { fetchResourceText, filterResourceUrls, fromLocalFileUrl, log } from '../../utilities';
import Writer from '../Writer';
import Mapper from './mapper';
import * as schemaNavigator from './schemaNavigator';

/**
 * @class SchemaManager
 * @param {Writer} writer
 * @param {Object} config
 * @param {Array} config.schemas
 */
class SchemaManager {
  readonly writer: Writer;

  private readonly BLOCK_TAG = 'div';
  private readonly INLINE_TAG = 'span';

  readonly mapper: Mapper;

  readonly getChildrenForTag: (tag: string) => any[];
  // readonly getChildrenForPath: (path: string) => any[];
  readonly getAttributesForTag: (tag: string) => any[];
  readonly getAttributesForPath: (path: string) => any[];
  readonly getParentsForTag: (tag: string) => { name: string; level: number }[];
  // readonly getParentsForPath: (path: string) => any[];

  readonly proxyXmlEndpoint: string | null = null;
  readonly proxyCssEndpoint: string | null = null;

  schemas: Schema[] = [];

  /**
   * The ID of the current validation schema, according to config.schemas
   */
  schemaId: string | null = null;

  /**
   * A cached copy of the loaded schema
   * @member {Document}
   */
  schemaXML: XMLDocument | null = null;
  rng: string | null = null;

  /**
   * A JSON version of the schema
   * @member {Object}
   */
  schemaJSON: any | null = null;

  /** Content fingerprint of the loaded RNG (merge version marker or hash prefix). */
  private schemaRevision: string | null = null;

  /**
   * Stores a list of all the elements of the current schema
   * @member {Object}
   * @property {Array} elements The list of elements
   */
  schema: { elements: string[] } = { elements: [] };

  private root: string | null = null;
  private header = '';
  private idName: string | null = null;
  private css: string | null = null;
  private documentSchemaUrl: string | null = null;
  private documentCssUrl: string | null = null;

  constructor(writer: Writer, schemas: Schema[]) {
    this.writer = writer;

    this.mapper = new Mapper(writer);
    // this.navigator = new SchemaNavigator();

    this.getChildrenForTag = (tag) => schemaNavigator.getChildrenForTag(tag);
    // this.getChildrenForPath = (tag) => this.navigator.getChildrenForPath(tag);
    this.getAttributesForTag = (tag) => schemaNavigator.getAttributesForTag(tag);
    this.getAttributesForPath = (tag) => schemaNavigator.getAttributesForPath(tag);
    this.getParentsForTag = (tag) => schemaNavigator.getParentsForTag(tag);
    // this.getParentsForPath = (tag) => this.navigator.getParentsForPath(tag);

    /**
     * An array of schema objects. Each object should have the following properties:
     * @member {Array} of {Objects}
     * @property {String} id A id for the schema
     * @property {String} name A name/label for the schema
     * @property {Array} rng Collection of URLs where the schema is located
     * @property {string} css Collection of URLs where the schema's CSS is located
     *
     */
    this.schemas = schemas ?? [];

    this.writer.event('schemaChanged').subscribe(async (schemaId: string) => {
      // this event is only fired by the settings dialog (by the user), so update the current document urls
      const schemaLoaded = await this.loadSchema(schemaId);
      if (schemaLoaded) {
        const rng = this.getRng();
        const css = this.getCss();
        if (rng) this.setDocumentSchemaUrl(rng);
        if (css) this.setDocumentCssUrl(css);
      }
    });
  }

  getBlockTag() {
    return this.BLOCK_TAG;
  }

  getInlineTag() {
    return this.INLINE_TAG;
  }

  /**
   * Get the URL for the XML for the current schema.
   * @returns {String}
   */
  getRng() {
    return this.rng;
  }

  getSchemaRevision() {
    return this.schemaRevision;
  }

  clearSchemaRevision() {
    this.schemaRevision = null;
  }

  /** Fingerprint used to detect on-disk schema changes without a schema id change. */
  static revisionFromRngContent(rngContent: string): string {
    const mergeVersion = rngContent.match(/grognard-sanmiao-merge v\d+/i)?.[0];
    if (mergeVersion) return mergeVersion.toLowerCase();

    // Use a whole-file fingerprint so changes later in large TEI RNG files
    // still invalidate the validator worker cache.
    let hash = 2166136261;
    for (let i = 0; i < rngContent.length; i++) {
      hash ^= rngContent.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return `rng-${rngContent.length.toString(16)}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  async revisionForRngUrl(rngUrl: string): Promise<string | null> {
    const data = await fetchResourceText(rngUrl);
    if (!data) return null;
    return SchemaManager.revisionFromRngContent(data);
  }

  sameLocalRngUrl(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    if (a === b) return true;
    const localA = fromLocalFileUrl(a);
    const localB = fromLocalFileUrl(b);
    return Boolean(localA && localB && localA === localB);
  }

  /**
   * Gets the schema object for the current schema.
   * @returns {Object}
   */
  getCurrentSchema() {
    return this.schemas.find((schema) => schema.id === this.schemaId);
  }

  /**
   * It takes a root and returns the schemaId that is associated with a specific root
   * @param {string} root - The root of the schema you want to get the ID of.
   * @returns The schemaId
   */
  isRootSupported(root: string) {
    const schemaMapping = Array.from(this.mapper.mappings.entries()).some(([, mapping]) =>
      mapping.root.includes(root),
    );

    return schemaMapping;
  }

  /**
   * It takes a root and returns the schemaId that is associated with a specific root
   * @param {string} root - The root of the schema you want to get the ID of.
   * @returns The schemaId
   */
  getSchemaIdFromRoot(root: string) {
    const schemaMapping = Array.from(this.mapper.mappings.entries()).find(([, mapping]) =>
      mapping.root.includes(root),
    );

    if (!schemaMapping) return null;

    const schemaId = schemaMapping[0];
    return schemaId;
  }

  /**
   * It takes a root and returns the schemaId that is associated with a specific root
   * @param {string} root - The root of the schema you want to get the ID of.
   * @returns The schemaId
   */
  getMappingIdsFromRoot(root: string) {
    const schemaMappings = Array.from(this.mapper.mappings.entries()).filter(([, mapping]) =>
      mapping.root.includes(root),
    );

    const mappingIds: SchemaMappingType[] = schemaMappings.map(([key]) => key as SchemaMappingType);
    return mappingIds;
  }

  /**
   * Returns the schemaId associated with the specified schema url.
   * @param {String} url The schema url
   * @returns {String|undefined} The schemaId
   */
  getSchemaIdFromUrl(url: string) {
    const exact = this.schemas.find((schema) => schema.rng.some((rngUrl) => rngUrl === url));
    if (exact) return exact.id;

    const localUrl = fromLocalFileUrl(url);
    if (localUrl) {
      const localMatch = this.schemas.find((schema) =>
        schema.rng.some((rngUrl) => fromLocalFileUrl(rngUrl) === localUrl),
      );
      if (localMatch) return localMatch.id;
    }

    // remove the protocol in order to disregard http/https for improved chances of matching below
    const urlNoProtocol = url.split(/^.*?\/\//)[1] ?? '';

    // search the known schemas, if the url matches it must be the same one
    const schema = this.schemas.find((schema) => {
      const match = schema.rng.find((rngUrl) => rngUrl.includes(urlNoProtocol));
      if (match) return schema;
    });

    return schema?.id;
  }

  /**
   * Get the root tag name for the current schema.
   * @returns {String}
   */
  getRoot() {
    return this.root;
  }

  /**
   * Get the header tag name for the current schema.
   * @returns {String}
   */
  getHeader() {
    return this.header;
  }

  /**
   * Get the name of the ID attribute for the current schema.
   * @returns {String}
   */
  getIdName() {
    return this.idName;
  }

  /**
   * Get the URL for the CSS for the current schema.
   * @returns {String}
   */
  getCss() {
    return this.css;
  }

  /**
   * Is the current schema custom? I.e. is it lacking entity mappings?
   * @returns {Boolean}
   */
  isSchemaCustom() {
    return this.getCurrentSchema()?.mapping === undefined;
  }

  getCurrentDocumentSchemaUrl() {
    return this.documentSchemaUrl;
  }

  setDocumentSchemaUrl(url: string) {
    this.documentSchemaUrl = url;
  }

  getDocumentCssUrl() {
    return this.documentCssUrl;
  }

  setDocumentCssUrl(url: string) {
    this.documentCssUrl = url;
  }

  /**
   * Checks to see if the tag can contain text, as specified in the schema
   * @param {string} tag The tag to check
   * @returns boolean
   */
  canTagContainText(tag: string) {
    if (tag === this.getRoot()) return false;

    /**
     * @param currEl The element that's currently being processed
     * @param defHits A list of define tags that have already been processed
     * @param level The level of recursion
     * @param status Keep track of status while recursing
     */
    const checkForText = (
      currEl: JQuery<HTMLElement>,
      defHits: any,
      level: number,
      status: any,
    ) => {
      if (status.canContainText) return false;

      // check for the text element
      const textHits = currEl.find('text');
      if (textHits.length > 0 && (level === 0 || textHits.parents('element').length === 0)) {
        // if we're processing a ref and the text is inside an element then it doesn't count
        status.canContainText = true;
        return false;
      }

      // now process the references
      currEl.find('ref').each((_index, el) => {
        const name = $(el).attr('name');
        if ($(el).parents('element').length > 0 && level > 0) {
          return; // ignore other elements
        }
        //@ts-expect-error
        if (!defHits[name]) {
          //@ts-expect-error
          defHits[name] = true;
          //@ts-expect-error
          const def = $('define[name="' + name + '"]', this.schemaXML);
          //@ts-expect-error
          return checkForText(def, defHits, level + 1, status);
        }
      });
    };

    const useLocalStorage = false;
    if (useLocalStorage) {
      const localData = localStorage[`cwrc.${tag}.text`];
      if (localData) return localData === 'true';
    }
    //@ts-expect-error
    const element = $(`element[name="${tag}"]`, this.schemaXML);
    const defHits = {};
    const level = 0;
    const status = { canContainText: false }; // needs to be an object so change is visible outside of checkForText
    //@ts-expect-error
    checkForText(element, defHits, level, status);

    if (useLocalStorage) localStorage[`cwrc.${tag}.text`] = status.canContainText;

    return status.canContainText;
  }

  isTagBlockLevel(tagName: string) {
    if (tagName === this.getRoot()) return true;
    return !!this.writer.editor?.schema.getBlockElements()[tagName];
  }

  isTagEntity(tagName: string) {
    const type = this.mapper.getEntityTypeForTag(tagName);
    return type !== null;
  }

  getTagForEditor(tagName: string) {
    return this.isTagBlockLevel(tagName) ? this.BLOCK_TAG : this.INLINE_TAG;
  }

  getDocumentationForTag(tag: string) {
    //@ts-expect-error
    const element = $(`element[name="${tag}"]`, this.schemaXML);
    const doc = $('a\\:documentation, documentation', element).first().text();
    return doc;
  }

  getFullNameForTag(tag: string) {
    //@ts-expect-error
    const element = $(`element[name="${tag}"]`, this.schemaXML);
    const doc = $('a\\:documentation, documentation', element).first().text();
    // if the tag name is an abbreviation, we expect the full name to be at the beginning of the doc, in parentheses
    const hit = /^\((.*?)\)/.exec(doc);
    if (hit !== null) return hit[1];
    return '';
  }

  /**
   * Gets the children for a tag but only includes those that are required.
   * @param {String} tag The tag name.
   * @returns {Object}
   */
  getRequiredChildrenForTag(tag: string) {
    const tags = this.getChildrenForTag(tag);
    for (let i = tags.length - 1; i > -1; i--) {
      if (tags[i].required !== true) {
        tags.splice(i, 1);
      }
    }
    return tags;
  }

  /**
   * Checks to see if the tag can have attributes, as specified in the schema
   * @param {string} tag The tag to check
   * @returns boolean
   */
  canTagHaveAttributes(tag: string) {
    const atts = this.getAttributesForTag(tag);
    return atts.length !== 0;
  }

  /**
   * Verifies that the child has a valid parent.
   * @param {String} childName The child tag name
   * @param {String} parentName The parent tag name
   * @returns {Boolean}
   */
  isTagValidChildOfParent(childName: string, parentName: string) {
    const parents = this.getParentsForTag(childName);
    for (const parent of parents) {
      if (parent.name === parentName) return true;
    }
    return false;
  }

  /**
   * Verifies that the attribute is valid for the tag
   * @param {String} attributeName The attribute name
   * @param {String} tagName The tag name
   * @returns {Boolean}
   */
  isAttributeValidForTag(attributeName: string, tagName: string) {
    const atts = this.getAttributesForTag(tagName);
    for (const att of atts) {
      if (att.name === attributeName) return true;
    }
    return false;
  }

  /**
   * Checks whether the node removal would invalidate the document.
   * @param {Element} contextNode The context node for the removal
   * @param {Boolean} removeContext Is the context node being removed
   * @param {Boolean} removeContents Are the node contents being removed?
   * @returns {Boolean}
   */
  wouldDeleteInvalidate({
    contextNode,
    removeContext = false,
    removeContents = false,
  }: {
    contextNode: Element;
    removeContext?: boolean;
    removeContents?: boolean;
  }) {
    let parentEl = contextNode.parentElement;
    if (!parentEl) return false;

    let parentTag = parentEl.getAttribute('_tag');

    // handling for when we're inside entityHighlight
    while (parentTag === null) {
      parentEl = parentEl?.parentElement ?? null;
      if (parentEl === null) {
        log.warn('schemaManager.wouldDeleteInvalidate: outside of document!');
        return false;
      }
      parentTag = parentEl.getAttribute('_tag');
    }

    if (removeContext) {
      // check if parent requires context
      const contextTag = contextNode.getAttribute('_tag');
      const requiredChildren = this.getRequiredChildrenForTag(parentTag);
      const contextIsRequired = requiredChildren.find((rc) => {
        return rc.name === contextTag;
      });
      if (contextIsRequired) {
        // it's required, do siblings satisfy the requirement?
        let hasRequiredSibling = false;

        for (let i = 0; i < parentEl.children.length; i++) {
          const child = contextNode.children[i];

          if (child && child !== contextNode) {
            const childTag = child.getAttribute('_tag');
            if (childTag === contextTag) {
              hasRequiredSibling = true;
              break;
            }
          }
        }
        if (!hasRequiredSibling) return true;
      }

      if (!removeContents) {
        // check if context children are valid for parent
        const validChildren = this.getChildrenForTag(parentTag);

        for (const child of contextNode.children) {
          const childTag = child?.getAttribute('_tag');
          const childIsValid = validChildren.find((vc) => {
            return vc.name === childTag;
          });
          if (!childIsValid) return true;
        }

        // check if context has text and if parent can contain text
        let hasTextNodes = false;
        contextNode.childNodes.forEach((cn) => {
          if (!hasTextNodes && cn.nodeType === Node.TEXT_NODE && cn.textContent !== '\uFEFF') {
            hasTextNodes = true;
          }
        });
        if (hasTextNodes && this.canTagContainText(parentTag) === false) {
          return true;
        }
      }
    } else {
      if (removeContents) {
        // check if context children are required
        const contextTag = contextNode.getAttribute('_tag');
        if (!contextTag) return false;

        const requiredChildren = this.getRequiredChildrenForTag(contextTag);
        if (requiredChildren.length > 0) return true;
      }
    }

    return false;
  }

  /**
   * It adds a new schema to the list of schemas
   * @param schema - Omit<Schema, 'id'>
   * @returns The new schema that was added.
   */
  addSchema({ name, rng, css, mapping, editable }: Omit<Schema, 'id'>) {
    let id = name ? name.replaceAll(' ', '_').toLowerCase() : `schema_${nanoid()}`;
    if (name && this.schemas.some((sch) => sch.id === id)) id = `${id}_${nanoid()}`;

    const newSchema: Schema = { id, name, rng, css, mapping, editable };

    this.schemas.push(newSchema);
    this.writer.event('schemaAdded').publish(newSchema.id);
    return newSchema;
  }

  /**
   * Updates a schema
   * @param updatedSchema - Schema - this is the updated schema that we're going to use to
   * update the schemas array.
   */
  updateSchema(updatedSchema: Schema) {
    this.schemas = this.schemas.map((schema) =>
      schema.id !== updatedSchema.id ? updatedSchema : schema,
    );
  }

  /**
   * It takes a schemaId as an argument, and then filters the schemas array to remove the schema with
   * the matching id
   * @param {string} schemaId - The id of the schema to delete
   */
  deleteSchema(schemaId: string) {
    this.schemas = this.schemas.filter((schema) => schema.id !== schemaId);
  }

  /**
   * Gets the url(s) associated with the schema
   * @param {String} schemaId The ID of the schema
   * @returns {Array|null} Collection of urls for the schema
   */
  getUrlForSchema(schemaId: string) {
    const schemaEntry = this.schemas.find((schema) => schema.id === schemaId);
    if (schemaEntry) return schemaEntry.rng;
    return null;
  }

  /**
   * Gets the name of the root element for the schema
   * @param {string} schemaId - the id of the schema you want to get the root element for
   * @returns An array of strings.
   */
  async getPossibleRootsForSchema(schemaId: string) {
    if (this.mapper.mappings.has(schemaId)) {
      //@ts-expect-error
      return this.mapper.mappings.get(schemaId).root;
    }

    const rng = this.getUrlForSchema(schemaId);

    if (!rng) {
      log.warn(`schemaManager.getPossibleRootsForSchema: no url for ${schemaId}`);
      return [];
    }

    //load resource
    const schemaXML = await this.loadSchemaFile(rng);
    if (!schemaXML) {
      log.warn(`schemaManager.getPossibleRootsForSchema: could not connect to ${schemaId}`);
      return [];
    }

    let rootEl = $('start element:first', schemaXML).attr('name');
    if (!rootEl) {
      const startName = $('start ref:first', schemaXML).attr('name');
      rootEl = $(`define[name="${startName}"] element`, schemaXML).attr('name');
    }

    return [rootEl];
  }

  /**
   * Load a Schema XML.
   * @param {Array} urls Collection of url sources
   * @returns {Document} The XML
   */
  private async loadSchemaFile(
    urls: string[],
    options: { prioritizeDocumentSchema?: boolean; trackRng?: boolean } = {},
  ) {
    const { prioritizeDocumentSchema = true, trackRng = true } = options;
    urls = filterResourceUrls(urls);

    // Prioritize the document schema — but NOT when resolving an <include>: an
    // include's href is a specific file (e.g. the TEI core), and if
    // documentSchemaUrl happens to equal the wrapper's own URL (set whenever a
    // document is opened, and persists across project switches since
    // schemaManager isn't recreated per project), this override would fetch the
    // wrapper again instead of the include target, silently truncating the
    // merged schema to just the wrapper's ~200 lines.
    if (
      prioritizeDocumentSchema &&
      this.documentSchemaUrl &&
      !urls.includes(this.documentSchemaUrl)
    ) {
      urls = filterResourceUrls([this.documentSchemaUrl, ...urls]);
    }

    let isAltRoute = false;

    let attempt = 0;
    for await (const url of urls) {
      attempt++;

      const data = await fetchResourceText(url);

      if (!data) {
        let message = `A network error occurred while trying to reach ${url}.`;
        message += ' This could be a CORS issue or a dropped internet connection.';
        message += ` ${
          attempt < urls.length
            ? ` ${this.writer.appDisplayName} will try to load the Schema using an alternative route.`
            : ` ${this.writer.appDisplayName} could not load a schema for this document.`
        }`;
        log.warn(message);

        isAltRoute = true;
        continue;
      }

      if (isAltRoute) log.info(`Schema loaded from an alternative route: ${url}`);

      // Convert to XML
      const xml = this.writer.utilities.stringToXML(data);
      if (trackRng) this.rng = url;
      return xml;
    }

    return;
  }

  /**
   * Load an include schema.
   * @param {String} schemaEntry The Schchema object, including the Schema URL
   * @param {String} include The schema to include
   */
  private async loadIncludes(schemaEntry: { rng?: string[] }, include: JQuery<HTMLElement>) {
    const includeHref = include.attr('href');
    if (!includeHref) return;

    const includeFile = includeHref.includes('/')
      ? (includeHref.match(/(.*\/)(.*)/)?.[2] ?? includeHref)
      : includeHref;

    const baseRng = this.rng ?? schemaEntry.rng?.[0];
    if (!baseRng) return;

    let url: string;
    const localBase = fromLocalFileUrl(baseRng);
    if (localBase) {
      const separator = localBase.includes('\\') ? '\\' : '/';
      const dir = localBase.slice(
        0,
        Math.max(localBase.lastIndexOf('/'), localBase.lastIndexOf('\\')),
      );
      const includePath = `${dir}${separator}${includeFile}`;
      url = `grognard://${encodeURIComponent(includePath)}`;
    } else if (/^https?:\/\//i.test(baseRng)) {
      const schemaBase = baseRng.match(/(.*\/)(.*)/)?.[1];
      url = schemaBase ? schemaBase + includeFile : `schema/${includeFile}`;
    } else {
      return;
    }

    //load resource — must fetch exactly this include's URL, not whatever
    // documentSchemaUrl happens to be, and must not clobber this.rng (which
    // tracks the top-level schema's own URL, used to resolve future includes).
    const includesXML = await this.loadSchemaFile([url], {
      prioritizeDocumentSchema: false,
      trackRng: false,
    });
    if (!includesXML) return null;

    include.children().each((_index, el) => {
      if (el.nodeName == 'start') {
        $('start', includesXML).replaceWith(el);
      } else if (el.nodeName == 'define') {
        const name = $(el).attr('name');
        const match = $(`define[name="${name}"]`, includesXML);
        if (match.length == 1) {
          match.replaceWith(el);
        } else {
          $('grammar', includesXML).append(el);
        }
      }
    });

    include.replaceWith($('grammar', includesXML).children());

    return;
  }

  /**
   * Process a schema:
   * - Add CSS for displaying tags in the editor
   * - Hide the header tag
   * - Set references to the elements and the JSON version of the schema
   */
  private async processSchema() {
    // remove old schema elements
    $('#schemaTags', this.writer.editor?.dom.doc).remove();

    // create css to display schema tags
    $('head', this.writer.editor?.getDoc()).append('<style id="schemaTags" type="text/css" />');

    let schemaTags = '';
    const elements: string[] = [];

    // @ts-expect-error

    $('element', this.schemaXML).each((index, el) => {
      const tag = $(el);
      if (!tag) return;

      const tagName = tag.attr('name');
      if (!tagName || elements.includes(tagName)) return;

      elements.push(tagName);
      schemaTags += `
          .showTags *[_tag=${tagName}]:before {
            content: "<${tagName}>";
          }
        `;
      schemaTags += `
          .showTags *[_tag=${tagName}]:after {
            content: "</${tagName}>";
          }
        `;
    });
    elements.sort();

    schemaTags += `
      persName[cert="unknown"]:not([key]),
      placeName[cert="unknown"]:not([key]),
      orgName[cert="unknown"]:not([key]),
      title[cert="unknown"]:not([key]),
      bibl[cert="unknown"]:not([key]) {
        background-color: rgba(198, 40, 40, 0.08) !important;
        outline: 1px dashed #c62828;
      }
    `;

    // hide the header
    const tagName = this.getTagForEditor(this.header);
    schemaTags += `${tagName} [_tag=${this.header}] { display: none !important; }`;

    $('#schemaTags', this.writer.editor?.getDoc()).text(schemaTags);

    this.schema.elements = elements;
    schemaNavigator.setSchemaElements(this.schema.elements);

    // remove any child tags in the element/attribute documentation, as they are not handled properly during xmlToJSON
    //@ts-expect-error
    $('a\\:documentation *', this.schemaXML).each((index, el) => {
      if (el.parentElement) {
        el.parentElement.innerHTML = this.writer.utilities.escapeHTMLString(
          el.parentElement.textContent,
        );
      }
    });

    //@ts-expect-error
    const schemaGrammar = $('grammar', this.schemaXML)[0];
    this.schemaJSON = this.writer.utilities.xmlToJSON(schemaGrammar);

    if (this.schemaJSON === null) {
      log.warn('schemaManager.loadSchema: schema XML could not be converted to JSON');
    }

    schemaNavigator.setSchemaJSON(this.schemaJSON);
  }

  /**
   * Load a new schema.
   * @fires Writer#loadingSchema
   * @fires Writer#schemaLoaded
   * @param {String} schemaId The ID of the schema to load (from the config)
   * @param {Boolean} loadCss Whether to load the associated CSS
   * @param {Function} [callback] Callback for when the load is complete
   */
  async loadSchema(schemaId: string, css?: string) {
    const schemaEntry = this.schemas.find((schema) => schema.id === schemaId);

    if (!schemaEntry) {
      // this.writer.dialogManager.show('message', {
      //   title: 'Error',
      //   msg: `Error loading schema. No entry found for: ${schemaId}`,
      //   type: 'error',
      // });;
      return;
    }

    this.writer.event('loadingSchema').publish();

    this.schemaId = schemaId;
    this.schemaRevision = null;

    this.writer.overmindActions.document.setInitialStateSchema(schemaId);

    const schemaMappingsId = schemaEntry.mapping;
    this.mapper.loadMappings(schemaMappingsId);

    //load resource
    const schemaXML = await this.loadSchemaFile(schemaEntry.rng);
    const loadedRngUrl = this.rng ?? schemaEntry.rng[0];
    const loadedRngText = loadedRngUrl ? await fetchResourceText(loadedRngUrl) : null;
    if (loadedRngText) {
      this.schemaRevision = SchemaManager.revisionFromRngContent(loadedRngText);
    }

    if (!schemaXML) {
      this.schemaId = null;
      this.schemaRevision = null;
      // this.writer.dialogManager.getDialog('loadingindicator')?.hide?.();
      // this.writer.dialogManager.show('message', {
      //   title: 'Error',
      //   msg: `<p>Error loading schema from: ${schemaEntry.name}.</p>`,
      //   //   <p>Document editing will not work properly!</p>`,
      //   type: 'error',
      // });
      // return { success: false };
      return;
    }

    this.schemaXML = schemaXML;

    // get root element
    let startEl = $('start element:first', this.schemaXML).attr('name');
    if (!startEl) {
      const startName = $('start ref:first', this.schemaXML).attr('name');
      startEl = $(`define[name="${startName}"] element`, this.schemaXML).attr('name');
    }

    this.root = startEl ?? null;
    this.header = this.mapper.getHeaderTag();
    this.idName = this.mapper.getIdAttributeName();

    // TODO is this necessary
    const additionalBlockElements = this.mapper.getBlockLevelElements();
    const blockElements = this.writer.editor?.schema.getBlockElements();
    if (blockElements) {
      for (const tag of additionalBlockElements) {
        blockElements[tag] = {};
      }
    }

    // handle includes
    const include = $('include:first', this.schemaXML); // TODO add handling for multiple includes
    if (include.length == 1) {
      await this.loadIncludes(schemaEntry, include); // TODO  it seems that includes goes nowhere.
    }

    //load CSS
    // if (loadCss === true) this.loadSchemaCSS(schemaEntry.id);
    this.loadSchemaCSS(css);

    //Process schema (UI/CSS/schemaJSON for the editor)
    await this.processSchema();

    // Compile RelaxNG in the validator worker before notifying listeners.
    await this.writer.utilities.sendSchemaToWorkerValidator({ silent: true });

    this.writer.event('schemaLoaded').publish();

    return true;
  }

  /**
   * Load the CSS and convert it to the internal format
   * @param {Array} schemaId Collection of url sources
   */
  async loadSchemaCSS(_css?: string) {
    $('#schemaRules', this.writer.editor?.dom.doc).remove();
    $('#schemaRules', document).remove();

    const schemaEntry = this.schemas.find((schema) => schema.id === this.schemaId);

    if (!schemaEntry?.css || schemaEntry.css.length === 0) {
      // this.writer.dialogManager.show('message', {
      //   title: 'Error',
      //   msg: `Error loading schema css. No entry found for: ${this.schemaId}`,
      //   type: 'error',
      // });
      return;
    }

    // We set the CSS schema entry based on the following priority:
    // - the document css
    // - the css assi--ai-size-sm)
    let CSSset = new Set<string>();
    if (this.documentCssUrl) CSSset.add(this.documentCssUrl);
    CSSset = new Set([...CSSset, ...schemaEntry.css]);

    //load resource
    const cssData = await this.loadCSSFile([...CSSset]);
    if (!cssData) {
      // this.writer.dialogManager.show('message', {
      //   title: 'Error',
      //   msg: 'No CSS could be loaded to this schema.',
      //   type: 'error',
      // });
      return null;
    }

    const cssObj = CSS.parse(cssData);
    const popupCssObj: CSS.Stylesheet = {
      type: 'stylesheet',
      stylesheet: { rules: [] },
    };

    const rules = cssObj.stylesheet?.rules;

    if (rules) {
      for (const rule of rules) {
        const popupRule = Object.assign({}, rule);

        if (rule?.type === 'rule') {
          const convertedSelectors = [];
          const convertedPopupSelectors = [];

          //? rules doesn't have selectors
          //@ts-expect-error
          for (const selector of rule.selectors) {
            const newSelector = selector.replace(/(^|,|\s)(#?\w+)/g, (str, p1, p2) => {
              return p1 + '*[_tag="' + p2 + '"]';
            });
            convertedPopupSelectors.push('.cwrc .popup ' + newSelector);
            convertedSelectors.push(newSelector);
          }

          rule.selectors = convertedSelectors;
          //@ts-expect-error
          popupRule.selectors = convertedPopupSelectors;

          popupCssObj.stylesheet?.rules.push(popupRule);
        }
      }
    }

    const cssString = CSS.stringify(cssObj);
    const popupCssString = CSS.stringify(popupCssObj);

    $('head', this.writer.editor?.dom.doc).append('<style id="schemaRules" type="text/css" />');
    $('#schemaRules', this.writer.editor?.dom.doc).text(cssString);

    // we need to also append to document in order for note popups to be styled
    $('head', document).append('<style id="schemaRules" type="text/css" />');
    $('#schemaRules', document).text(popupCssString);
  }

  /**
   * Load a Schema CSS.
   * @param {Array} urls Collection of url sources
   * @returns {String} The CSS
   */
  private async loadCSSFile(urls: string[]) {
    urls = filterResourceUrls(urls);

    let isAltRoute = false;

    let attempt = 0;
    for await (const url of urls) {
      attempt++;

      const data = await fetchResourceText(url);

      if (!data) {
        let message = `A network error occurred while trying to reach ${url}.`;
        message += ' This could be a CORS issue or a dropped internet connection.';
        message += ` ${
          attempt < urls.length
            ? `${this.writer.appDisplayName} will try to load the CSS using an alternative route.`
            : `${this.writer.appDisplayName} could not load a CSS for this document.`
        }`;
        log.warn(message);

        isAltRoute = true;
        continue;
      }

      //success
      if (isAltRoute) log.info(`CSS loaded from an alternative route: ${url}`);
      this.css = url; // redefine schema manager css based on the available url
      return data;
    }

    return;
  }
}

export default SchemaManager;
