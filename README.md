# nature-remo-to-mackerel

[![test](https://github.com/ik11235/nature-remo-to-mackerel/actions/workflows/test.yml/badge.svg)](https://github.com/ik11235/nature-remo-to-mackerel/actions/workflows/test.yml)

Nature Remo, Nature Remo E で取得した温度・湿度・照度・人感・スマートメーターの値をMackerelにPOSTするGoogle Apps Script

# 使い方

1. script.jsをGoogle Apps scriptにコピー
1. 以下の値をプロジェクトのプロパティに定義
    - NATURE_TOKEN: Nature Remo Cloud APIを操作するためのアクセストークン
    - MACKEREL_TOKEN: MackerelのAPIを操作するためのアクセストークン(要Write権限)
    - MACKEREL_HOST_ID: Mackerelに取得した値を書き込む際、対象となるホストの固有ID
    - TARGET_NATURE_REMO_ID: 気温などの値を取得するNature RemoのID(任意)
        - 複数台を対象にする場合はカンマ区切りで指定する (例: `id1,id2`)
        - 未指定の場合は、取得できた全デバイスを対象にする
1. execをトリガーで定期的に実行するように設定

# 送信されるメトリック

`<device名>.<項目名>` という名前で送信される(device名に含まれる空白は `_` に置換)。
複数のデバイスを対象にした場合も、device名で分かれるため衝突しない。
ただし同名のデバイスが複数あるとメトリック名が重複するため、Nature Remoアプリ側で名前を分けておくこと。

| 項目名 | 内容 |
| --- | --- |
| `temperature` | 温度 |
| `humidity` | 湿度 |
| `illuminance` | 照度 |
| `human_sensor` | 人感センサー |
| `normal_electric_energy` | 積算電力量(正方向) |
| `reverse_electric_energy` | 積算電力量(逆方向) |
| `measured_instantaneous` | 瞬時電力 |

搭載センサーは機種によって異なるため、取得できた項目のみが送信される。

| 機種 | 温度 | 湿度 | 照度 | 人感 |
| --- | :-: | :-: | :-: | :-: |
| Remo 3 | ✓ | ✓ | ✓ | ✓ |
| Remo Lapis | ✓ | ✓ | - | - |
| Remo mini 2 | ✓ | - | - | - |

スマートメーター側も同様で、逆方向積算電力量(epc 227)を返さないメーターなどに対応している。
Nature Remo E が接続されていない場合は、Nature Remo 側のメトリックのみ送信される。

# 開発

## テスト

```
npm test
```

Node.js標準の `node:test` のみを使うため、依存パッケージのインストールは不要(Node.js 22以上)。

テスト対象はディレクトリではなくファイルのグロブで指定している。
`node --test test/` というディレクトリ指定はNode.js 22で解決に失敗するため。

`script.js` はclaspでそのままGASへpushするため、Node固有の記法(`module.exports` など)を持ち込めない。
そのため `test/gas_stub.js` でGASのグローバル(`PropertiesService` / `UrlFetchApp` / `Logger` / `Utilities`)を
スタブした `vm` コンテキストに `script.js` を読み込み、`exec()` を実行して
「送信されたメトリクス」「HTTPリクエスト」「ログ」を観測する形でテストしている。

`test/` 以下は `.claspignore` の `**/**` で除外される(再includeしているのはルート直下の `*.js` のみ)ため、
GASへはpushされない。

## CI

masterへのpushとpull requestで、GitHub Actionsが `npm test` を実行する(Node.js 22 / 24 / 26)。
定義は `.github/workflows/test.yml`。

workflowで使うactionのバージョン更新は、Dependabotが週次でまとめてPRを作る(`.github/dependabot.yml`)。
npmの依存パッケージを持たないため、監視対象はGitHub Actionsのみ。
