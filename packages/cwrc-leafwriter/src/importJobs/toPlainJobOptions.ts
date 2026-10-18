import type { ImportJobOptions } from '../../../../apps/commons/src/desktop/importJobTypes';

/**
 * A copy of the job options made only of plain data, safe to send to the main process.
 *
 * Options are sent over Electron IPC, which structured-clones them, and that throws "An object
 * could not be cloned" for a function, a Proxy or a class instance. The project configuration
 * comes from the live editor state and can hold such things, so everything goes through JSON:
 * what the main process uses (names, paths, the schema, the texts) is all plain data.
 */
export const toPlainJobOptions = <T extends ImportJobOptions>(options: T): T => {
  try {
    return JSON.parse(JSON.stringify(options)) as T;
  } catch (error) {
    throw new Error(
      `The import settings could not be prepared: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
};
