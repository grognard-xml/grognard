import type { EntityKind } from '../autoTagging/entities';

export {};

declare global {
  interface JQuery<TElement = HTMLElement> {
    dialog(method: 'option', optionName: string): any;
    dialog(...args: unknown[]): JQuery<TElement>;
  }

  type DesktopLeftPanelTab = 'explorer' | 'find' | 'xpath' | 'toc' | 'markup';

  interface DesktopLeftPanelBridge {
    collapse: () => void;
    expand: () => void;
    showTab: (tab: DesktopLeftPanelTab) => void;
  }

  type DesktopRightPanelTab =
    'fileMetadata' | 'attributes' | 'css' | 'imageViewer' | 'validation' | 'translation';

  interface DesktopRightPanelBridge {
    collapse: () => void;
    expand: () => void;
    showTab: (tab: DesktopRightPanelTab) => void;
  }

  type DesktopValidatorInstrumentation = {
    workerLoading: boolean;
    workerLoaded: boolean;
    schemaLoading: boolean;
    schemaLoaded: boolean;
    validationRunning: boolean;
    validationPanelRequested: boolean;
    validationPanelMounted: boolean;
  };

  interface LeafWriterElectronApi {
    /** Load a VIAF cluster JSON in the main process (avoids renderer CORS / Cloudflare). */
    viafFetchCluster?: (viafId: string) => Promise<unknown>;
    authorityRefLookup?: (request: {
      source: 'cbdb' | 'dila' | 'norbert';
      authorityId: string;
    }) => Promise<any>;
    entitySqliteExportXml?: (request: { databasePath: string }) => Promise<string | null>;
    entitySqliteImportXml?: (request: { databasePath: string; xml: string }) => Promise<unknown>;
    entitySqliteCandidates?: (request: {
      databasePath: string;
      kind: EntityKind;
    }) => Promise<Array<{
      id: string;
      kind: EntityKind;
      names: Array<{ text: string; type?: string }>;
      description?: string;
      startYear?: number;
      endYear?: number;
      nobleTitles: Array<{
        fief?: string;
        roleName?: string;
        posthumousName?: string;
        dynasty?: string;
      }>;
    }> | null>;
    entitySqliteUpdateNames?: (request: {
      databasePath: string;
      entityId: string;
      text: string;
      nameType?: string | null;
      language?: string | null;
    }) => Promise<number>;
    entitySqliteTombstoneNames?: (request: {
      databasePath: string;
      entityId: string;
      text: string;
      reason?: string;
    }) => Promise<number>;
    entitySqliteUpdateDescription?: (request: {
      databasePath: string;
      entityId: string;
      description: string | null;
    }) => Promise<void>;
    entitySqliteUpdateSubtype?: (request: {
      databasePath: string;
      entityId: string;
      subtype: string | null;
    }) => Promise<void>;
    entitySqliteGetNotes?: (request: {
      databasePath: string;
      entityId: string;
    }) => Promise<Array<{ xml: string }>>;
    entitySqliteSetNote?: (request: {
      databasePath: string;
      entityId: string;
      xml: string;
    }) => Promise<void>;
    entitySqliteRemoveName?: (request: {
      databasePath: string;
      entityId: string;
      text: string;
    }) => Promise<boolean>;
    entitySqliteAddName?: (request: {
      databasePath: string;
      entityId: string;
      text: string;
      nameType?: string | null;
      nameRole?: string;
      language?: string | null;
      isPrimary?: boolean;
      origin?: 'user' | 'authority' | 'xml';
      source?: string | null;
    }) => Promise<unknown>;
    entitySqliteSetUserDate?: (request: {
      databasePath: string;
      entityId: string;
      part: 'birth' | 'death';
      year: number | null;
      precision?: string | null;
    }) => Promise<void>;
    entitySqliteSetUserWorkDate?: (request: {
      databasePath: string;
      entityId: string;
      startYear: number | null;
      endYear?: number | null;
      startPrecision?: string | null;
      endPrecision?: string | null;
    }) => Promise<void>;
    entitySqliteAddNationality?: (request: {
      databasePath: string;
      entityId: string;
      label: string;
      ref?: string | null;
      source?: string | null;
      origin?: 'user' | 'authority' | 'xml';
    }) => Promise<boolean>;
    entitySqliteAddOrigin?: (request: {
      databasePath: string;
      entityId: string;
      label: string;
      ref?: string | null;
      source?: string | null;
      origin?: 'user' | 'authority' | 'xml';
    }) => Promise<boolean>;
    entitySqliteAddNobleTitle?: (request: {
      databasePath: string;
      entityId: string;
      input: {
        dynasty?: string;
        fief?: string;
        posthumousName?: string;
        title?: string;
        source?: string | null;
        origin?: 'user' | 'authority' | 'xml';
      };
    }) => Promise<boolean>;
    entitySqliteUpdateNobleTitle?: (request: {
      databasePath: string;
      entityId: string;
      key: string;
      input: {
        dynasty?: string;
        fief?: string;
        posthumousName?: string;
        title?: string;
      };
    }) => Promise<boolean>;
    entitySqliteSetUserWorkAuthors?: (request: {
      databasePath: string;
      entityId: string;
      authors: Array<{ name: string; ref?: string | null; key?: string | null }>;
    }) => Promise<void>;
    entitySqliteAttachAuthority?: (request: {
      databasePath: string;
      entityId: string;
      type: string;
      value: string;
    }) => Promise<boolean>;
    entitySqliteDecoupleAuthority?: (request: {
      databasePath: string;
      entityId: string;
      type: string;
      value: string;
    }) => Promise<number>;
    entitySqliteRejectAssertion?: (request: {
      databasePath: string;
      entityId: string;
      key: string;
    }) => Promise<boolean>;
    entitySqliteRemoveAssertion?: (request: {
      databasePath: string;
      entityId: string;
      key: string;
    }) => Promise<boolean>;
    entitySqliteValidateAssertion?: (request: {
      databasePath: string;
      entityId: string;
      key: string;
    }) => Promise<boolean>;
    entitySqliteAcceptDateAssertion?: (request: {
      databasePath: string;
      entityId: string;
      key: string;
    }) => Promise<boolean>;
    entitySqliteAcceptGeoAssertion?: (request: {
      databasePath: string;
      entityId: string;
      key: string;
    }) => Promise<boolean>;
    entitySqliteAcceptDescriptionAssertion?: (request: {
      databasePath: string;
      entityId: string;
      key: string;
    }) => Promise<boolean>;
    entitySqliteAcceptAdminLevelAssertion?: (request: {
      databasePath: string;
      entityId: string;
      key: string;
    }) => Promise<boolean>;
    entitySqliteSetOriginReference?: (request: {
      databasePath: string;
      entityId: string;
      key: string;
      reference: string;
    }) => Promise<boolean>;
    entitySqliteRenamePrimaryName?: (request: {
      databasePath: string;
      entityId: string;
      text: string;
    }) => Promise<boolean>;
    entitySqliteSetRomanizedName?: (request: {
      databasePath: string;
      entityId: string;
      text: string;
      language?: string;
    }) => Promise<void>;
    entitySqliteAutoCleanNames?: (request: { databasePath: string }) => Promise<{
      dedupedNames: number;
      removedNan: number;
      removedInvalidFamilyGiven: number;
      removedUntyped: number;
      promotedRomanizations: number;
    }>;
    entitySqliteApplyConcordance?: (request: {
      databasePath: string;
      associations: Array<{
        source: string;
        canonicalId: string;
        mergedFromId: string;
        notes?: string;
        sourceRef?: string;
      }>;
    }) => Promise<{
      applied: number;
      alreadyPresent: number;
      rejected: number;
      unresolved: number;
      conflicts: Array<{
        association: {
          source: string;
          canonicalId: string;
          mergedFromId: string;
          notes?: string;
          sourceRef?: string;
        };
        entityIds: string[];
      }>;
    }>;
    entitySqliteRejectConcordance?: (request: {
      databasePath: string;
      association: {
        source: string;
        canonicalId: string;
        mergedFromId: string;
        notes?: string;
        sourceRef?: string;
      };
      entityId?: string;
      reason?: string;
    }) => Promise<boolean>;
    entitySqliteMarkDuplicateIntentional?: (request: {
      databasePath: string;
      entityIds: string[];
    }) => Promise<boolean>;
    entitySqliteBackfillDecisionTargets?: (request: {
      databasePath: string;
    }) => Promise<{ updated: number; inserted: number; unchanged: number } | null>;
    entitySqliteSoftDelete?: (request: {
      databasePath: string;
      entityId: string;
    }) => Promise<boolean>;
    entitySqliteMerge?: (request: {
      databasePath: string;
      keepId: string;
      dropIds: string[];
    }) => Promise<{
      keepId: string;
      remap: Record<string, string>;
      centralConflicts: Array<{
        userStableId: string;
        keptCentralId: string;
        droppedCentralId: string;
      }>;
    }>;
    entitySqliteCreateRelation?: (request: {
      databasePath: string;
      subjectEntityId: string;
      objectEntityId: string;
      relationType: string;
      symmetric?: boolean;
      reference?: string | null;
    }) => Promise<number>;
    entitySqliteListRelations?: (request: { databasePath: string; entityId: string }) => Promise<
      Array<{
        id: number;
        relationType: string;
        isSubject: boolean;
        symmetric: boolean;
        reference: string | null;
        otherEntityId: string | null;
        otherEntityKind: EntityKind | null;
        otherEntityName: string | null;
      }>
    >;
    entitySqliteUpdateRelationStatus?: (request: {
      databasePath: string;
      relationId: number;
      status: 'active' | 'rejected' | 'withdrawn';
    }) => Promise<boolean>;
    entitySqliteCreatePopulated?: (request: {
      databasePath: string;
      id: string;
      kind: EntityKind;
      description?: string | null;
      names?: Array<{
        text: string;
        nameType?: string | null;
        language?: string | null;
        isPrimary?: boolean;
        origin?: 'user' | 'authority' | 'xml';
        source?: string | null;
      }>;
      authorities?: Array<{
        type: string;
        value: string;
        origin?: 'user' | 'authority' | 'xml';
        source?: string | null;
      }>;
      familyName?: string | null;
      givenName?: string | null;
    }) => Promise<unknown>;
    entitySqliteApplyAuthorityBackfillPatch?: (request: {
      databasePath: string;
      entityId: string;
      names?: Array<{
        text: string;
        nameType?: string | null;
        language?: string | null;
        source?: string | null;
      }>;
      familyName?: string | null;
      givenName?: string | null;
      rewriteUnvalidatedPersonNames?: boolean;
      romanized?: { text: string; language?: string | null } | null;
      dates?: Array<{
        source: string;
        startYear?: number | null;
        endYear?: number | null;
      }>;
      nationalities?: Array<{ label: string; ref?: string | null; source: string }>;
      origins?: Array<{
        label: string;
        ref?: string | null;
        source: string;
        nameType?: string | null;
      }>;
      offices?: Array<{ label: string; ref?: string | null; source: string }>;
      nobleTitles?: Array<{
        placeName: string;
        roleName: string;
        posthumousName?: string | null;
        dynasty?: string | null;
        ref?: string | null;
        source: string;
      }>;
      authorityCaches?: Array<{
        authorityType: string;
        source?: string | null;
        payload: unknown;
      }>;
      workAuthors?: Array<{
        name: string;
        personId?: string | null;
        ref?: string | null;
        source?: string | null;
      }>;
      workDate?: {
        source: string;
        startYear?: number | null;
        endYear?: number | null;
      } | null;
    }) => Promise<{ changed: boolean; namesAdded: number }>;
    entitySqliteReconcileXmlExtractedData?: (request: {
      databasePath: string;
      documentKey: string;
      wrappers: Array<{
        entityId: string;
        source: string;
        assertions: Array<{
          element: string;
          value: string;
          ref?: string | null;
          children?: Array<{ element: string; value: string; ref?: string | null }>;
        }>;
      }>;
      purgeOrphanSources?: boolean;
    }) => Promise<{ wrappers: number; added: number; removed: number; retained: number }>;
    entitySqliteEntityContentHash?: (request: {
      databasePath: string;
      entityId: string;
    }) => Promise<string | null>;
    entitySqliteReplaceEntityContent?: (request: {
      sourceDatabasePath: string;
      sourceEntityId: string;
      targetDatabasePath: string;
      targetEntityId: string;
    }) => Promise<{ changed: boolean }>;
    entitySqliteGetCentralId?: (request: {
      databasePath: string;
      entityId: string;
      userStableId: string;
    }) => Promise<string | null>;
    entitySqliteSetCentralMapping?: (request: {
      databasePath: string;
      entityId: string;
      userStableId: string;
      centralId: string;
    }) => Promise<boolean>;
    entitySqliteClearCentralMapping?: (request: {
      databasePath: string;
      entityId: string;
      userStableId: string;
    }) => Promise<boolean>;
    entitySqliteListMappingsByCentralIds?: (request: {
      databasePath: string;
      userStableId: string;
      centralIds: string[];
    }) => Promise<Array<{ projectEntityId: string; centralId: string; label: string | null }>>;
    entitySqliteListAllCentralMappings?: (request: {
      databasePath: string;
      userStableId: string;
    }) => Promise<Array<{ projectEntityId: string; centralId: string }>>;
    entitySqliteListLinkedCentralIds?: (request: {
      databasePath: string;
      userStableId: string;
    }) => Promise<string[] | null>;
    entitySqliteCountUnlinked?: (request: {
      databasePath: string;
      userStableId: string;
    }) => Promise<number | null>;
    entitySqliteCountEntities?: (request: { databasePath: string }) => Promise<number | null>;
    entitySqliteFindByAuthority?: (request: {
      databasePath: string;
      kind: EntityKind;
      type: string;
      value: string;
    }) => Promise<string[]>;
    entitySqliteFindByNameDates?: (request: {
      databasePath: string;
      kind: EntityKind;
      name: string;
      startYear?: number | null;
      endYear?: number | null;
    }) => Promise<string | null>;
    entitySqliteForceRejectAssertion?: (request: {
      databasePath: string;
      entityId: string;
      key: string;
    }) => Promise<boolean>;
    entitySqliteSearch?: (request: {
      databasePath: string;
      kind: EntityKind;
      query: string;
      limit?: number;
    }) => Promise<Array<{
      id: string;
      label: string;
      description?: string;
      idnos: Array<{ type: string; value: string }>;
    }> | null>;
    entitySqliteGet?: (request: {
      databasePath: string;
      entityId: string;
    }) => Promise<unknown | null>;
    entitySqliteDatabaseId?: (databasePath: string) => Promise<string | null>;
    entitySqliteListIds?: (request: {
      databasePath: string;
      kind?: EntityKind;
    }) => Promise<string[] | null>;
    entitySqliteListPanelSummaries?: (request: {
      databasePath: string;
      kind?: EntityKind;
    }) => Promise<unknown[] | null>;
    entitySqliteAuthorityDuplicates?: (databasePath: string) => Promise<unknown[] | null>;
    lspStart: (options?: {
      defaultSchemaRng?: string;
      projectRoot?: string;
    }) => Promise<{ ok: boolean; error?: string; initializationOptions?: unknown }>;
    lspSend: (message: unknown) => Promise<{ ok: boolean }>;
    onLspMessage: (callback: (message: unknown) => void) => () => void;
    /** Interface (window chrome) zoom — scales the entire UI, unlike the per-pane text zooms. */
    setUiZoomFactor?: (factor: number) => void;
    getUiZoomFactor?: () => number;
    /** Chromium spellcheck for the translation pane (dictionary language follows the target lang). */
    setTranslationSpellcheck?: (options: {
      enabled: boolean;
      languageCodes?: string[];
    }) => Promise<void>;
    getLanguageToolSettings?: () => Promise<{
      enabled: boolean;
      baseUrl: string;
      verifiedAt: string | null;
      verifiedBaseUrl: string;
      checkMode: 'onDemand' | 'live';
      managedInstall: boolean;
      ngramsEnabled: boolean;
      installedVersion: string | null;
    }>;
    checkLanguageTool?: (request: {
      text: string;
      language?: string | null;
      databasePaths?: string[];
    }) => Promise<{
      ok: boolean;
      error?: string;
      language?: string;
      matches?: Array<{
        message: string;
        shortMessage: string;
        offset: number;
        length: number;
        replacements: string[];
        ruleId?: string;
      }>;
    }>;
    languageToolGetInstallStatus?: () => Promise<{
      installed: boolean;
      version: string | null;
      path?: string | null;
      port?: number;
      ngrams: { en: boolean };
      java: { ok: boolean; version?: string; major?: number; error?: string; managed?: boolean };
      javaInstallOffered: boolean;
      managedJavaInstalled: boolean;
      server: 'stopped' | 'starting' | 'running' | 'failed';
      serverError?: string;
    }>;
    languageToolInstallJava?: () => Promise<{
      installed: boolean;
      version: string | null;
      path?: string | null;
      port?: number;
      ngrams: { en: boolean };
      java: { ok: boolean; version?: string; major?: number; error?: string; managed?: boolean };
      javaInstallOffered: boolean;
      managedJavaInstalled: boolean;
      server: 'stopped' | 'starting' | 'running' | 'failed';
      serverError?: string;
    }>;
    languageToolInstall?: () => Promise<{
      installed: boolean;
      version: string | null;
      path?: string | null;
      port?: number;
      ngrams: { en: boolean };
      java: { ok: boolean; version?: string; major?: number; error?: string; managed?: boolean };
      javaInstallOffered: boolean;
      managedJavaInstalled: boolean;
      server: 'stopped' | 'starting' | 'running' | 'failed';
      serverError?: string;
    }>;
    languageToolRemove?: () => Promise<{
      installed: boolean;
      version: string | null;
      path?: string | null;
      port?: number;
      ngrams: { en: boolean };
      java: { ok: boolean; version?: string; major?: number; error?: string; managed?: boolean };
      javaInstallOffered: boolean;
      managedJavaInstalled: boolean;
      server: 'stopped' | 'starting' | 'running' | 'failed';
      serverError?: string;
    }>;
    languageToolInstallNgrams?: () => Promise<{
      installed: boolean;
      version: string | null;
      path?: string | null;
      port?: number;
      ngrams: { en: boolean };
      java: { ok: boolean; version?: string; major?: number; error?: string; managed?: boolean };
      javaInstallOffered: boolean;
      managedJavaInstalled: boolean;
      server: 'stopped' | 'starting' | 'running' | 'failed';
      serverError?: string;
    }>;
    languageToolEnsureServer?: () => Promise<{ ok: boolean; error?: string; port?: number }>;
    onLanguageToolInstallProgress?: (
      callback: (progress: {
        phase: 'download' | 'extract' | 'done';
        receivedBytes?: number;
        totalBytes?: number;
        message?: string;
      }) => void,
    ) => () => void;
    pluginsEnsureSchemaContribution?: (
      pluginId: string,
      projectFilePath: string,
    ) => Promise<{ merged: boolean }>;
    pluginsInvokePython?: (pluginId: string, payload: Record<string, unknown>) => Promise<unknown>;
    kanripoSearch?: (query: string) => Promise<
      {
        id: string;
        title: string;
        section: string;
        dynasty: string;
        authors: string;
        dzid: string;
      }[]
    >;
    kanripoClone?: (
      krId: string,
    ) => Promise<{ cachePath: string; reused: boolean; files: string[] }>;
    kanripoFetchJuan?: (
      krId: string,
      juan: string,
    ) => Promise<{ kr_id: string; loc: string; path: string; files: string[]; reused: boolean }>;
    kanripoFlush?: (krId: string) => Promise<{ ok: boolean }>;
    kanripoFetchCtextParallel?: (options: {
      url: string;
      row?: number | string;
      id?: string;
      contains?: string;
      section?: string;
    }) => Promise<{
      text: string;
      label: string;
      section?: string;
      rowId?: string;
      rowIds?: string[];
      sections?: { id: string; slug: string; title: string; rowCount: number }[];
    }>;
    kanripoListCtextSections?: (
      url: string,
    ) => Promise<{ id: string; slug: string; title: string; rowCount: number }[]>;
    kanripoListWikisourceVolumes?: (
      url: string,
    ) => Promise<{ id: string; slug: string; title: string; rowCount: number }[]>;
    wikisourceInspect?: (url: string) => Promise<unknown>;
    wikisourceFetchPage?: (options: { apiHost: string; title: string }) => Promise<{
      title: string;
      stem: string;
      bodyXml: string;
      header: { title?: string; author?: string; section?: string; notes?: string } | null;
      hasPb: boolean;
    }>;
    onWikisourceImportOrder?: (
      callback: (order: {
        action: string;
        url: string;
        title?: string;
        wiki?: string;
        scope?: 'page' | 'work';
      }) => void,
    ) => () => void;
    onKanripoImportOrder?: (
      callback: (order: {
        action: string;
        url: string;
        kr_id: string;
        scope?: 'work' | 'juan';
        juan?: string;
        loc?: string;
      }) => void,
    ) => () => void;
    onBdrcImportOrder?: (
      callback: (order: {
        action: string;
        url: string;
        etext_id: string;
        scope?: 'volume';
      }) => void,
    ) => () => void;
    kanripoFetchParallelUrl?: (options: {
      url: string;
      section?: string;
      contains?: string;
      fetchAll?: boolean;
    }) => Promise<{
      text: string;
      label: string;
      kind: 'wikisource' | 'generic' | 'ctext';
      url: string;
      pageTitle?: string;
      section?: string;
      rowId?: string;
      rowIds?: string[];
      sections?: { id: string; slug: string; title: string; rowCount: number }[];
    }>;
    daozangStatus?: () => Promise<{
      ready: boolean;
      textCount: number;
      source?: 'user-cache' | 'bundled' | 'none';
      manifest?: Record<string, unknown>;
      cacheRoot?: string;
    }>;
    daozangSearch?: (query: string) => Promise<
      {
        id: string;
        dz_no: string;
        title: string;
        rel_path: string;
        section: string;
        dynasty: string;
        authors: string;
        file_title: string;
      }[]
    >;
    daozangResolveText?: (relPath: string) => Promise<string>;
    daozangReadText?: (
      relPath: string,
    ) => Promise<{ text: string; rel_path: string; path: string }>;
    bdrcInspect?: (input: string) => Promise<{
      utId: string;
      sourceId: string;
      from: 'ut' | 've';
      title: string;
      titleLang?: string;
      access: string | null;
      status: string | null;
      restricted: boolean;
      unsupported: boolean;
      workId: string | null;
      instanceId: string | null;
      imageGroupId: string | null;
      paginated: boolean;
    }>;
    bdrcImport?: (
      input: string,
      opts?: { windowSize?: number; forceRefresh?: boolean; split?: boolean },
    ) => Promise<{
      restricted: boolean;
      unsupported: boolean;
      warnings: string[];
      fromCache: boolean;
      split?: boolean;
      partCount: number;
      revision: string;
      meta: { utId: string; instanceId?: string; workId?: string; volumeId?: string };
      headerFields: Record<string, unknown>;
      sections: {
        n: number | null;
        label: string;
        bodyXml: string;
        pbCount: number;
        structure: 'flat' | 'outline';
      }[];
    }>;
    bdrcImportToProject?: (
      input: string,
      opts: {
        projectRoot: string;
        forceRefresh?: boolean;
        split?: boolean;
        windowSize?: number;
      },
    ) => Promise<{
      restricted: boolean;
      unsupported: boolean;
      warnings: string[];
      fromCache: boolean;
      split?: boolean;
      partCount: number;
      meta: { utId: string; instanceId?: string; workId?: string };
      written: string[];
      pbCount: number;
    }>;
    cbetaCorpusStatus?: () => Promise<{
      present: boolean;
      path: string | null;
      source: 'bundled' | 'legacy-cache' | 'none';
    }>;
    cbetaEnsureCorpus?: () => Promise<{ present: boolean; action?: string }>;
    onPluginPythonProgress?: (
      pluginId: string,
      callback: (progress: import('../autoTagging/dates').SanmiaoChunkProgressEvent) => void,
    ) => () => void;
    showNativeMessageBox?: (options: {
      buttons?: string[];
      cancelId?: number;
      defaultId?: number;
      detail?: string;
      message: string;
      title: string;
      type?: 'error' | 'info' | 'none' | 'question' | 'warning';
    }) => Promise<{ response: number; checkboxChecked: boolean }>;
    reloadProjectBundle?: (
      projectFilePath: string,
    ) => Promise<import('../../../../apps/commons/src/desktop/projectTypes').ProjectBundle | null>;
    clearActiveProject?: () => Promise<boolean>;
    installCatalogSchema?: (
      projectFilePath: string,
      catalogId: string,
    ) => Promise<import('../../../../apps/commons/src/desktop/projectTypes').ProjectBundle>;
    updateProjectFileConfig?: (
      projectFilePath: string,
      patch: Record<string, unknown>,
    ) => Promise<unknown>;
    /** File I/O bridge, used by the entity store and authority pack readers. */
    pathExists?: (filePath: string) => Promise<boolean>;
    readFile?: (filePath: string) => Promise<string>;
    readFileAutoEncoding?: (filePath: string) => Promise<{ encoding: string; text: string }>;
    writeFile?: (filePath: string, content: string) => Promise<void>;
    writeBinaryFile?: (filePath: string, bytes: Uint8Array) => Promise<void>;
    vectorizeGlyphImage?: (
      bytes: Uint8Array,
      options?: { threshold?: number; minBlobPixels?: number; marginPixels?: number },
    ) => Promise<{ svg: string; threshold: number; width: number; height: number }>;
    fetchRemoteImageBytes?: (url: string) => Promise<Uint8Array | null>;
    readPastedImageFile?: (fileUrl: string) => Promise<Uint8Array | null>;
    readClipboardRtfImages?: () => Promise<(Uint8Array | null)[]>;
    ensureDirectory?: (dirPath: string) => Promise<void>;
    readDirectory?: (
      dirPath: string,
      options?: { allFiles?: boolean },
    ) => Promise<{ name: string; isDirectory: boolean; path: string }[]>;
    extractDocxText?: (filePath: string) => Promise<{ text: string; warnings: string[] }>;
    extractOdtText?: (filePath: string) => Promise<{ text: string; warnings: string[] }>;
    pickDocumentImportSources?: () => Promise<
      | {
          format: 'txt' | 'md' | 'rtf' | 'docx' | 'odt' | 'xml';
          relativePath: string;
          sourcePath: string;
        }[]
      | null
    >;
    statFile?: (filePath: string) => Promise<{ mtimeMs: number }>;
    ignoreFileChange?: (filePath: string, mtimeMs: number) => Promise<void>;
    /** Entity database folder (holds entities.xml and authority-packs/). */
    getEntityDbFolder?: () => Promise<string | null>;
    setEntityDbFolder?: (folder: string | null) => Promise<void>;
    pickEntityDbFolder?: () => Promise<string | null>;
    moveEntityDbFolder?: () => Promise<{
      ok: boolean;
      cancelled?: boolean;
      error?: string;
      folder?: string;
    }>;
    pickAuthorityPacksSource?: () => Promise<string | null>;
    /** Local PMTiles regional basemaps for the place-name geo-comparison map (see mapView/PlaceComparisonMap.tsx, mapView/regionalBundles.ts). */
    mapTilesStatus?: () => Promise<{
      installed: boolean;
      path: string | null;
      regions: {
        id: string;
        sha256: string;
        installedAt: string;
        /** Highest zoom present in the installed .pmtiles (from the archive header). */
        maxZoom?: number;
        minZoom?: number;
      }[];
    }>;
    mapTilesPromptDownload?: () => Promise<'accepted' | 'declined'>;
    mapTilesDownloadBackground?: (bundle: {
      id: string;
      source?: string;
      url: string;
      bbox?: [number, number, number, number];
      fileName: string;
      bytes?: number;
      sha256?: string;
    }) => Promise<{ ok: boolean; queued?: boolean; error?: string }>;
    mapTilesDownload?: (bundle: {
      id: string;
      source?: string;
      url: string;
      bbox?: [number, number, number, number];
      fileName: string;
      bytes?: number;
      sha256?: string;
    }) => Promise<{ ok: boolean; path?: string; error?: string }>;
    mapTilesRemove?: (bundleId: string) => Promise<{ ok: boolean; error?: string }>;
    mapTilesDownloadStatus?: () => Promise<{
      active: {
        bundleId: string;
        message: string;
        receivedBytes?: number;
        totalBytes?: number | null;
      }[];
    }>;
    onMapTilesProgress?: (
      callback: (progress: {
        bundleId: string;
        message: string;
        receivedBytes?: number;
        totalBytes?: number | null;
      }) => void,
    ) => () => void;
    onMapTilesDownloadComplete?: (
      callback: (result: {
        bundleId: string;
        installed: boolean;
        path?: string;
        error?: string;
      }) => void,
    ) => () => void;
    authorityPackStatuses?: () => Promise<import('../autoTagging/packPaths').AuthorityPackStatus[]>;
    authorityPackRead?: (
      packId: import('../autoTagging/packPaths').AuthorityPackId,
      dateFilter?: import('../autoTagging/packPaths').AuthorityPackDateFilter,
    ) => Promise<string[]>;
    authorityPackLookupByIds?: (
      packId: import('../autoTagging/packPaths').AuthorityPackId,
      authorityIds: string[],
    ) => Promise<string[]>;
    authorityPackInstallFrom?: (
      sourcePacksRoot: string,
    ) => Promise<{ ok: boolean; copied?: string[]; error?: string }>;
    pluginsGetSnapshot?: () => Promise<import('../plugins/types').PluginHostSnapshotView>;
    pluginsSetEnabled?: (
      pluginId: string,
      enabled: boolean,
    ) => Promise<import('../plugins/types').PluginHostSnapshotView>;
    pluginsInstallFrom?: (
      sourceDir: string,
    ) => Promise<import('../plugins/types').PluginHostSnapshotView>;
    pluginsPickInstallFolder?: () => Promise<string | null>;
    pluginsDismissLanguagePrompt?: (pluginId: string) => Promise<void>;
    pluginsIsEnabled?: (pluginId: string) => Promise<boolean>;
    pluginsGetModuleUrl?: (pluginId: string) => Promise<string | null>;
    pluginsGetRemoteIndex?: () => Promise<
      import('../../../../apps/commons/src/desktop/pluginRegistryTypes').PluginReleaseIndex
    >;
    pluginsInstallRemote?: (
      entry: import('../../../../apps/commons/src/desktop/pluginRegistryTypes').PluginReleaseEntry,
    ) => Promise<import('../plugins/types').PluginHostSnapshotView>;
    listProjectXmlFiles?: (
      rootPath: string,
    ) => Promise<import('../../../../apps/desktop/src/preload').NamedPath[]>;
    getEncoderName?: () => Promise<string>;
    createEntityDatabase?: (folder: string, content: string) => Promise<void>;
    createDirectory?: (parentDir: string, folderName: string) => Promise<string>;
    nativeDialogInvoke?: (payload: {
      dialogId: string;
      method: string;
      args?: unknown;
    }) => Promise<unknown>;
    onNativeDialogClosed?: (callback: (id: string) => void) => () => void;
  }

  type WorkspaceCursorPosition =
    | { mode: 'source'; offset: number }
    | { mode: 'visual'; offsetInElementText: number; teiXPath: string };

  interface DesktopTaggingBridge {
    changeTag?: (tagId: string, newTagName: string) => void;
    handleEditorKeyDown: (event: KeyboardEvent) => boolean;
    /** True while tag/attribute popup is open — editor must not accept IME/typing. */
    isPopupOpen?: () => boolean;
    openAttributePopup?: (anchorOverride: { left: number; top: number }) => Promise<boolean>;
    openTagPopup?: (
      mode: string,
      anchorOverride: { left: number; top: number },
    ) => Promise<boolean>;
  }

  interface Window {
    electronAPI?: LeafWriterElectronApi;
    __desktopLeftPanel?: DesktopLeftPanelBridge;
    __desktopMergeEditorBodyWithStoredHeader?: (editorXml: string, storedXml?: string) => string;
    __desktopMergeHeaderForValidation?: (editorXml: string) => string;
    __desktopRightPanel?: DesktopRightPanelBridge;
    __desktopRightPanelPendingTab?: DesktopRightPanelTab;
    __desktopStoredDocumentXml?: string;
    __desktopStripTeiHeaderForVisualEditor?: (xml: string) => string;
    __desktopTagging?: DesktopTaggingBridge;
    __desktopCorrection?: {
      openCorrectionPopup: () => boolean;
    };
    __desktopValidatorInstrumentation?: DesktopValidatorInstrumentation;
    /** DevTools helper: `await __ljbDebugValidator()` */
    __ljbDebugValidator?: (options?: { runValidation?: boolean }) => Promise<unknown>;
    /** Registered by the project-settings form while it has unsaved edits. */
    __ljbConfirmDiscardProjectSettings?: () => boolean;
    __leafWriterEditorZoom?: {
      zoomIn: () => void;
      zoomOut: () => void;
      reset: () => void;
      get: () => number;
    };
    __leafWriterSourceZoom?: {
      zoomIn: () => void;
      zoomOut: () => void;
      reset: () => void;
      get: () => number;
    };
    __leafWriterTranslationZoom?: {
      zoomIn: () => void;
      zoomOut: () => void;
      reset: () => void;
      get: () => number;
    };
    __leafWriterCursorSession?: {
      capture: () => WorkspaceCursorPosition | null;
      restore: (position: WorkspaceCursorPosition) => Promise<boolean>;
    };
    __leafWriterTranslationPane?: {
      filePath: string | null;
      isActive: () => boolean;
      redo: () => Promise<boolean>;
      replaceContent: (filePath: string, content: string) => boolean;
      undo: () => Promise<boolean>;
    };
    __leafWriterProject?: {
      getProjectFilePath: () => string;
      getProjectSourceLanguage?: () => Promise<string | null>;
      /** Signed year (negative = BCE) from the active file's profileDesc/creation/date, or null if unset/no file. */
      getActiveFileWorkYear?: () => number | null;
      /** Every open editor tab, for `openTabs`-scoped tag bomb runs. */
      getOpenTabs?: () => { filePath: string; content: string }[];
      getActiveFileXml?: () => string;
      getActiveFilePath?: () => string | null;
      /** Re-read `filePath` from disk into its open tab, if any, after a direct (skip-review) write. */
      reloadFileFromDisk?: (filePath: string) => Promise<void>;
      /** Open (or switch to) `filePath` as the active editor tab. */
      openFile?: (filePath: string) => Promise<void>;
      getProjectRootPath?: () => string;
      getProjectConfig?: () =>
        import('../../../../apps/commons/src/desktop/projectTypes').ProjectFileConfig | undefined;
      isProjectReady?: () => boolean;
      refreshExplorer?: () => Promise<void>;
      /** Guardrail hook: snapshot the project before a multi-document automated edit (tag bomb, purge, propagate). */
      createTimeMachineSnapshot?: (label?: string) => Promise<{ ok: boolean; path?: string }>;
      getAutoTaggingAuthoritySettings: () =>
        | {
            packs?: string[];
            showPackStringCounts?: boolean;
            matchAcrossLineBreaks?: boolean;
            dateFilter?: 'none' | 'limit' | 'exclude';
            yearStart?: number;
            yearEnd?: number;
            excludedNameTypes?: string[];
            nameTypeTaggingPolicy?: Record<string, 'phase1' | 'phase2' | 'never'>;
            customNameTypes?: Array<{
              id: string;
              label: string;
              labelsByLang?: Record<string, string>;
              bucket: 'phase1' | 'phase2' | 'never';
            }>;
            customThingTypes?: Array<{ id: string; label: string }>;
            artMinCodePoints?: number;
            yearFilterEnabled?: boolean;
            hideUndated?: boolean;
          }
        | undefined;
      setAutoTaggingAuthoritySettings: (settings: {
        packs?: string[];
        showPackStringCounts?: boolean;
        matchAcrossLineBreaks?: boolean;
        dateFilter?: 'none' | 'limit' | 'exclude';
        yearStart?: number;
        yearEnd?: number;
        excludedNameTypes?: string[];
        nameTypeTaggingPolicy?: Record<string, 'phase1' | 'phase2' | 'never'>;
        customNameTypes?: Array<{
          id: string;
          label: string;
          labelsByLang?: Record<string, string>;
          bucket: 'phase1' | 'phase2' | 'never';
        }>;
        customThingTypes?: Array<{ id: string; label: string }>;
        artMinCodePoints?: number;
        yearFilterEnabled?: boolean;
        hideUndated?: boolean;
      }) => void;
      getAutoTaggingValidationSettings: () =>
        | {
            aiValidation?: boolean;
            autoAcceptThreshold?: number;
            curateRejectBelow?: number;
          }
        | undefined;
      setAutoTaggingValidationSettings: (settings: {
        aiValidation?: boolean;
        autoAcceptThreshold?: number;
        curateRejectBelow?: number;
      }) => void;
      getDisambiguationSettings: () =>
        | {
            aiCuration?: boolean;
            disableCaching?: boolean;
            dateFilter?: 'none' | 'limit' | 'exclude';
            yearStart?: number;
            yearEnd?: number;
            placeProximityKm?: number;
          }
        | undefined;
      setDisambiguationSettings: (settings: {
        aiCuration?: boolean;
        disableCaching?: boolean;
        dateFilter?: 'none' | 'limit' | 'exclude';
        yearStart?: number;
        yearEnd?: number;
        placeProximityKm?: number;
      }) => void;
      applyProjectConfigBundle?: (
        bundle: import('../../../../apps/commons/src/desktop/projectTypes').ProjectBundle,
      ) => void;
      loadProjectMetadataState?: (
        mode?: 'firstSetup' | 'edition',
      ) => Promise<
        | import('../../../../apps/commons/src/desktop/projectMetadataDialogTypes').ProjectMetadataDialogState
        | null
      >;
      saveProjectMetadata?: (payload: {
        projectFilePath: string;
        values: Record<string, string>;
        custom: Array<{ path: string; label: string; value: string }>;
        applyToDocuments: boolean;
        translationAlignmentUnit?: 'div' | 'p' | 'ab';
        translationLanguages?: Array<{ code: string; label: string }>;
        syncToCentral?: boolean;
        mode?: 'firstSetup' | 'edition';
      }) => Promise<{
        ok: boolean;
        error?: string;
        summary?: string;
        syncReport?: { broken: number; conflicts: number };
      }>;
      getNameTypeTaggingPolicyState?: () => Promise<{
        buckets: Record<string, 'phase1' | 'phase2' | 'never'>;
        customTypes: Array<{ id: string; label: string; bucket: 'phase1' | 'phase2' | 'never' }>;
        artMinCodePoints: number;
        sourceLanguage: string | null;
      } | null>;
      persistNameTypeTaggingPolicy?: (payload: {
        buckets: Record<string, 'phase1' | 'phase2' | 'never'>;
        customTypes?: Array<{
          id: string;
          label: string;
          labelsByLang?: Record<string, string>;
          bucket: 'phase1' | 'phase2' | 'never';
        }>;
        artMinCodePoints?: number;
      }) => Promise<{ ok: boolean; error?: string }>;
    };
    __lwPanelTrace?: { t: string; tag: string; data?: Record<string, unknown> }[];
  }
}
