module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es2021: true,
  },
  globals: {
    NodeJS: true,
  },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
  },
  plugins: ['@typescript-eslint', 'prefer-arrow'],
  rules: {
    'import/extensions': 0,
    'import/prefer-default-export': 0,
    'prefer-arrow/prefer-arrow-functions': [
      'error',
      {
        disallowPrototype: true,
        singleReturnOnly: false,
        classPropertiesAllowed: true,
      },
    ],
  },
  settings: {
    'import/resolver': {
      typescript: {},
    },
  },
};
