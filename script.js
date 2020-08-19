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

/**
 * このGASの本体
 * 以下の処理を行う
 *  - Nature Remo Cloud APIから各種値を取得
 *  - 取得した値をMackerelにPost
 *
 *  近いことやってる人はすでにいたのでmemo https://qiita.com/merarli/items/12124d51fc3332989f84
 */
function exec() {
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
            const timeBaseValue = value['created_at'] || value['updated_at']
            const escapeName = `${name}.${key}`.split(' ').join('_')
            return_array.push({
                hostId: MACKEREL_HOST_ID,
                name: escapeName,
                time: Math.floor(new Date(timeBaseValue).getTime() / 1000),
                value: Number(value['val']),
            });
        }

        return return_array
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
        })[0]

        const name = smartMeter.device.name
        const properties = convertSmartMeterProperties(smartMeter.smart_meter.echonetlite_properties);
        const smartMeterValues = convertSmartMeterValues(properties);

        return convertMackerelMetricValue(name, smartMeterValues);
    }

    /**
     * スマートメーターから受け取った値群のArrayをオブジェクトに変換する
     * 参考: https://developer.nature.global/jp/how-to-calculate-energy-data-from-smart-meter-values
     *
     * @param properties
     * @returns {{cumulative_electric_energy_effective_digits: *, cumulative_electric_energy_unit: *, normal_direction_cumulative_electric_energy: *, coefficient: *, reverse_direction_cumulative_electric_energy: *, measured_instantaneous: *}}
     */
    function convertSmartMeterProperties(properties) {
        return {
            normal_direction_cumulative_electric_energy: properties.filter(obj => obj.epc == 224)[0],
            reverse_direction_cumulative_electric_energy: properties.filter(obj => obj.epc == 227)[0],
            coefficient: properties.filter(obj => obj.epc == 211)[0],
            cumulative_electric_energy_unit: properties.filter(obj => obj.epc == 225)[0],
            cumulative_electric_energy_effective_digits: properties.filter(obj => obj.epc == 215)[0],
            measured_instantaneous: properties.filter(obj => obj.epc == 231)[0],
        };
    }

    /**
     * convertSmartMeterPropertiesで変換した値を、扱いやすい形に変換する
     *
     * @param properties
     * @returns {{normal_electric_energy: {val: number, updated_at: *}, reverse_electric_energy: {val: number, updated_at: *}, measured_instantaneous: {val: *, updated_at: *}}}
     */
    function convertSmartMeterValues(properties) {
        const cumulativeUnit = getCumulativeUnit(properties.cumulative_electric_energy_unit.val);

        const normal_electric_energy = {
            val: properties.normal_direction_cumulative_electric_energy.val * properties.coefficient.val * cumulativeUnit,
            updated_at: properties.normal_direction_cumulative_electric_energy.updated_at
        }
        const reverse_electric_energy = {
            val: properties.reverse_direction_cumulative_electric_energy.val * properties.coefficient.val * cumulativeUnit,
            updated_at: properties.reverse_direction_cumulative_electric_energy.updated_at
        }
        const measured_instantaneous = {
            val: properties.measured_instantaneous.val,
            updated_at: properties.measured_instantaneous.updated_at
        }

        return {
            normal_electric_energy: normal_electric_energy,
            reverse_electric_energy: reverse_electric_energy,
            measured_instantaneous: measured_instantaneous
        }
    }

    /**
     * スマートメーターから取得した積算電力量単位を実際の単位(kW)に変換する
     *
     * @param cumulativeUnit
     * @return {Number}
     */
    function getCumulativeUnit(cumulativeUnit) {
        switch (Number(cumulativeUnit)) {
            case 0x00:
                return 1
            case 0x01:
                return 0.1
            case 0x02:
                return 0.01
            case 0x03:
                return 0.001
            case 0x04:
                return 0.0001
            case 0x0A:
                return 10
            case 0x0B:
                return 100
            case 0x0C:
                return 1000
            case 0x0D:
                return 10000
            default:
                throw 'Parameter is not a cumulativeUnit!';
        }
    }

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

    const natureRemoMetricValue = convertMackerelMetricValue(name, result)
    const appliances = getNatureAppliances()
    const smartMeterMetricValue = getSmartMeterValues(appliances)
    const metricValue = natureRemoMetricValue.concat(smartMeterMetricValue);

    Logger.log(metricValue)
    postMackerel(metricValue)
}