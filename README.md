# nature-remo-to-mackerel

[![test](https://github.com/ik11235/nature-remo-to-mackerel/actions/workflows/test.yml/badge.svg)](https://github.com/ik11235/nature-remo-to-mackerel/actions/workflows/test.yml)

Nature Remo, Nature Remo E で取得した温度・湿度・照度・人感・スマートメーターの値をMackerelにPOSTするGoogle Apps Script

# 使い方

## 1. GASプロジェクトを用意する

[clasp](https://github.com/google/clasp) でローカルからGASへコードを反映する。

```
npm install
npm run login
```

新規に作る場合は `npx clasp create-script --type standalone --title nature-remo-to-mackerel`、
既存のGASプロジェクトに反映する場合は `.clasp.json` を作る。

```json
{
  "scriptId": "<GASのURLの /projects/ と /edit の間の文字列>",
  "rootDir": "."
}
```

`.clasp.json` はアクセス先を特定する情報なので、`.gitignore` でコミット対象から外している。

## 2. スクリプトプロパティを設定する

GASエディタの「プロジェクトの設定 > スクリプト プロパティ」で定義する。

| プロパティ | 内容 |
| --- | --- |
| `NATURE_TOKEN` | Nature Remo Cloud APIを操作するためのアクセストークン |
| `MACKEREL_TOKEN` | MackerelのAPIを操作するためのアクセストークン(要Write権限) |
| `MACKEREL_HOST_ID` | 取得した値を書き込む対象となるホストの固有ID |
| `MACKEREL_SERVICE_NAME` | ホストではなくサービスに書き込む場合のサービス名 |
| `TARGET_NATURE_REMO_ID` | 気温などの値を取得するNature RemoのID(任意) |
| `STALE_THRESHOLD_MINUTES` | 値の更新が止まったと判断するまでの分数(任意、既定値180) |

`TARGET_NATURE_REMO_ID` は複数台を対象にする場合カンマ区切りで指定する (例: `id1,id2`)。
未指定の場合は、取得できた全デバイスを対象にする。

`MACKEREL_HOST_ID` と `MACKEREL_SERVICE_NAME` は、どちらか一方だけを設定する。
両方設定した場合・どちらも未設定の場合はエラーで停止する。

- `MACKEREL_HOST_ID` を設定 → [ホストメトリック](https://mackerel.io/ja/api-docs/entry/host-metrics)として書き込む
- `MACKEREL_SERVICE_NAME` を設定 → [サービスメトリック](https://mackerel.io/ja/api-docs/entry/service-metrics)として書き込む

Mackerel上にホストを持たない運用の場合はサービスメトリックを使う。
メトリック名と値は、どちらでも同じ。

`TARGET_NATURE_REMO_ID` と `STALE_THRESHOLD_MINUTES` 以外が未設定の場合、APIを呼ぶ前にエラーで停止する。

## 値の更新が止まった場合

デバイスがオフラインになると、Nature Remo Cloud APIは最後に取得できた値を返し続ける。
メトリクスのタイムスタンプは値の取得時刻なのでMackerelのグラフは正しく止まるが、
送信自体は成功するため異常に気づきにくい。

`STALE_THRESHOLD_MINUTES` を超えて更新が止まっている値は、実行ログに記録される。

```
stale metric. name: Remo_Lapis.temperature, last update: 2026-09-17T12:23:00Z (200 min ago)
```

検知しても送信は止めない(判断を誤ったときにメトリクスが失われるのを避けるため)。

newest_eventsは値が変化したときに更新されるため、しきい値を短くしすぎると
気温や湿度が安定しているだけの状態を拾ってしまう点に注意。

## 3. コードを反映する

```
npm run push
```

反映されるのは `script.js` と `appsscript.json` のみ。
事前に対象を確認する場合は `npm run status` を使う。

## 4. トリガーを設定する

GASエディタの「トリガー」で、`exec` を時間主導型で定期実行するよう設定する。

Nature Remo Cloud APIには5分あたり30リクエストのレートリミットがあり、
1回の実行で2リクエスト消費するため、5分間隔でも余裕がある。

あわせてトリガーの通知設定を有効にしておくと、失敗に気づける。
実行ログは `npm run logs` またはGASエディタの「実行数」から確認できる。

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

必要なNode.jsは22以上。

```
npm install
```

## clasp が `clasp` コマンドで動かない場合

clingo(ASPソルバー)にも `clasp` という同名のコマンドが同梱されており、
Homebrewで入れているとそちらが優先されることがある。
その場合 `clasp login` は次のように失敗する。

```
*** ERROR: (clasp): Can not read from 'login'!
```

このリポジトリではclaspをdevDependenciesに入れ、`npm run push` のような
npm scripts経由で呼ぶことで `node_modules/.bin/clasp` を使うようにしている。
グローバルのPATHに影響されないため、この衝突は起きない。

| コマンド | 内容 |
| --- | --- |
| `npm run login` | claspのログイン |
| `npm run status` | pushされるファイルの確認 |
| `npm run push` | GASへの反映 |
| `npm run pull` | GASからの取得 |
| `npm run logs` | 実行ログの表示 |

## テスト

```
npm test
```

テスト自体はNode.js標準の `node:test` のみを使い、依存パッケージを使わない。

テスト対象はディレクトリではなくファイルのグロブで指定している。
`node --test test/` というディレクトリ指定はNode.js 22で解決に失敗するため。

`script.js` はclaspでそのままGASへpushするため、Node固有の記法(`module.exports` など)を持ち込めない。
そのため `test/gas_stub.js` でGASのグローバル(`PropertiesService` / `UrlFetchApp` / `Logger` / `Utilities`)を
スタブした `vm` コンテキストに `script.js` を読み込み、`exec()` を実行して
「送信されたメトリクス」「HTTPリクエスト」「ログ」を観測する形でテストしている。

## GASへpushされるファイル

`.claspignore` で全ファイルを除外したうえで、`script.js` と `appsscript.json` だけを明示的に再includeしている。

```
**/**
!script.js
!appsscript.json
```

GASはプロジェクト内の全ファイルを読み込んで評価するため、Node.js向けのファイルが混ざると
`ReferenceError: require is not defined` で全実行が失敗する。
`!*.js` のようなワイルドカードで再includeすると、ルート直下にファイルを追加したときに
気づかないままpushされるため、対象は1つずつ列挙する。

この不変条件は `test/claspignore.test.js` で検証している。
実際にpushされる対象は `npm run status` でも確認できる。

## Lint

```
npm run lint
```

設定は `eslint.config.js`。`script.js` はGASのグローバル(`PropertiesService` など)を参照し、
`test/` 以下はCommonJSとNode.jsのグローバルを使うため、それぞれ別の設定を当てている。

`exec` はGASのトリガーから呼ばれるため、コード上は未使用に見える。
`no-unused-vars` の `varsIgnorePattern` で除外している(外すとエラーになる)。

## CI

masterへのpushとpull requestで、GitHub Actionsが `npm test` (Node.js 22 / 24 / 26)と
`npm run lint` を実行する。定義は `.github/workflows/test.yml`。

GitHub Actionsとnpm(clasp)のバージョン更新は、Dependabotが週次でまとめてPRを作る
(`.github/dependabot.yml`)。
