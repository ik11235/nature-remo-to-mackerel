/**
 * Nature Remo Cloud APIを操作するためのアクセストークン
 * @see: https://developer.nature.global/
 * @type {string}
 */
const NATURE_TOKEN = PropertiesService.getScriptProperties().getProperty("NATURE_TOKEN");
/**
 * MackerelのAPIを操作するためのアクセストークン(要Write権限)
 * @see: https://mackerel.io/my?tab=apikeys
 * @type {string}
 */
const MACKEREL_TOKEN = PropertiesService.getScriptProperties().getProperty("MACKEREL_TOKEN");
/**
 * Mackerelに取得した値を書き込む際、対象となるホストの固有ID
 * 管理画面・APIResponseから確認可能
 *
 * @type {string}
 */
const MACKEREL_HOST_ID = PropertiesService.getScriptProperties().getProperty("MACKEREL_HOST_ID");
/**
 * 気温などの値を取得するNATURE_REMOのID
 * 複数台のNature Remoや、Nature Remo Eと併用している場合、複数のdeviceが取得されるので、1つに絞るために使用
 *
 * @type {string}
 */
const TARGET_NATURE_REMO_ID = PropertiesService.getScriptProperties().getProperty("TARGET_NATURE_REMO_ID");

// 近いことやってる人はすでにいたのでmemo https://qiita.com/merarli/items/12124d51fc3332989f84

function getNatureDevices() {

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

    let return_array = []

    for (const [key, value] of Object.entries(result)) {
        return_array.push({
            hostId: MACKEREL_HOST_ID,
            name: key,
            time: Math.floor(new Date(value['created_at']).getTime() / 1000),
            value: value['val'],
        });
    }

    return return_array
}

function exec() {
    const natureResponce = getNatureDevices()
    const natureRemoData = natureResponce.filter(function (object) {
        return object.id === TARGET_NATURE_REMO_ID;
    })[0];

    const result = {
        temperature: natureRemoData['newest_events']['te'],
        humidity: natureRemoData['newest_events']['hu'],
        llluminance: natureRemoData['newest_events']['il'],
        human_sensor: natureRemoData['newest_events']['mo']
    };

    postMackerel(convertMackerelMetricValue(result));
}