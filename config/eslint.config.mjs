import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mts'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        RTCPeerConnection: 'readonly',
        RTCDataChannel: 'readonly',
      },
    },
  },
  {
    files: ['api/**/*.mts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  // React components (.tsx): JSX correctness + accessibility.
  {
    files: ['src/**/*.tsx'],
    ...react.configs.flat.recommended,
    ...jsxA11y.flatConfigs.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      ...jsxA11y.flatConfigs.recommended.languageOptions,
    },
    plugins: {
      ...react.configs.flat.recommended.plugins,
      ...jsxA11y.flatConfigs.recommended.plugins,
      'react-refresh': reactRefresh,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactRefresh.configs.vite.rules,
      // TS types replace prop-types checking.
      'react/prop-types': 'off',
    },
  },
  // Hooks rules apply everywhere a hook can be defined -- this project
  // keeps hook modules under .mts (see src/hooks/), not just .tsx.
  {
    files: ['src/**/*.tsx', 'src/**/*.mts'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: reactHooks.configs['recommended-latest'].rules,
  },
  prettier,
];
