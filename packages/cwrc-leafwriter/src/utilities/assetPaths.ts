export const joinPath = (...parts: string[]): string =>
  parts.filter(Boolean).join('/').replace(/\\/g, '/').replace(/\/+/g, '/');

export const parentDir = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const slash = Math.max(normalized.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return slash >= 0 ? filePath.slice(0, slash) : filePath;
};

/** A document-relative asset subdirectory (e.g. `_gaiji`, `_glyphs`), living next to the open XML file. */
export const assetDirForDocument = (documentPath: string, dirName: string): string =>
  joinPath(parentDir(documentPath), dirName);

export const relativeAssetUrl = (dirName: string, fileName: string): string =>
  `${dirName}/${fileName}`;
