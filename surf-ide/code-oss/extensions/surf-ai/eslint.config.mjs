// Surf AI extension linting.
//
// This folder sits inside the git-ignored VS Code checkout, so without a config
// of its own ESLint walks up and applies the fork's ruleset — which requires
// VS Code's copyright header on every file and bans the synchronous fs calls
// this extension legitimately makes while reading a knowledge pack. The rules
// below are the ones the rest of this repository uses.
import tseslint from 'typescript-eslint'

const rules = {
  'no-debugger': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
}

export default [
  { ignores: ['out/**', 'out-test/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules,
  },
]
