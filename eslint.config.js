import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

export default [
  {
    files: ['src/**/*.{js,ts}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        history: 'readonly', location: 'readonly', localStorage: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        crypto: 'readonly', atob: 'readonly', btoa: 'readonly',
        Image: 'readonly', URL: 'readonly', HTMLElement: 'readonly',
        DOMParser: 'readonly', IntersectionObserver: 'readonly',
        MutationObserver: 'readonly', getComputedStyle: 'readonly',
        fetch: 'readonly', alert: 'readonly', confirm: 'readonly',
        prompt: 'readonly', console: 'readonly', Node: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly',
        FileReader: 'readonly', Blob: 'readonly', File: 'readonly',
        DataTransfer: 'readonly', ClipboardEvent: 'readonly',
        InputEvent: 'readonly', PointerEvent: 'readonly',
        Event: 'readonly', CustomEvent: 'readonly', KeyboardEvent: 'readonly',
        Selection: 'readonly', ResizeObserver: 'readonly',
        performance: 'readonly',
        Worker: 'readonly', self: 'readonly', require: 'readonly',
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      'no-undef': 'off', // TypeScript handles this
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-constant-condition': 'warn',
      'no-debugger': 'warn',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty': 'warn',
      'no-redeclare': 'error',
      'no-unreachable': 'warn',
      'eqeqeq': ['warn', 'smart'],
      'no-caller': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
    }
  }
]
