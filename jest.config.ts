import type { Config } from '@jest/types';

const dexieModulePath = '<rootDir>/node_modules/dexie/dist/dexie.js';

const config: Config.InitialOptions = {
  // collectCoverage: true,
  // coverageProvider: 'v8',
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 55,
      lines: 70,
      statements: 70,
    },
  },
  workerThreads: true,
  // verbose: true,
  projects: [
    {
      displayName: { name: 'Validator', color: 'magenta' },
      automock: false,
      clearMocks: true,
      modulePathIgnorePatterns: ['<rootDir>/.claude/'],
      coveragePathIgnorePatterns: ['/node_modules/', '/dist', '/docs', '/lib', '/lib-esm', '/test'],
      moduleNameMapper: { '^dexie$': dexieModulePath },
      resetMocks: false,
      setupFiles: [
        'fake-indexeddb/auto',
        '<rootDir>/packages/cwrc-leafwriter-validator/test/setup/index.ts',
      ],
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/packages/cwrc-leafwriter-validator/**/?(*.)+(spec|test).[jt]s?(x)'],
      testPathIgnorePatterns: ['<rootDir>/packages/cwrc-leafwriter-validator/lib*'],
      preset: 'ts-jest',
    },
    {
      displayName: { name: 'Storage Dialog', color: 'cyanBright' },
      clearMocks: true,
      modulePathIgnorePatterns: ['<rootDir>/.claude/'],
      coveragePathIgnorePatterns: ['/node_modules/', '/dist', '/lib', 'lib-esm', '/test'],
      moduleNameMapper: {
        '^@cwrc/leafwriter-storage-service$':
          '<rootDir>/packages/cwrc-leafwriter-storage-service/src/index.tsx',
        '^@cwrc/leafwriter-storage-service/(.*)$':
          '<rootDir>/packages/cwrc-leafwriter-storage-service/src/$1',
        '^@octokit/rest$':
          '<rootDir>/packages/cwrc-leafwriter-storage-service/test/mocks/octokit.ts',
        '^dexie$': dexieModulePath,
        '^nanoid$': '<rootDir>/packages/cwrc-leafwriter-storage-service/test/mocks/nanoid.ts',
      },
      resetMocks: false,
      setupFiles: ['fake-indexeddb/auto'],
      setupFilesAfterEnv: [
        '<rootDir>/packages/cwrc-leafwriter-storage-service/test/setup/afterEnv.ts',
      ],
      testEnvironment: 'jsdom',
      testMatch: [
        '<rootDir>/packages/cwrc-leafwriter-storage-service/**/?(*.)+(spec|test).[jt]s?(x)',
      ],
      testPathIgnorePatterns: ['<rootDir>/packages/cwrc-leafwriter-storage-service/lib*'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'jsx', 'json', 'node'],
      preset: 'ts-jest',
    },
    {
      displayName: { name: 'Core', color: 'blue' },
      clearMocks: true,
      modulePathIgnorePatterns: ['<rootDir>/.claude/'],
      coveragePathIgnorePatterns: ['/node_modules/', '/dist', '/lib', 'lib-esm', '/test'],
      moduleNameMapper: {
        '\\.mdx$': '<rootDir>/packages/cwrc-leafwriter/test/mocks/mdx.tsx',
        '^dexie$': dexieModulePath,
        // Holds `import.meta`, which ts-jest cannot compile to CJS; see the stub.
        '.*/devWorkerUrl$': '<rootDir>/packages/cwrc-leafwriter/test/mocks/devWorkerUrl.ts',
        // ESM-only, so jest's CJS resolver cannot reach it; see the stub.
        '^maplibre-gl$': '<rootDir>/packages/cwrc-leafwriter/test/mocks/maplibreGl.ts',
        '\\.(png|jpe?g|gif|svg|webp)$': '<rootDir>/packages/cwrc-leafwriter/test/fileMock.cjs',
        '\\.(css|less)$': '<rootDir>/packages/cwrc-leafwriter/test/cssModuleMock.cjs',
      },
      resetMocks: false,
      setupFiles: [
        '<rootDir>/packages/cwrc-leafwriter/test/setup/structuredClone.ts',
        '<rootDir>/packages/cwrc-leafwriter/test/setup/textEncoder.ts',
        '<rootDir>/packages/cwrc-leafwriter/test/setup/fetch.ts',
        'fake-indexeddb/auto',
      ],
      setupFilesAfterEnv: ['<rootDir>/packages/cwrc-leafwriter/test/setup/jestAfterEnv.ts'],
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/packages/cwrc-leafwriter/**/?(*.)+(spec|test).[jt]s?(x)'],
      testPathIgnorePatterns: ['<rootDir>/packages/cwrc-leafwriter/lib*'],
      preset: 'ts-jest',
      // tibetan-ewts-converter ships ESM-only; let ts-jest compile it to CJS.
      // nanoid ships ESM only, so it must be transformed rather than skipped.
      transformIgnorePatterns: ['/node_modules/(?!(tibetan-ewts-converter|nanoid)/)'],
      transform: {
        '\\.txt$': '<rootDir>/packages/cwrc-leafwriter/test/loadTextFile.cjs',
        '\\.mjs$': ['ts-jest', { tsconfig: { allowJs: true } }],
        // Only reaches the packages transformIgnorePatterns lets through (both ESM-only).
        '\\.js$': ['ts-jest', { tsconfig: { allowJs: true } }],
        '^.+\\.tsx?$': 'ts-jest',
      },
    },
    {
      displayName: { name: 'desktop', color: 'green' },
      clearMocks: true,
      modulePathIgnorePatterns: ['<rootDir>/.claude/'],
      coveragePathIgnorePatterns: ['/node_modules/', '/dist', '/lib', 'lib-esm'],
      resetMocks: false,
      testEnvironment: 'node',
      testMatch: ['<rootDir>/apps/desktop/**/?(*.)+(spec|test).[jt]s?(x)'],
      preset: 'ts-jest',
    },
    {
      displayName: { name: 'commons', color: 'red' },
      clearMocks: true,
      modulePathIgnorePatterns: ['<rootDir>/.claude/'],
      coveragePathIgnorePatterns: ['/node_modules/', '/dist', '/lib', 'lib-esm', '/test'],
      moduleNameMapper: {
        // Ahead of the @src alias: mapping is first-match-wins, and MDX is imported
        // through that alias.
        '\\.mdx$': '<rootDir>/apps/commons/test/mocks/mdx.tsx',
        '^@src/(.*)$': '<rootDir>/apps/commons/src/$1',
        '^@cwrc/leafwriter/documentExport$':
          '<rootDir>/packages/cwrc-leafwriter/src/js/conversion/documentExport.ts',
        '^@cwrc/leafwriter/glyphCharDecl$':
          '<rootDir>/packages/cwrc-leafwriter/src/utilities/glyphCharDecl.ts',
        '^@cwrc/leafwriter/gaijiImport$':
          '<rootDir>/packages/cwrc-leafwriter/src/utilities/gaijiImport.ts',
        '^@cwrc/leafwriter/pageBreakDetection$':
          '<rootDir>/packages/cwrc-leafwriter/src/utilities/pageBreakDetection.ts',
        '^@cwrc/leafwriter/languageCodes$':
          '<rootDir>/packages/cwrc-leafwriter/src/utilities/languageCodes.ts',
        '^@cwrc/leafwriter/teiMilestoneHeuristics$':
          '<rootDir>/packages/cwrc-leafwriter/src/utilities/teiMilestoneHeuristics.ts',
        // The bare specifier resolves to the package's webpack bundle, which cannot
        // be evaluated under jsdom. See the stub for what it covers.
        '^@cwrc/leafwriter$': '<rootDir>/apps/commons/test/mocks/cwrcLeafwriter.tsx',
        // Same treatment the storage project gives itself: resolve to source.
        '^@cwrc/leafwriter-storage-service$':
          '<rootDir>/packages/cwrc-leafwriter-storage-service/src/index.tsx',
        '^@cwrc/leafwriter-storage-service/(.*)$':
          '<rootDir>/packages/cwrc-leafwriter-storage-service/src/$1',
        '^dexie$': dexieModulePath,
        // Holds `import.meta`, which ts-jest cannot compile to CJS; see the stub.
        '.*/devWorkerUrl$': '<rootDir>/packages/cwrc-leafwriter/test/mocks/devWorkerUrl.ts',
        // ESM-only, so jest's CJS resolver cannot reach it; see the stub.
        '^maplibre-gl$': '<rootDir>/packages/cwrc-leafwriter/test/mocks/maplibreGl.ts',
        '\\.(png|jpe?g|gif|svg|webp)$': '<rootDir>/packages/cwrc-leafwriter/test/fileMock.cjs',
        '\\.(css|less)$': '<rootDir>/packages/cwrc-leafwriter/test/cssModuleMock.cjs',
      },
      resetMocks: false,
      setupFiles: [
        'fake-indexeddb/auto',
        '<rootDir>/apps/commons/test/setup/index.ts',
        '<rootDir>/packages/cwrc-leafwriter/test/setup/textEncoder.ts',
      ],
      setupFilesAfterEnv: ['<rootDir>/packages/cwrc-leafwriter/test/setup/jestAfterEnv.ts'],
      testEnvironment:
        '<rootDir>/packages/cwrc-leafwriter-validator/test/setup/FixJSDOMEnvironment.ts',
      testMatch: ['<rootDir>/apps/commons/**/?(*.)+(spec|test).[jt]s?(x)'],
      preset: 'ts-jest',
      // tibetan-ewts-converter ships ESM-only; let ts-jest compile it to CJS.
      // nanoid ships ESM only, so it must be transformed rather than skipped.
      transformIgnorePatterns: [
        '/node_modules/(?!(tibetan-ewts-converter|nanoid|query-string|decode-uri-component|split-on-first|filter-obj)/)',
      ],
      transform: {
        '\\.mjs$': ['ts-jest', { tsconfig: { allowJs: true } }],
        // Bundled CSL citation styles and locales (webpack asset/source in the real build).
        '\\.(csl|xml)$': '<rootDir>/packages/cwrc-leafwriter/test/loadTextFile.cjs',
        // Only reaches the packages transformIgnorePatterns lets through (both ESM-only).
        '\\.js$': ['ts-jest', { tsconfig: { allowJs: true } }],
        '^.+\\.tsx?$': 'ts-jest',
      },
    },
  ],
};

export default config;
