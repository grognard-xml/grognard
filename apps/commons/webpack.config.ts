import rehypeExtractToc from '@stefanprobst/rehype-extract-toc';
import rehypeExtractTocExport from '@stefanprobst/rehype-extract-toc/mdx';
import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import { EsbuildPlugin } from 'esbuild-loader';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import MonacoWebpackPlugin from 'monaco-editor-webpack-plugin';
import path from 'path';
import rehypeSlug from 'rehype-slug';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import webpack from 'webpack';
import WebpackBar from 'webpackbar';

const isDev = process.env.NODE_ENV === 'development';

const relPathToPackages = path.resolve(__dirname, '..', '..', 'packages');
const storageServiceSrc = path.join(relPathToPackages, 'cwrc-leafwriter-storage-service', 'src');

const entry: webpack.EntryObject = {
  app: [path.resolve(__dirname, 'src', 'index.tsx')],
};

const output = {
  path: path.resolve(__dirname, 'public'),
  filename: 'js/[name].js',
  publicPath: '/',
  pathinfo: isDev ? true : false,
};

const plugins = [
  new CleanWebpackPlugin({ cleanStaleWebpackAssets: false }),
  new CopyWebpackPlugin({
    patterns: [
      { from: path.resolve(__dirname, 'src', 'assets'), to: 'assets' },
      { from: path.resolve(__dirname, 'src', 'content'), to: 'content' },
      { from: 'src/silent-check-sso.html', to: '[name][ext]' },
      { from: 'src/manifest.json', to: '[name][ext]' },
      {
        //copy images from LEAF-Writer
        from: path.join(relPathToPackages, 'cwrc-leafwriter', 'src', 'images'),
        to: 'images',
      },
      {
        context: path.join(relPathToPackages, 'cwrc-leafwriter', 'src'),
        from: 'css/tinymce/skins',
        to: 'css/tinymce/skins',
      },
      {
        //Copy pre-compiled CSS to stylize the editor (must be recompiled after each change)
        from: path.join(relPathToPackages, 'cwrc-leafwriter', 'src', 'css', 'build', 'editor.css'),
        to: 'css/[name][ext]',
      },
      {
        //Copy pre-compiled worker
        from: path.join(
          relPathToPackages,
          'cwrc-leafwriter-validator',
          'dist',
          'leafwriter-validator.worker.js',
        ),
      },
      {
        // maplibre-gl loads its worker at runtime via a URL it derives from
        // import.meta.url — webpack bundles that expression down to
        // document.baseURI, so the worker script must be served as a static
        // file at the app root (see PlaceComparisonMap.tsx's map) or the
        // request falls through to the SPA's HTML fallback and the map never
        // initializes ("Failed to load module script ... text/html"). The
        // worker itself statically imports maplibre-gl-shared.mjs by a
        // root-relative path, so that must be served alongside it.
        from: require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs'),
      },
      {
        from: require.resolve('maplibre-gl/dist/maplibre-gl-shared.mjs'),
      },
      {
        // Pre-rendered SDF glyph PBFs for the place-comparison map's labeled
        // basemap (city/province/place names, not just geometry) — see
        // scripts/download-glyphs.mjs (run via predev/prebuild) and
        // PlaceComparisonMap.tsx's vectorStyle `glyphs` URL, which points at
        // `/fonts/{fontstack}/{range}.pbf` to match this `to`.
        from: path.resolve(__dirname, 'resources', 'fonts'),
        to: 'fonts',
        noErrorOnMissing: true,
      },
    ],
  }),
  new HtmlWebpackPlugin({
    template: path.resolve(__dirname, 'src', 'index.html'),
    favicon: path.resolve(__dirname, 'src', 'assets', 'logo', 'favicon.svg'),
  }),
  new MiniCssExtractPlugin({ filename: 'css/[name].css' }),
  // Editor features and XML support are imported by the lazy editor roots. Keeping
  // them out of this plugin avoids its include-loader pinning Monaco to app.js.
  new MonacoWebpackPlugin({
    filename: 'monaco-[name].[ext].js',
    // The plugin treats [] as "all defaults"; an unmatched id resolves to none.
    features: ['leafwriter-lazy-features' as never],
    languages: ['leafwriter-lazy-languages' as never],
  }),
  new WebpackBar({ color: isDev ? '#7e57c2' : '#9ccc65' }),
  new webpack.DefinePlugin({
    webpackEnv: {
      NODE_ENV: JSON.stringify(process.env.NODE_ENV),
      WORKER_ENV: JSON.stringify(process.env.WORKER_ENV),
    },
  }),
  new webpack.ProvidePlugin({ process: 'process/browser' }),
];

const webpackConfig: webpack.Configuration = {
  entry,
  output,
  plugins,
  cache: isDev ? true : false,
  devtool: isDev ? 'inline-source-map' : 'source-map', // inline-source-map //'eval-source-map' (might be faster for dev),
  mode: isDev ? 'development' : 'production',
  performance: { hints: isDev ? false : 'warning' },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        loader: 'esbuild-loader',
        options: { target: 'es2020' },
      },
      {
        test: /\.(le|c)ss$/,
        use: [
          { loader: MiniCssExtractPlugin.loader, options: { publicPath: '../' } },
          { loader: 'css-loader' },
          {
            loader: 'less-loader',
            options: {
              lessOptions: {
                relativeUrls: 'local',
                globalVars: { parentId: '#leaf-writer-container' },
              },
            },
          },
        ],
      },
      {
        test: /\.mdx?$/,
        use: [
          {
            loader: '@mdx-js/loader',
            /** @type {Options} */
            options: {
              /* jsxImportSource: …, otherOptions… */
              providerImportSource: '@mdx-js/react',
              remarkPlugins: [
                remarkFrontmatter, // Parses frontmatter blocks
                remarkMdxFrontmatter, // Exports frontmatter as named export
              ],
              rehypePlugins: [
                rehypeSlug, // Generates IDs for headings
                rehypeExtractToc, // Extracts ToC data
                rehypeExtractTocExport,
              ],
            },
          },
        ],
      },
      {
        test: /\.(woff(2)?|ttf|eot)(\?v=\d+\.\d+\.\d+)?$/,
        type: 'asset',
        generator: { filename: 'fonts/[name][ext][query]' },
      },
      {
        test: /\.(png|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
        generator: { filename: 'images/[name][ext][query]' },
      },
      {
        test: /\.svg$/,
        loader: 'svg-inline-loader',
        generator: { filename: 'images/[name][ext][query]' },
        options: { removeSVGTagAttrs: false },
      },
      {
        // Auto-tagging LLM prompt templates (imported from cwrc-leafwriter source).
        test: /\.txt$/,
        type: 'asset/source',
        include: path.join(
          relPathToPackages,
          'cwrc-leafwriter',
          'src',
          'autoTagging',
          'prompt-templates',
        ),
      },
      {
        // Bundled CSL citation styles and locales, imported as raw strings.
        test: /\.(csl|xml)$/,
        include: path.resolve(__dirname, 'src', 'desktop', 'citations', 'styles'),
        type: 'asset/source',
      },
    ],
  },
  optimization: {
    emitOnErrors: isDev ? true : false,
    minimize: isDev ? false : true,
    minimizer: isDev ? [] : [new EsbuildPlugin({ css: true })],
    sideEffects: isDev ? false : true,
    splitChunks: {
      cacheGroups: {
        monaco: {
          test: /[\\/]node_modules[\\/]monaco-editor[\\/]/,
          name: 'leafwriter-monaco-vendor',
          chunks: 'async',
          enforce: true,
          reuseExistingChunk: true,
        },
      },
    },
    usedExports: isDev ? false : true,
  },
  resolve: {
    alias: {
      '@src': path.resolve(__dirname, 'src/'),
      // Exact-match alias so light windows (native dialogs) can use the shared
      // language-code list without pulling in the whole editor bundle.
      '@cwrc/leafwriter/languageCodes$': path.resolve(
        relPathToPackages,
        'cwrc-leafwriter',
        'src',
        'utilities',
        'languageCodes.ts',
      ),
      // Exact-match alias so document export (menu action, no editor UI) can use the
      // pure conversion builders without pulling in the whole editor bundle.
      '@cwrc/leafwriter/documentExport$': path.resolve(
        relPathToPackages,
        'cwrc-leafwriter',
        'src',
        'js',
        'conversion',
        'documentExport.ts',
      ),
      // Exact-match alias so document import (file-level, no editor UI) can use the
      // shared page-break detector without pulling in the whole editor bundle.
      '@cwrc/leafwriter/pageBreakDetection$': path.resolve(
        relPathToPackages,
        'cwrc-leafwriter',
        'src',
        'utilities',
        'pageBreakDetection.ts',
      ),
      // Inline-image (gaiji) conversion for document import - same reason.
      '@cwrc/leafwriter/gaijiImport$': path.resolve(
        relPathToPackages,
        'cwrc-leafwriter',
        'src',
        'utilities',
        'gaijiImport.ts',
      ),
      // Save-time pruning of unused glyph declarations - same reason.
      '@cwrc/leafwriter/glyphCharDecl$': path.resolve(
        relPathToPackages,
        'cwrc-leafwriter',
        'src',
        'utilities',
        'glyphCharDecl.ts',
      ),
      // Same treatment: the source-mode heuristic is needed by file-level document
      // loading, which must not pull in the editor bundle.
      '@cwrc/leafwriter/teiMilestoneHeuristics$': path.resolve(
        relPathToPackages,
        'cwrc-leafwriter',
        'src',
        'utilities',
        'teiMilestoneHeuristics.ts',
      ),
      '@cwrc/leafwriter': path.resolve(relPathToPackages, 'cwrc-leafwriter', 'src', 'index.tsx'),
      '@cwrc/leafwriter-storage-service$': path.join(storageServiceSrc, 'index.tsx'),
      '@cwrc/leafwriter-storage-service/components$': path.join(
        storageServiceSrc,
        'components',
        'index.ts',
      ),
      '@cwrc/leafwriter-storage-service/db$': path.join(storageServiceSrc, 'db', 'index.ts'),
      '@cwrc/leafwriter-storage-service/dialog$': path.join(storageServiceSrc, 'StorageDialog.tsx'),
      '@cwrc/leafwriter-storage-service/dialogs$': path.join(
        storageServiceSrc,
        'dialogs',
        'index.ts',
      ),
      '@cwrc/leafwriter-storage-service/headless$': path.join(storageServiceSrc, 'headless.ts'),
      '@cwrc/leafwriter-storage-service/i18n$': path.join(storageServiceSrc, 'i18n.ts'),
      '@cwrc/leafwriter-storage-service/icons$': path.join(storageServiceSrc, 'icons', 'index.tsx'),
      '@cwrc/leafwriter-storage-service/overmind$': path.join(
        storageServiceSrc,
        'overmind',
        'index.ts',
      ),
      '@cwrc/leafwriter-storage-service/types$': path.join(storageServiceSrc, 'types', 'index.ts'),
      '@cwrc/leafwriter-storage-service/utilities$': path.join(
        storageServiceSrc,
        'utilities',
        'index.ts',
      ),
    },
    extensions: ['.tsx', '.ts', '.js', '.json'],
    fallback: {
      buffer: false,
      events: false,
      fs: false,
      path: false,
      process: false,
      querystring: false,
      string_decoder: false,
      stream: false,
      url: false,
    },
  },
  stats: isDev ? { children: true } : {},
  // MapLibre's ESM bundle contains one internal dynamic dependency expression
  // that webpack cannot statically analyze. It is a known vendor false
  // positive, so we silence only that exact warning instead of relaxing all
  // warnings globally.
  ignoreWarnings: [
    (warning: any) => {
      const message = typeof warning.message === 'string' ? warning.message : '';
      const resource = warning.module?.resource ?? '';
      return (
        message.includes('Critical dependency: the request of a dependency is an expression') &&
        resource.includes('node_modules/maplibre-gl/dist/maplibre-gl.mjs')
      );
    },
  ],
  watch: isDev ? true : false,
  watchOptions: isDev
    ? {
        // Polling avoids EMFILE on large workspaces where native watchers can
        // exhaust the per-process file descriptor limit during dev rebuilds.
        ignored: /(^|[\\/])(\.git|node_modules|dist)([\\/]|$)/,
        poll: 1000,
      }
    : undefined,
};

webpackConfig.resolve?.fallback;

export default webpackConfig;
