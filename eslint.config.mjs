import tseslint from 'typescript-eslint'

const rules = {
  'no-debugger': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
}

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/.next/**',
      'apps/desktop/resources/**',
      'apps/desktop/dist/**',
      // surf-ide/code-oss is an upstream VS Code checkout; only the Surf AI
      // extension inside it is ours. Ignoring the vendored tree keeps
      // `npx eslint .` runnable on a laptop without changing what CI lints.
      'surf-ide/code-oss/**',
      '!surf-ide/code-oss/extensions/surf-ai/**',
    ],
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs' },
    rules,
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules,
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    rules,
  },
]
