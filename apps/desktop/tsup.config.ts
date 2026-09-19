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
    'jimp',
    'potrace',
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
  // jimp ships both a real CJS build (`main`) and a separate ESM rewrite
  // (`module`) that re-exports the class under `.default` instead of being
  // the class itself. Esbuild's default resolution let `potrace`'s own
  // internal `require('jimp')` pick up the `module` build while our own
  // `import Jimp from 'jimp'` picked up `main` - two different runtime
  // values for "Jimp" in the same bundle, so potrace's internal
  // `instanceof Jimp` check crashed with "Right-hand side of 'instanceof'
  // is not callable" the moment vectorizeGlyphImage() ran. Preferring
  // `main` is also just correct here regardless of jimp specifically: this
  // bundle only ever runs in Node/Electron's main process, and a package's
  // `module` build assumes a browser bundler's semantics, not Node's.
  esbuildOptions(options) {
    options.mainFields = ['main', 'module'];
  },
});
