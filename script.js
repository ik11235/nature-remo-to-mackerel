// 近いことやってる人はすでにいたのでmemo https://qiita.com/merarli/items/12124d51fc3332989f84

function getNatureDevices() {
    const NATURE_TOKEN = PropertiesService.getScriptProperties().getProperty("NATURE_TOKEN");

    // https://www.monotalk.xyz/blog/google-apps-script-urlfetchapp-%E3%81%A7-http-header-%E3%82%92%E8%A8%AD%E5%AE%9A%E3%81%99%E3%82%8B/
    const headers = {
        'accept': "application/json",
        'Authorization': `Bearer ${NATURE_TOKEN}`
    };
    const options = {
        "method": "GET",
        "headers": headers,
    };
    const requestUrl = "https://api.nature.global/1/devices";
    const response = UrlFetchApp.fetch(requestUrl, options);

    return JSON.parse(response.getContentText());
}

function postMackerel(metricsValue) {
    const MACKEREL_TOKEN = PropertiesService.getScriptProperties().getProperty("MACKEREL_TOKEN");

    // https://www.monotalk.xyz/blog/google-apps-script-urlfetchapp-%E3%81%A7-http-header-%E3%82%92%E8%A8%AD%E5%AE%9A%E3%81%99%E3%82%8B/

    //const timeStamp = Math.floor(new Date().getTime() / 1000)

    // https://mackerel.io/ja/api-docs/entry/host-metrics#post

    const headers = {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': MACKEREL_TOKEN,
    }
    const options = {
        "method": "POST",
        "headers": headers,
        "payload": JSON.stringify(metricsValue),
    };
    const requestUrl = "https://api.mackerelio.com/api/v0/tsdb";
    UrlFetchApp.fetch(requestUrl, options);

}

// 取得した値をmetricValue形式に変換する https://mackerel.io/ja/api-docs/entry/host-metrics#post
function convertMackerelMetricValue(result) {

    const MACKEREL_HOST_ID = PropertiesService.getScriptProperties().getProperty("MACKEREL_HOST_ID");
    let return_array = []

    for (const [key, value] of Object.entries(result)) {
        return_array.push({
            hostId: MACKEREL_HOST_ID,
            name: key,
            time: Math.floor(new Date(value['created_at']).getTime() / 1000),
            value: value['val'],
        });
        // val=1.0, created_at=2020-08-17T08:45:21Z

    }

    return return_array
}

function exec() {
    const natureResponce = getNatureDevices()
    const natureRemoData = natureResponce.filter(function (object) {
        return object.id === "XXXX";
    })[0];

    console.log(natureRemoData);

    const result = {
        temperature: natureRemoData['newest_events']['te'],
        humidity: natureRemoData['newest_events']['hu'],
        llluminance: natureRemoData['newest_events']['il'],
        human_sensor: natureRemoData['newest_events']['mo']
    };


    Logger.log(convertMackerelMetricValue(result));
    postMackerel(convertMackerelMetricValue(result));
}