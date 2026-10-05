/**
 * Unsaved documents live at `<os temp>/grognard/<Date.now()>/untitled.xml` (see
 * `createTempDocument` in the desktop main process). The test has to be that exact: matching any
 * directory named `grognard` also caught real projects inside a checkout or folder of that name,
 * which then asked "Save as" on every save and could have had their folder deleted as "temp".
 */
const TEMP_DOCUMENT_PATH = /[/\\]grognard[/\\]\d{10,}[/\\][^/\\]+$/;

export const isTempDocumentPath = (filePath: string): boolean => TEMP_DOCUMENT_PATH.test(filePath);
