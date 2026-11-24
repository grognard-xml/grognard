import js from '@eslint/js';
import markdown from '@eslint/markdown';
import prettierConfig from 'eslint-config-prettier';
import prettier from 'eslint-plugin-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import yml from 'eslint-plugin-yml';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Generated, vendored or build output — never worth linting in any workspace. */
const defaultIgnores = [
  '**/coverage/**',
  '**/dist/**',
  '**/lib/**',
  '**/docs/**',
  '**/public/**',
  '**/apps/eslint-*/*.js',
  '**/packages/eslint-*/*.js',
  '**/changelog.config.js',
  '**/jest.config.ts',
  '**/webpack.config.ts',
  '**/*.d.ts',
  // Fenced code blocks extracted from markdown. The snippets in this repo's readmes
  // and changelogs are deliberately partial (bare object literals, type fragments),
  // so parsing them as standalone modules only ever produces false positives.
  // Drop this line to start linting documentation examples.
  '**/*.md/**',
];

/**
 * Shared flat config.
 *
 * @param {object} [options]
 * @param {string} [options.tsconfigRootDir] directory the `project` paths resolve against.
 *   Pass `import.meta.dirname` from the workspace's eslint.config.mjs.
 * @param {string[]} [options.project] tsconfig(s) backing the type-aware rules. Workspaces
 *   whose build tsconfig excludes tests should pass a lint-scoped one that includes them.
 * @param {string[]} [options.ignores] extra ignore patterns for this workspace.
 * @param {boolean} [options.legacyTyping] for code inherited from the original LEAF-Writer
 *   (largely untyped jQuery/TinyMCE glue): stop warning about explicit `any` and undescribed
 *   `@ts-expect-error`/`@ts-ignore` comments. New workspaces should leave this off.
 */
export default function custom({
  tsconfigRootDir,
  project = ['./tsconfig.json'],
  ignores = [],
  legacyTyping = false,
} = {}) {
  return tseslint.config(
    { ignores: [...defaultIgnores, ...ignores] },

    // Baseline for every file type. This is a browser app, so browser globals are
    // the default; the Node-side blocks below layer their own globals on top.
    js.configs.recommended,
    prettierConfig,
    {
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: { ...globals.browser, ...globals.es2025 },
      },
      rules: {
        // This codebase's convention for "intentionally unused" — a destructured
        // param kept for its position/documentation value, an unused catch binding —
        // is a leading underscore. Recognize it everywhere, not just in .ts/.tsx.
        'no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
      },
    },

    // Plain .js is CommonJS here — no package in the monorepo sets "type": "module".
    {
      files: ['**/*.js', '**/*.cjs'],
      languageOptions: { sourceType: 'commonjs', globals: globals.commonjs },
    },

    // ESM tooling scripts.
    {
      files: ['**/*.mjs'],
      languageOptions: { sourceType: 'module', globals: globals.node },
    },

    // Anything that runs in Node rather than the browser.
    {
      files: ['scripts/**/*.js', 'bin/**/*.js', '**/.jest-preset.js', '**/.env-cmdrc.js'],
      languageOptions: { globals: globals.node },
    },

    // TypeScript. The parser enables JSX for .tsx automatically.
    {
      files: ['**/*.ts', '**/*.tsx'],
      extends: [
        js.configs.recommended,
        //* For more relaxed TS rules, swap the next 2 lines for the 2 commented ones.
        tseslint.configs.recommended,
        tseslint.configs.stylistic,
        // tseslint.configs.recommendedTypeChecked,
        // tseslint.configs.stylisticTypeChecked,
        prettierConfig,
      ],
      languageOptions: {
        globals: { ...globals.node, ...globals.browser },
        parserOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
          project,
          tsconfigRootDir,
        },
      },
      plugins: { prettier },
      rules: {
        '@typescript-eslint/ban-ts-comment': 1,
        '@typescript-eslint/no-explicit-any': 1,
        '@typescript-eslint/require-await': 0,
        '@typescript-eslint/no-misused-promises': [2, { checksVoidReturn: false }],
        // See the matching no-unused-vars comment above — same underscore convention.
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        // Empty arrow functions are a normal no-op/placeholder pattern here — a lazily-assigned
        // useRef callback, a stub for an unavailable API, a deliberate null-object handler.
        '@typescript-eslint/no-empty-function': ['warn', { allow: ['arrowFunctions'] }],
        // `cb && cb(x)` and `cond ? doA() : doB()` as statements are a pervasive, deliberate
        // idiom in the inherited LEAF-Writer code (~60 sites). Allowing them keeps the part
        // of this rule that actually finds bugs: a bare expression statement with no call and
        // no side effect — `module.destroy`, `this.entry`, a getter body missing its `return` —
        // which is exactly the class that turned up real defects in the 2026-08 sweep.
        '@typescript-eslint/no-unused-expressions': [
          'error',
          { allowShortCircuit: true, allowTernary: true },
        ],
        // Consistently named (`_this`/`self`) pre-ES6 alias, still genuinely needed in jQuery
        // event handlers that use a plain `function` for its own `this` (the triggering DOM
        // element) while also needing the outer class instance — arrow functions can't do both.
        '@typescript-eslint/no-this-alias': ['error', { allowedNames: ['_this', 'self'] }],
      },
    },

    // React. Custom hooks live in plain .ts files here, so both extensions apply.
    // Only the two classic rules: eslint-plugin-react-hooks v7 also ships the React
    // Compiler ruleset under `recommended-latest`, which is a separate opt-in.
    {
      files: ['**/*.ts', '**/*.tsx'],
      plugins: { 'react-hooks': reactHooks },
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
      },
    },

    // Markdown: lint the prose container, then the fenced code blocks it extracts.
    ...markdown.configs.processor,
    {
      files: ['**/*.md/**'],
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: {
        parserOptions: { project: null, projectService: false },
      },
      rules: { strict: 'off' },
    },

    // YAML.
    {
      files: ['**/*.yml', '**/*.yaml'],
      extends: [
        js.configs.recommended,
        yml.configs['flat/standard'],
        yml.configs['flat/prettier'],
        prettierConfig,
      ],
      languageOptions: { globals: globals.node },
      rules: { 'yml/no-empty-mapping-value': 0 },
    },

    // Inherited, largely untyped code: its `any` and ts-comment use is known and stable.
    ...(legacyTyping
      ? [
          {
            files: ['**/*.ts', '**/*.tsx'],
            rules: {
              '@typescript-eslint/no-explicit-any': 'off',
              '@typescript-eslint/ban-ts-comment': 'off',
            },
          },
        ]
      : []),
  );
}
