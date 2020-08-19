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
