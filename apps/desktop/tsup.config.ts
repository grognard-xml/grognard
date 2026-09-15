import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'tsup';

const copyWikisourceRuntime = () => {
  const destDir = path.join('dist', 'wikisource');
  mkdirSync(destDir, { recursive: true });
  for (const name of [
    'wikisource-parallel.mjs',
    'wikidata.mjs',
    'wikitextToTei.mjs',
    'wikisourceImport.mjs',
  ]) {
    copyFileSync(path.join('src', 'wikisource', name), path.join(destDir, name));
  }
};

const copyBdrcRuntime = () => {
  const destDir = path.join('dist', 'bdrc');
  mkdirSync(destDir, { recursive: true });
  for (const name of [
    'bdrcImport.mjs',
    'pdiClient.mjs',
    'etextToTei.mjs',
    'bdrcRef.mjs',
    'bdrcCache.mjs',
  ]) {
    copyFileSync(path.join('src', 'bdrc', name), path.join(destDir, name));
  }
};

export default defineConfig({
  entry: ['src/main.ts', 'src/preload.ts', 'src/bulkBridgeWorker.ts', 'src/entityIndexWorker.ts'],
  format: ['cjs'],
  outDir: 'dist',
  clean: true,
  onSuccess: async () => {
    copyWikisourceRuntime();
    copyBdrcRuntime();
  },
  // Keep Node's built-in SQLite module as a built-in import. Without this,
  // esbuild rewrites `node:sqlite` to `sqlite`, which is not an installed
  // dependency and prevents the packaged main process from starting.
  //
  // `ws` (pulled in below via `@libsql/isomorphic-ws`) optionally speeds
  // itself up with `bufferutil`/`utf-8-validate` behind a `try { require(...)
  // }` — neither is an installed dependency here, so they must stay external
  // too, or esbuild fails to resolve them at bundle time. `ws` already falls
  // back to its pure-JS path when the `require` throws at runtime.
  external: ['electron', 'node:sqlite', 'bufferutil', 'utf-8-validate'],
  noExternal: [
    'mammoth',
    'jszip',
    '@xmldom/xmldom',
    'electron-updater',
    'pmtiles',
    // The `/web` (WebSocket/HTTPS-only, no native addon) build of the Turso
    // client — see tursoBackend.ts's doc comment for why not plain
    // `@libsql/client`. Bundled in full, like the app's other dependencies,
    // rather than shipped as a real node_modules package.
    '@libsql/client/web',
    '@libsql/core',
    '@libsql/hrana-client',
    '@libsql/isomorphic-ws',
    'js-base64',
    'promise-limit',
    'ws',
  ],
  splitting: false,
  sourcemap: true,
});
