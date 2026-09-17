'use strict';

const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    {
        // GASへpushされる本体。GASのグローバルを参照し、module.exportsなどは使えない
        files: ['script.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: {
                PropertiesService: 'readonly',
                UrlFetchApp: 'readonly',
                Logger: 'readonly',
                Utilities: 'readonly',
            },
        },
        rules: {
            // execはGASのトリガーから呼ばれるため、未使用に見えても消してはいけない
            'no-unused-vars': ['error', {varsIgnorePattern: '^exec$'}],
        },
    },
    {
        // ローカルでのみ動かすテスト。CommonJSとNode.jsのグローバルを使う
        files: ['test/**/*.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'writable',
                __dirname: 'readonly',
                console: 'readonly',
                process: 'readonly',
            },
        },
    },
];
