const GROGNARD_PREFIX = 'grognard://';
// Keep in sync with apps/commons/src/desktop/localFileUrl.ts: the path must live in
// pathname segments, not the host, or Chromium's special-scheme host/IDNA parsing
// rejects the URL for any path containing "/" or " ".
const GROGNARD_HOST = 'local/';

export const isLocalFileUrl = (url: string): boolean => url.startsWith(GROGNARD_PREFIX);

const toLocalFileUrl = (absolutePath: string): string => {
  const segments = absolutePath.split(/[\\/]+/).filter(Boolean);
  return `${GROGNARD_PREFIX}${GROGNARD_HOST}${segments.map(encodeURIComponent).join('/')}`;
};

export { toLocalFileUrl };

export const fromLocalFileUrl = (url: string): string | null => {
  if (!isLocalFileUrl(url)) return null;
  try {
    const rest = url.slice(GROGNARD_PREFIX.length + GROGNARD_HOST.length);
    if (!rest) return null;
    const segments = rest.split('/').map(decodeURIComponent);
    const isWindowsDrive = /^[A-Za-z]:$/.test(segments[0]);
    return isWindowsDrive ? segments.join('\\') : `/${segments.join('/')}`;
  } catch {
    return null;
  }
};

const isUsableResourceUrl = (url: string): boolean => {
  if (!url) return false;
  if (isLocalFileUrl(url)) return fromLocalFileUrl(url) !== null;
  if (/^https?:\/\//i.test(url)) return true;
  if (url.startsWith('blob:')) return true;
  // Skip paths built by mistakenly treating grognard URLs as relative file paths.
  if (url.includes('grognard:')) return false;
  if (/%2F/i.test(url)) return false;
  return true;
};

/** Join a document-relative asset path to the open XML file and return an grognard:// URL. */
export const resolveDocumentAssetUrl = (
  url: string,
  documentFilePath: string | null | undefined,
): string => {
  if (!url) return url;
  if (isLocalFileUrl(url) || /^https?:\/\//i.test(url) || url.startsWith('blob:')) return url;
  if (!documentFilePath) return url;

  const normalizedDoc = documentFilePath.replace(/\\/g, '/');
  const slash = Math.max(normalizedDoc.lastIndexOf('/'), documentFilePath.lastIndexOf('\\'));
  const baseDir = slash >= 0 ? documentFilePath.slice(0, slash) : documentFilePath;
  const separator = baseDir.includes('\\') ? '\\' : '/';
  const relative = url.replace(/^[./\\]+/, '').replace(/\//g, separator);
  const absolute = `${baseDir}${separator}${relative}`;
  return toLocalFileUrl(absolute);
};

/**
 * Candidate URLs for a relative asset path: next to the open document first
 * (pasted/imported glyphs live in a `_glyphs/` beside their file), then
 * relative to the project root (composed glyphs live in the project-level
 * `<projectRoot>/_glyphs/`, which is not beside a document in a subfolder).
 */
export const documentAssetUrlCandidates = (
  url: string,
  documentFilePath: string | null | undefined,
): string[] => {
  const candidates = [resolveDocumentAssetUrl(url, documentFilePath)];
  const projectRoot =
    typeof window !== 'undefined' ? window.__leafWriterProject?.getProjectRootPath?.() : null;
  if (projectRoot && url && !isLocalFileUrl(url) && !/^(https?:|blob:)/i.test(url)) {
    const fromRoot = resolveDocumentAssetUrl(url, `${projectRoot.replace(/[\\/]+$/, '')}/_`);
    if (!candidates.includes(fromRoot)) candidates.push(fromRoot);
  }
  return candidates;
};

/** Fetches the first candidate from `documentAssetUrlCandidates` that loads. */
export const fetchDocumentAssetText = async (
  url: string,
  documentFilePath: string | null | undefined,
): Promise<string | null> => {
  for (const candidate of documentAssetUrlCandidates(url, documentFilePath)) {
    const text = await fetchResourceText(candidate);
    if (text) return text;
  }
  return null;
};

export const filterResourceUrls = (urls: string[]): string[] => {
  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const url of urls) {
    if (!isUsableResourceUrl(url)) continue;

    const key = fromLocalFileUrl(url) ?? url;
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(url);
  }

  return filtered;
};

const resolveIncludeUrl = (baseSchemaUrl: string, href: string): string => {
  const localBase = fromLocalFileUrl(baseSchemaUrl);
  if (localBase) {
    const includeFile = href.includes('/') ? (href.match(/(.*\/)(.*)/)?.[2] ?? href) : href;
    const separator = localBase.includes('\\') ? '\\' : '/';
    const dir = localBase.slice(
      0,
      Math.max(localBase.lastIndexOf('/'), localBase.lastIndexOf('\\')),
    );
    return toLocalFileUrl(`${dir}${separator}${includeFile}`);
  }

  if (/^https?:\/\//i.test(baseSchemaUrl)) {
    const schemaBase = baseSchemaUrl.match(/(.*\/)(.*)/)?.[1];
    const includeFile = href.includes('/') ? (href.match(/(.*\/)(.*)/)?.[2] ?? href) : href;
    return schemaBase ? schemaBase + includeFile : href;
  }

  return href;
};

const mergeRngIncludes = async (rngText: string, baseUrl: string): Promise<string> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rngText, 'application/xml');
  if (doc.querySelector('parsererror')) return rngText;

  const grammar = doc.querySelector('grammar');
  if (!grammar) return rngText;

  const includes = Array.from(grammar.children).filter(
    (el) => el.tagName.toLowerCase() === 'include',
  );

  for (const includeEl of includes) {
    const href = includeEl.getAttribute('href');
    if (!href) continue;

    const includeUrl = resolveIncludeUrl(baseUrl, href);
    const includeText = await fetchResourceText(includeUrl);
    if (!includeText) continue;

    const mergedIncludeText = await mergeRngIncludes(includeText, includeUrl);
    const includeDoc = parser.parseFromString(mergedIncludeText, 'application/xml');
    const includeGrammar = includeDoc.querySelector('grammar');
    if (!includeGrammar) continue;

    // RelaxNG override: <start>/<define> children of <include> replace the
    // matching entries in the included grammar BEFORE it's merged in. Without
    // this, an override define nested inside <include> is silently discarded
    // by includeEl.remove() below and the stock upstream define wins instead.
    for (const overrideChild of Array.from(includeEl.children)) {
      const tag = overrideChild.tagName.toLowerCase();
      if (tag === 'start') {
        const existingStart = Array.from(includeGrammar.children).find(
          (el) => el.tagName.toLowerCase() === 'start',
        );
        const imported = includeDoc.importNode(overrideChild, true);
        if (existingStart) existingStart.replaceWith(imported);
        else includeGrammar.appendChild(imported);
      } else if (tag === 'define') {
        const name = overrideChild.getAttribute('name');
        const existingDefine = name
          ? Array.from(includeGrammar.children).find(
              (el) => el.tagName.toLowerCase() === 'define' && el.getAttribute('name') === name,
            )
          : null;
        const imported = includeDoc.importNode(overrideChild, true);
        if (existingDefine) existingDefine.replaceWith(imported);
        else includeGrammar.appendChild(imported);
      }
    }

    for (const child of Array.from(includeGrammar.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'start') {
        const existing = Array.from(grammar.children).find(
          (el) => el.tagName.toLowerCase() === 'start',
        );
        if (existing) existing.replaceWith(child.cloneNode(true));
        else grammar.appendChild(child.cloneNode(true));
      } else if (tag === 'define') {
        const name = child.getAttribute('name');
        const existing = name
          ? Array.from(grammar.children).find(
              (el) => el.tagName.toLowerCase() === 'define' && el.getAttribute('name') === name,
            )
          : null;
        if (existing) existing.replaceWith(child.cloneNode(true));
        else grammar.appendChild(child.cloneNode(true));
      }
    }

    includeEl.remove();
  }

  return new XMLSerializer().serializeToString(doc);
};

const localSchemaBlobCache = new Map<string, { revision: string; url: string }>();

/** Drop cached blob URLs (e.g. after sanmiao merge or validator cache clear). */
export const clearLocalSchemaBlobCache = (): void => {
  for (const { url } of localSchemaBlobCache.values()) {
    URL.revokeObjectURL(url);
  }
  localSchemaBlobCache.clear();
};

/**
 * Read a desktop/local RNG and return a worker-safe blob URL.
 * Reuses the same blob URL while `revision` is unchanged so the validator
 * worker can skip recompiling a 1MB flat TEI grammar on every validate().
 */
export async function localSchemaToBlobUrl(
  schemaURL: string,
  revision?: string | null,
): Promise<string | null> {
  const localPath = fromLocalFileUrl(schemaURL);
  const cacheKey = localPath ?? schemaURL;
  const revisionKey = revision ?? '';

  const cached = localSchemaBlobCache.get(cacheKey);
  if (cached && cached.revision === revisionKey) {
    return cached.url;
  }

  const text = await fetchResourceText(schemaURL);
  if (!text) return null;
  // Project sanmiao schemas are pre-flattened at install time; skip runtime merge.
  const merged = /<include[\s>]/i.test(text) ? await mergeRngIncludes(text, schemaURL) : text;
  const blobUrl = URL.createObjectURL(new Blob([merged], { type: 'application/xml' }));

  if (cached?.url) {
    URL.revokeObjectURL(cached.url);
  }
  localSchemaBlobCache.set(cacheKey, { revision: revisionKey, url: blobUrl });

  return blobUrl;
}

/** Load text from a remote URL or a desktop grognard:// project file. */
export async function fetchResourceText(url: string): Promise<string | null> {
  const localPath = fromLocalFileUrl(url);
  if (localPath) {
    const electronAPI = (
      window as Window & { electronAPI?: { readFile: (path: string) => Promise<string> } }
    ).electronAPI;

    if (electronAPI?.readFile) {
      try {
        return await electronAPI.readFile(localPath);
      } catch {
        return null;
      }
    }
  }

  if (!/^https?:\/\//i.test(url) && !url.startsWith('blob:')) {
    return null;
  }

  const response = await fetch(url).catch(() => null);
  if (!response) return null;
  if (response.status !== 200) return null;

  try {
    const data = await response.text();
    return data || null;
  } catch {
    return null;
  }
}
