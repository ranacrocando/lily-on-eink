import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist', '**/node_modules', '**/out', '**/test-output', '**/coverage'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      // Numbers in template literals are safe and used for counts/line numbers throughout.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/test/**/*.ts', 'vitest.config.ts'],
    rules: {
      // noUncheckedIndexedAccess makes `x[0]!` the idiomatic way to assert in tests; a failure is a test failure anyway.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // expect.stringContaining()/objectContaining() are typed `any` by Vitest.
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  { files: ['**/*.js', '**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
  { files: ['scripts/**', '**/*.mjs'], languageOptions: { globals: globals.node } },
  prettier,
);
