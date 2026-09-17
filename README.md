# nature-remo-to-mackerel

Nature Remo, Nature Remo E で取得した温度・湿度・照度・人感・スマートメーターの値をMackerelにPOSTするGoogle Apps Script

# 使い方

1. script.jsをGoogle Apps scriptにコピー
1. 以下の値をプロジェクトのプロパティに定義
    - NATURE_TOKEN: Nature Remo Cloud APIを操作するためのアクセストークン
    - MACKEREL_TOKEN: MackerelのAPIを操作するためのアクセストークン(要Write権限)
    - MACKEREL_HOST_ID: Mackerelに取得した値を書き込む際、対象となるホストの固有ID
    - TARGET_NATURE_REMO_ID: 気温などの値を取得するNATURE_REMOのID
1. execをトリガーで定期的に実行するように設定

# 送信されるメトリック

`<device名>.<項目名>` という名前で送信される(device名に含まれる空白は `_` に置換)。

| 項目名 | 内容 |
| --- | --- |
| `temperature` | 温度 |
| `humidity` | 湿度 |
| `illuminance` | 照度 |
| `llluminance` | 照度(後述の非推奨な別名) |
| `human_sensor` | 人感センサー |
| `normal_electric_energy` | 積算電力量(正方向) |
| `reverse_electric_energy` | 積算電力量(逆方向) |
| `measured_instantaneous` | 瞬時電力 |

取得できなかった項目はスキップされる(Remo miniのように湿度・照度を持たない機種や、
逆方向積算電力量を返さないスマートメーターに対応するため)。
Nature Remo E が接続されていない場合も、Nature Remo 側のメトリックのみ送信される。

## `llluminance` について

照度のメトリック名が `llluminance` (先頭が `l` 3つ)とtypoしていた。
既存のグラフが途切れないよう、現在は `illuminance` と `llluminance` の両方に同じ値を送信している。
グラフの移行が完了したら、`llluminance` の送信は削除してよい。
