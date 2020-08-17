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

function requestNatureAPI(requestUrl) {
    // https://www.monotalk.xyz/blog/google-apps-script-urlfetchapp-%E3%81%A7-http-header-%E3%82%92%E8%A8%AD%E5%AE%9A%E3%81%99%E3%82%8B/
    const headers = {
        'accept': "application/json",
        'Authorization': `Bearer ${NATURE_TOKEN}`
    };
    const options = {
        "method": "GET",
        "headers": headers,
    };

    return UrlFetchApp.fetch(requestUrl, options);
}

function getNatureAppliances() {
    const response = requestNatureAPI("https://api.nature.global/1/appliances")

    return JSON.parse(response.getContentText());
}

function getNatureDevices() {
    const response = requestNatureAPI("https://api.nature.global/1/devices")

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

/**
 * Nature RemoAPIから返ってきたnewest_eventsの各値をmetricValueのarrayに変換する
 * metricValueは https://mackerel.io/ja/api-docs/entry/host-metrics#post 参照
 * @param name deviceの名前(Mackerelのメトリック分割用に `device名.key`という名前に変換する)
 * @param result
 * @returns {Object[]} metricValueの形に合わせた値の配列
 */
function convertMackerelMetricValue(name, result) {

    let return_array = []

    for (const [key, value] of Object.entries(result)) {
        return_array.push({
            hostId: MACKEREL_HOST_ID,
            name: `${name}.${key}`,
            time: Math.floor(new Date(value['created_at']).getTime() / 1000),
            value: value['val'],
        });
    }

    return return_array
}

/**
 * このGASの本体
 * 以下の処理を行う
 *  - Nature Remo Cloud APIから各種値を取得
 *  - 取得した値をMackerelにPost
 *
 *  近いことやってる人はすでにいたのでmemo https://qiita.com/merarli/items/12124d51fc3332989f84
 */
function exec() {
    const natureResponce = getNatureDevices()
    const natureRemoData = natureResponce.filter(function (object) {
        return object.id === TARGET_NATURE_REMO_ID;
    })[0];

    const name = natureRemoData["name"];
    const result = {
        temperature: natureRemoData['newest_events']['te'],
        humidity: natureRemoData['newest_events']['hu'],
        llluminance: natureRemoData['newest_events']['il'],
        human_sensor: natureRemoData['newest_events']['mo']
    };

    const metricValue = convertMackerelMetricValue(name, result)
    Logger.log(metricValue)
    postMackerel(metricValue)
}

/**
 * Nature Remo Cloud APIのGET /1/appliancesから取得したJSONから、スマートメーターに関する値を成形して返す
 * スマートメーターの値の成形については、https://developer.nature.global/jp/how-to-calculate-energy-data-from-smart-meter-values 参照
 *
 * @param appliances Nature Remo Cloud APIのGET /1/appliancesから取得したJSON
 */
function getSmartMeterValues(appliances) {
    // smart_meterのkeyの存在有無でスマートメーターの値か否かを判定
    // 一旦、スマートメーターを複数設置しないという想定で[0]決め打ち
    const smartMeter = appliances.filter(function (obj) {
        return 'smart_meter' in obj
    })[0].smart_meter

    Logger.log(smartMeter.echonetlite_properties);
    smartMeter.echonetlite_properties.forEach(function (property) {
        // TODO: https://developer.nature.global/jp/how-to-calculate-energy-data-from-smart-meter-values を参考に必要な実装を行う
        Logger.log(property)
    })
}

function test() {
    const appliances = getNatureAppliances()
    const smartMeterValues = getSmartMeterValues(appliances)
}
