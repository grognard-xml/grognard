import { isCorpusExcludedPath, isInfrastructureDirName } from '../infrastructurePaths';

export const collectXmlFiles = async (
  dirPath: string,
  projectRoot: string = dirPath,
): Promise<string[]> => {
  // Optional in the leafwriter package's view of electronAPI (it is only complete in commons).
  const readDirectory = window.electronAPI?.readDirectory;
  if (!readDirectory) return [];

  const entries = await readDirectory(dirPath, { allFiles: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) {
      if (isInfrastructureDirName(entry.name)) continue;
      files.push(...(await collectXmlFiles(entry.path, projectRoot)));
      continue;
    }
    if (
      entry.name.toLowerCase().endsWith('.xml') &&
      !isCorpusExcludedPath(entry.path, projectRoot)
    ) {
      files.push(entry.path);
    }
  }

  return files;
};
