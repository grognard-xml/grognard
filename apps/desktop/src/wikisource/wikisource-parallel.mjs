/**
 * Fetch Wikisource catalogs and parallel text via the MediaWiki API.
 * Shared by Kanripo parallel punctuation and built-in Wikisource import.
 */

export const FETCH_HEADERS = {
  'User-Agent': 'Grognard/0.1 (+https://github.com/grognard-xml/grognard)',
};

const WIKISOURCE_HOST_RE = /^(?:[a-z-]+\.)?wikisource\.org$/i;
const VOLUME_SUFFIX_RE = /\/卷(\d+)(?:[上中下])?$/;
const CHAPTER_SKIP_RE = /(?:^|\/)(?:全覽|序言?|Author:|作者:)$/;
const FETCH_DELAY_MS = 300;

const BLOCKED_TITLE_PREFIXES = [
  'Talk:',
  'User:',
  'User talk:',
  'Wikisource:',
  'Wikisource talk:',
  'File:',
  'File talk:',
  'MediaWiki:',
  'Template:',
  'Help:',
  'Category:',
  'Portal:',
  'Author:',
  'Index:',
  'Page:',
  'Module:',
  'Draft:',
  '討論:',
  '使用者:',
  '用戶:',
  '維基文庫:',
  '檔案:',
  '模板:',
  '說明:',
  '分類:',
  '作者:',
];

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const getFetchDelayMs = () => FETCH_DELAY_MS;

/**
 * True when `text` is running prose/verse (enough Han with sentence-ending
 * punctuation, whether set as paragraphs or one short verse line per line),
 * not a list of chapter/poem titles.
 */
export function hasRunningText(text) {
  const body = String(text || '');
  const han = (body.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const stops = (body.match(/[。！？]/g) ?? []).length;
  return han >= 60 && stops >= 3 && han / stops <= 60;
}

/** True when the title is a subpage (卷, 篇, etc.), not a bare work index like ``後漢書``. */
export function isWikisourceSubPageTitle(title) {
  return String(title || '').includes('/');
}

export function shouldFetchSingleWikisourcePage(title, fetchAll) {
  if (fetchAll) return false;
  return VOLUME_SUFFIX_RE.test(title) || isWikisourceSubPageTitle(title);
}

export function parseWikisourceUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!WIKISOURCE_HOST_RE.test(parsed.hostname)) return null;
  const match =
    parsed.pathname.match(/^\/wiki\/(.+)$/) ||
    parsed.pathname.match(/^\/[a-z]{2,3}(?:-[a-zA-Z]+)?\/(.+)$/);
  if (!match) return null;
  try {
    const title = decodeURIComponent(match[1].replace(/_/g, ' '));
    return { apiHost: parsed.hostname, title, origin: parsed.origin };
  } catch {
    return null;
  }
}

export function isWikisourceHost(hostname) {
  return WIKISOURCE_HOST_RE.test(String(hostname || ''));
}

export function wikidataSiteCode(apiHost) {
  const host = String(apiHost || '').toLowerCase();
  const match = host.match(/^([a-z0-9-]+)\.wikisource\.org$/);
  if (!match) return null;
  return `${match[1].replace(/-/g, '_')}wikisource`;
}

export function wikisourceTitleToUrl(wiki, title) {
  return `${wiki.origin}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export function volumeNumberFromTitle(title) {
  const match = String(title || '').match(VOLUME_SUFFIX_RE);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function workTitleFromPageTitle(title) {
  const raw = String(title || '').trim();
  const volumeParent = raw.match(/^(.+)\/卷\d+(?:[上中下])?$/);
  if (volumeParent) {
    const parent = volumeParent[1];
    const named = parent.match(/^(.+?) \(/);
    return named ? named[1] : parent;
  }
  if (raw.includes('/')) return raw.split('/')[0];
  const named = raw.match(/^(.+?) \(/);
  return named ? named[1] : raw;
}

export function classifyWikisourceTitle(title) {
  const trimmed = String(title || '').trim();
  if (!trimmed) return { ok: false, reason: 'empty title' };
  const lowered = trimmed.toLowerCase();
  for (const prefix of BLOCKED_TITLE_PREFIXES) {
    if (trimmed.startsWith(prefix) || lowered.startsWith(prefix.toLowerCase())) {
      return { ok: false, reason: `“${trimmed}” is not a main-namespace work or chapter.` };
    }
  }
  return { ok: true, reason: null };
}

export function classifyWikisourcePage(page) {
  const title = String(page?.title || '').trim();
  const titleCheck = classifyWikisourceTitle(title);
  if (!titleCheck.ok) return titleCheck;
  if (page?.missing !== undefined) {
    return { ok: false, reason: `Wikisource page “${title}” does not exist.` };
  }
  const ns = page?.ns;
  if (typeof ns === 'number' && ns !== 0) {
    return { ok: false, reason: `“${title}” is not a main-namespace work or chapter.` };
  }
  return { ok: true, reason: null };
}

export function listChapterPages(linkTitles, workRoot) {
  const prefix = String(workRoot || '').trim();
  return linkTitles
    .filter((item) => {
      if (!item.startsWith(`${prefix}/`)) return false;
      if (VOLUME_SUFFIX_RE.test(item)) return false;
      const suffix = item.slice(prefix.length + 1);
      if (!suffix || suffix.includes('(')) return false;
      if (CHAPTER_SKIP_RE.test(item)) return false;
      return true;
    })
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

export function listVolumePages(linkTitles, editionRoot) {
  const prefix = String(editionRoot || '').trim();
  const volumes = linkTitles
    .filter((item) => item.startsWith(`${prefix}/卷`))
    .sort((a, b) => (volumeNumberFromTitle(a) || 0) - (volumeNumberFromTitle(b) || 0));
  if (volumes.length) return volumes;
  return listChapterPages(linkTitles, prefix);
}

export function namedEditionRoots(workTitle, linkTitles) {
  const prefix = String(workTitle || '').trim();
  const roots = new Set();
  for (const item of linkTitles) {
    const title = String(item || '').trim();
    if (!title.startsWith(`${prefix} (`) && !title.startsWith(`${prefix}(`)) continue;
    const root = title.includes('/') ? title.slice(0, title.lastIndexOf('/')) : title;
    if (root) roots.add(root);
  }
  return [...roots].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

/**
 * Detect edition trees without picking one. Used by Wikisource import.
 * Kanripo parallel still uses ``resolveEditionRoot`` (legacy auto-pick).
 */
export function listEditionTrees(workTitle, linkTitles) {
  const title = String(workTitle || '').trim();
  const titles = linkTitles.map((item) => String(item || '').trim()).filter(Boolean);
  const trees = [];

  const chapters = listChapterPages(titles, title);
  if (chapters.length) {
    trees.push({
      id: `chapters:${title}`,
      label: `${title} (${chapters.length} chapters)`,
      rootTitle: title,
      kind: 'chapters',
      pages: chapters,
      needsFetch: false,
    });
  }

  const directVolumes = titles
    .filter((item) => item.startsWith(`${title}/卷`))
    .sort((a, b) => (volumeNumberFromTitle(a) || 0) - (volumeNumberFromTitle(b) || 0));
  if (directVolumes.length) {
    trees.push({
      id: `volumes:${title}`,
      label: `${title} (${directVolumes.length} 卷)`,
      rootTitle: title,
      kind: 'volumes',
      pages: directVolumes,
      needsFetch: false,
    });
  }

  for (const editionTitle of namedEditionRoots(title, titles)) {
    const pages = listVolumePages(titles, editionTitle);
    trees.push({
      id: `edition:${editionTitle}`,
      label: pages.length ? `${editionTitle} (${pages.length} pages)` : editionTitle,
      rootTitle: editionTitle,
      kind: 'edition',
      pages,
      needsFetch: pages.length === 0,
    });
  }

  return trees;
}

export function resolveEditionRoot(pageTitle, linkTitles) {
  const title = String(pageTitle || '').trim();
  const titles = linkTitles.map((item) => String(item || '').trim()).filter(Boolean);

  const volumeParent = title.match(/^(.+)\/卷\d+(?:[上中下])?$/);
  if (volumeParent) return volumeParent[1];

  const directVolumes = listVolumePages(titles, title);
  if (directVolumes.length) return title;

  const chapters = listChapterPages(titles, title);
  if (chapters.length >= 2) return title;

  const editionCandidates = titles.filter(
    (item) => item.startsWith(`${title} (`) || item.startsWith(`${title}(`),
  );
  if (editionCandidates.length) {
    return (
      editionCandidates.find((item) => item.includes('四庫全書本')) ||
      editionCandidates.find((item) => item.includes('四部叢刊本')) ||
      editionCandidates[0]
    );
  }

  const prefixes = new Map();
  for (const item of titles) {
    const match = item.match(/^(.+)\/卷\d+$/);
    if (!match) continue;
    prefixes.set(match[1], (prefixes.get(match[1]) || 0) + 1);
  }
  if (prefixes.size) {
    return [...prefixes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  return title;
}

/**
 * Removes every `<div>` whose class list contains one of `classNames`,
 * balancing nested `<div>`s (a lazy regex stops at the first inner `</div>`).
 */
function stripDivsByClass(html, classNames) {
  const openRe = /<div\b[^>]*>/gi;
  const wanted = (tag) => {
    const m = tag.match(/\bclass="([^"]*)"/i);
    return Boolean(m) && m[1].split(/\s+/).some((c) => classNames.includes(c));
  };
  let out = '';
  let pos = 0;
  let match;
  while ((match = openRe.exec(html))) {
    if (match.index < pos || !wanted(match[0])) continue;
    const tagRe = /<(\/?)div\b[^>]*>/gi;
    tagRe.lastIndex = match.index;
    let depth = 0;
    let end = html.length;
    let t;
    while ((t = tagRe.exec(html))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index + t[0].length;
        break;
      }
    }
    out += html.slice(pos, match.index);
    pos = end;
    openRe.lastIndex = end;
  }
  return out + html.slice(pos);
}

export function htmlToParallelText(html) {
  // Licence banner / template boilerplate ("此…作品在全世界都属于公有领域…",
  // "Public domain", "false") is not part of the work; left in, it dilutes the
  // sticker and can make the aligner reject or mis-span a correct match.
  const withoutNoise = stripDivsByClass(html, ['licenseContainer', 'licensetpl'])
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<table\b[^>]*class="[^"]*\bmetadata\b[^"]*"[^>]*>[\s\S]*?<\/table>/gi, '')
    .replace(/<div\b[^>]*id="headerContainer"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div\b[^>]*id="footer"[^>]*>[\s\S]*?<\/div>/gi, '');

  const text = withoutNoise
    .replace(/<\/?(?:p|div|br|h[1-6]|li|tr|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_match, digits) => {
      const code = Number.parseInt(digits, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });

  return (
    text
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      // Editorial source note closing a reconstructed text, e.g.
      // "（《藝文類聚》九，又《書鈔》一百四十六引六條）": apparatus, not the work.
      .replace(/\n+[（(][^）)\n]*《[^》\n]*》[^）)\n]*[）)]$/, '')
  );
}

export async function mediaWikiGet(apiHost, params) {
  const apiUrl = `https://${apiHost}/w/api.php?${new URLSearchParams(params).toString()}`;
  const response = await fetch(apiUrl, { headers: FETCH_HEADERS });
  if (!response.ok) {
    throw new Error(`Wikisource API HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchPageLinks(apiHost, title) {
  const titles = [];
  let continueToken = null;

  do {
    const params = {
      action: 'query',
      titles: title,
      prop: 'links',
      pllimit: '500',
      format: 'json',
      redirects: '1',
    };
    if (continueToken) {
      params.plcontinue = continueToken;
    }
    const data = await mediaWikiGet(apiHost, params);
    const page = Object.values(data.query?.pages || {})[0];
    if (page?.missing !== undefined) {
      throw new Error(`Wikisource page “${title}” does not exist.`);
    }
    for (const link of page?.links || []) {
      if (link.ns === 0 && link.title) titles.push(link.title);
    }
    continueToken = data.continue?.plcontinue || null;
  } while (continueToken);

  return titles;
}

export async function fetchPageInfo(apiHost, title) {
  const data = await mediaWikiGet(apiHost, {
    action: 'query',
    titles: title,
    prop: 'info|pageprops',
    ppprop: 'wikibase_item',
    inprop: 'url',
    redirects: '1',
    format: 'json',
  });
  const page = Object.values(data.query?.pages || {})[0];
  const canonicalTitle = page?.title || title;
  return {
    page,
    canonicalTitle,
    ns: page?.ns,
    qid: page?.pageprops?.wikibase_item || null,
    missing: page?.missing !== undefined,
  };
}

async function fetchPageText(apiHost, title) {
  const data = await mediaWikiGet(apiHost, {
    action: 'parse',
    page: title,
    prop: 'text',
    format: 'json',
    disablelimitreport: '1',
    disableeditsection: '1',
  });
  if (data.error) {
    throw new Error(data.error.info || data.error.code || 'Wikisource API error.');
  }
  const html = data.parse?.text?.['*'] ?? '';
  const text = htmlToParallelText(html);
  if (!text.trim()) {
    throw new Error(`Wikisource page “${title}” returned no readable text.`);
  }
  return {
    text,
    pageTitle: data.parse?.title || title,
  };
}

export async function fetchPageWikitext(apiHost, title) {
  const data = await mediaWikiGet(apiHost, {
    action: 'query',
    titles: title,
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    redirects: '1',
    format: 'json',
  });
  if (data.error) {
    throw new Error(data.error.info || data.error.code || 'Wikisource API error.');
  }
  const page = Object.values(data.query?.pages || {})[0];
  if (page?.missing !== undefined) {
    throw new Error(`Wikisource page “${title}” does not exist.`);
  }
  const wikitext = page?.revisions?.[0]?.slots?.main?.['*'] ?? page?.revisions?.[0]?.['*'] ?? '';
  if (!String(wikitext).trim()) {
    throw new Error(`Wikisource page “${title}” returned no wikitext.`);
  }
  return {
    wikitext: String(wikitext),
    pageTitle: page?.title || title,
  };
}

export async function resolveWikisourceCatalog(url) {
  const parsed = parseWikisourceUrl(url);
  if (!parsed)
    throw new Error('Not a Wikisource URL (expected …wikisource.org/wiki/… or …/zh-hant/…).');

  let links = await fetchPageLinks(parsed.apiHost, parsed.title);
  let editionRoot = resolveEditionRoot(parsed.title, links);
  if (editionRoot !== parsed.title) {
    links = await fetchPageLinks(parsed.apiHost, editionRoot);
  }
  const volumes = listVolumePages(links, editionRoot);
  return {
    apiHost: parsed.apiHost,
    origin: parsed.origin,
    pageTitle: parsed.title,
    editionRoot,
    volumes,
  };
}

export function catalogToSections(catalog) {
  if (catalog.volumes.length) {
    return catalog.volumes.map((title) => ({
      id: title,
      slug: title,
      title: title.split('/').pop() || title,
      rowCount: 0,
    }));
  }
  return [
    {
      id: catalog.editionRoot,
      slug: catalog.editionRoot,
      title: catalog.editionRoot,
      rowCount: 0,
    },
  ];
}

export async function listWikisourceCatalog(url) {
  const catalog = await resolveWikisourceCatalog(url);
  return catalogToSections(catalog);
}

export async function fetchWikisourceParallel(url, options = {}) {
  const parsed = parseWikisourceUrl(url);
  if (!parsed)
    throw new Error('Not a Wikisource URL (expected …wikisource.org/wiki/… or …/zh-hant/…).');

  const fetchAll = Boolean(options.fetchAll);
  const catalog = await resolveWikisourceCatalog(url);
  const { editionRoot, volumes } = catalog;

  if (!volumes.length) {
    const single = await fetchPageText(parsed.apiHost, parsed.title);
    return {
      text: single.text,
      label: `Wikisource: ${single.pageTitle}`,
      kind: 'wikisource',
      url: url.trim(),
      pageTitle: single.pageTitle,
      sections: catalogToSections(catalog),
      chapters: [
        {
          id: parsed.title,
          title: parsed.title.split('/').pop() || parsed.title,
          text: single.text,
        },
      ],
    };
  }

  if (shouldFetchSingleWikisourcePage(parsed.title, fetchAll)) {
    const single = await fetchPageText(parsed.apiHost, parsed.title);
    return {
      text: single.text,
      label: `Wikisource: ${single.pageTitle}`,
      kind: 'wikisource',
      url: url.trim(),
      pageTitle: single.pageTitle,
      sections: catalogToSections(catalog),
      chapters: [
        {
          id: parsed.title,
          title: parsed.title.split('/').pop() || parsed.title,
          text: single.text,
        },
      ],
    };
  }

  if (!fetchAll) {
    // A page that itself carries running text (e.g. a poem that transcludes
    // its 昭明文選 卷 and so links to that 60-卷 edition) is a work, not an
    // index: an index page is just a list of short chapter titles.
    const own = await fetchPageText(parsed.apiHost, parsed.title).catch(() => null);
    if (own && hasRunningText(own.text)) {
      return {
        text: own.text,
        label: `Wikisource: ${own.pageTitle}`,
        kind: 'wikisource',
        url: url.trim(),
        pageTitle: own.pageTitle,
        sections: catalogToSections(catalog),
        chapters: [
          {
            id: parsed.title,
            title: parsed.title.split('/').pop() || parsed.title,
            text: own.text,
          },
        ],
      };
    }
    throw new Error(
      `This Wikisource URL is a work index (${volumes.length} 卷 under “${editionRoot}”). ` +
        'On import, Fetch URL loads the whole edition automatically. In the editor, open a single 卷 page instead.',
    );
  }

  const parts = [];
  const chapters = [];
  for (let index = 0; index < volumes.length; index += 1) {
    if (index > 0) await sleep(FETCH_DELAY_MS);
    const volumeTitle = volumes[index];
    const volume = await fetchPageText(parsed.apiHost, volumeTitle);
    parts.push(volume.text);
    chapters.push({
      id: volumeTitle,
      title: volumeTitle.split('/').pop() || volumeTitle,
      text: volume.text,
    });
  }

  return {
    text: parts.join('\n'),
    label: `Wikisource: ${editionRoot} (${volumes.length} 卷)`,
    kind: 'wikisource',
    url: url.trim(),
    pageTitle: editionRoot,
    sections: catalogToSections(catalog),
    chapters,
  };
}
