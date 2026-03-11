import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import promisePlugin from 'eslint-plugin-promise';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.js', '**/*.mjs'],
    plugins: {
      prettier: prettierPlugin,
      promise: promisePlugin,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        // Node.js 18+ globals
        fetch: 'readonly',
        // Runtime-specific globals
        Bun: 'readonly',
        Deno: 'readonly',
        // Timer globals (Bun/Node.js)
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        // Other globals
        require: 'readonly',
        AbortController: 'readonly',
        // Web APIs available in Bun
        Blob: 'readonly',
        Response: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
      },
    },
    rules: {
      // Prettier integration
      'prettier/prettier': 'error',

      // Code quality rules
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off', // Allow console in this project
      'no-debugger': 'error',

      // Best practices
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'no-duplicate-imports': 'error',

      // ES6+ features
      'arrow-body-style': ['error', 'as-needed'],
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',

      // Async/await and promise safety (#213)
      'no-async-promise-executor': 'error',
      'require-await': 'warn',
      // Detect dangling/floating promises that are not awaited or caught.
      // This prevents unhandled promise rejections and process leaks.
      // See: https://github.com/link-assistant/agent/issues/213
      'promise/catch-or-return': 'warn',
      'promise/no-nesting': 'warn',

      // Comments and documentation
      'spaced-comment': ['error', 'always', { markers: ['/'] }],

      // Process leak prevention (#213)
      // Warn when process.on() is used — prefer process.once() to avoid handler accumulation.
      // Allowed in index.js for global error handlers.
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "CallExpression[callee.object.name='process'][callee.property.name='on'][arguments.0.value='SIGINT']",
          message:
            'Use process.once("SIGINT") instead of process.on("SIGINT") to prevent handler accumulation (#213).',
        },
        {
          selector:
            "CallExpression[callee.object.name='process'][callee.property.name='on'][arguments.0.value='SIGTERM']",
          message:
            'Use process.once("SIGTERM") instead of process.on("SIGTERM") to prevent handler accumulation (#213).',
        },
      ],
    },
  },
  {
    // Test files have different requirements
    files: ['tests/**/*.js', '**/*.test.js'],
    rules: {
      'require-await': 'off', // Async functions without await are common in tests
      // Tests often fire-and-forget promises intentionally
      'promise/catch-or-return': 'off',
    },
  },
  {
    // Main entry point uses process.on() for global error handlers — that's expected
    files: ['src/index.js'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      '*.min.js',
      '.eslintcache',
    ],
  },
];
