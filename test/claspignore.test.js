const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * GASへpushしてよいファイル
 *
 * GASはプロジェクト内の全ファイルを読み込んで評価するため、
 * Node.js向けのファイル(eslint.config.js など)が混ざると
 * `ReferenceError: require is not defined` で全実行が失敗する
 */
const PUSHABLE_FILES = ['script.js', 'appsscript.json'];

const claspignore = fs.readFileSync(path.join(__dirname, '..', '.claspignore'), 'utf8');

const negationPatterns = claspignore.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('!'))
    .map((line) => line.slice(1));

test('.claspignore', async (t) => {
    await t.test('pushする対象を明示的に列挙している', () => {
        assert.deepStrictEqual(negationPatterns.sort(), PUSHABLE_FILES.slice().sort());
    });

    await t.test('ワイルドカードでの再includeを含まない', () => {
        // `!*.js` のような指定だと、ルート直下にNode.js向けのjsを足したときに
        // 気づかないままGASへpushされてしまう
        const wildcards = negationPatterns.filter((pattern) => pattern.includes('*'));

        assert.deepStrictEqual(wildcards, []);
    });

    await t.test('pushする対象のファイルが実在する', () => {
        PUSHABLE_FILES.forEach((file) => {
            assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `${file} が見つからない`);
        });
    });
});
