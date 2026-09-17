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
 * ホストではなくサービスに値を書き込む場合の、対象となるサービス名
 * MACKEREL_HOST_IDとどちらか一方のみを設定する
 *
 * @see: https://mackerel.io/ja/api-docs/entry/service-metrics
 * @type {string}
 */
const MACKEREL_SERVICE_NAME = PropertiesService.getScriptProperties().getProperty("MACKEREL_SERVICE_NAME");
/**
 * 気温などの値を取得するNATURE_REMOのID
 * 複数台を対象にする場合はカンマ区切りで指定する (例: `id1,id2`)
 * 未指定の場合は、取得できた全デバイスを対象にする
 *
 * @type {string}
 */
const TARGET_NATURE_REMO_ID = PropertiesService.getScriptProperties().getProperty("TARGET_NATURE_REMO_ID");
/**
 * 値の更新が止まっていると判断するまでの分数
 * デバイスがオフラインになったことに気づくためのログ出力にのみ使う(送信は止めない)
 *
 * Nature Remoのnewest_eventsは値が変化したときに更新されるため、
 * 短くしすぎると気温や湿度が安定しているだけの状態を拾ってしまう
 *
 * @type {string}
 */
const STALE_THRESHOLD_MINUTES = PropertiesService.getScriptProperties().getProperty("STALE_THRESHOLD_MINUTES");

/**
 * このGASの本体
 * 以下の処理を行う
 *  - Nature Remo Cloud APIから各種値を取得
 *  - 取得した値をMackerelにPost
 *
 *  近いことやってる人はすでにいたのでmemo https://qiita.com/merarli/items/12124d51fc3332989f84
 */
function exec() {

    /**
     * 実行に必要なスクリプトプロパティが設定されているかを検証する
     * 未設定のまま実行すると401や意図しないメトリック名での送信になり原因が分かりにくいため、
     * APIを叩く前に明示的なエラーで止める
     *
     * TARGET_NATURE_REMO_IDは未指定を「全デバイス」の意味で使うため、検証対象に含めない
     */
    function validateScriptProperties() {
        const properties = {
            NATURE_TOKEN: NATURE_TOKEN,
            MACKEREL_TOKEN: MACKEREL_TOKEN,
        };

        const missing = Object.keys(properties).filter(key => !properties[key]);
        if (missing.length > 0) {
            throw new Error(`script property is not set: ${missing.join(', ')}. set them in プロジェクトの設定 > スクリプト プロパティ.`);
        }

        // 書き込み先はホストかサービスのどちらか。両方設定されていると意図が判断できない
        if (MACKEREL_HOST_ID && MACKEREL_SERVICE_NAME) {
            throw new Error('set only one of MACKEREL_HOST_ID or MACKEREL_SERVICE_NAME.');
        }
        if (!MACKEREL_HOST_ID && !MACKEREL_SERVICE_NAME) {
            throw new Error('script property is not set: MACKEREL_HOST_ID or MACKEREL_SERVICE_NAME. set them in プロジェクトの設定 > スクリプト プロパティ.');
        }
    }

    /**
     * リトライ可能なエラー(429 / 5xx)の場合に、指数バックオフで再試行しつつHTTPリクエストを行う
     *
     * Nature Remo Cloud APIには5分あたり30回のレートリミットがあり、超過すると429が返る
     * @see: https://developer.nature.global/
     *
     * @param requestUrl リクエストするurl
     * @param options UrlFetchApp.fetchに渡すオプション
     * @returns {HTTPResponse} 2xxが返ったレスポンス
     */
    function fetchWithRetry(requestUrl, options) {
        const maxAttempts = 3;
        const fetchOptions = Object.assign({}, options, {muteHttpExceptions: true});

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const response = UrlFetchApp.fetch(requestUrl, fetchOptions);
            const statusCode = response.getResponseCode();

            if (statusCode >= 200 && statusCode < 300) {
                return response;
            }

            const retryable = statusCode === 429 || statusCode >= 500;
            if (!retryable || attempt === maxAttempts) {
                throw new Error(`request failed. url: ${requestUrl}, status: ${statusCode}, body: ${response.getContentText()}`);
            }

            const waitMs = 1000 * Math.pow(2, attempt - 1);
            Logger.log(`retryable error. retry after ${waitMs}ms. url: ${requestUrl}, status: ${statusCode}`);
            Utilities.sleep(waitMs);
        }
    }

    /**
     * 引数で受け取ったNature Cloud APIにアクセスして結果を返す
     * (引数なし・GETでのメソッドのみ対応)
     *
     * @param requestUrl リクエストするAPIのurl
     */
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

        return fetchWithRetry(requestUrl, options);
    }

    /**
     * Mackerelのメトリクス追加APIに対して、引数で渡されたmetricsValueをPOSTする
     *
     * MACKEREL_SERVICE_NAMEが設定されている場合はサービスメトリック、
     * そうでない場合はホストメトリックとして書き込む
     *
     * API詳細は https://mackerel.io/ja/api-docs/entry/host-metrics#post
     * および https://mackerel.io/ja/api-docs/entry/service-metrics#post
     *
     * @param metricsValue
     */
    function postMackerel(metricsValue) {
        // https://www.monotalk.xyz/blog/google-apps-script-urlfetchapp-%E3%81%A7-http-header-%E3%82%92%E8%A8%AD%E5%AE%9A%E3%81%99%E3%82%8B/

        const headers = {
            'accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Api-Key': MACKEREL_TOKEN,
        }
        const payload = JSON.stringify(metricsValue);
        const options = {
            "method": "POST",
            "headers": headers,
            "payload": payload,
        };
        const requestUrl = MACKEREL_SERVICE_NAME
            ? `https://api.mackerelio.com/api/v0/services/${encodeURIComponent(MACKEREL_SERVICE_NAME)}/tsdb`
            : "https://api.mackerelio.com/api/v0/tsdb";

        try {
            fetchWithRetry(requestUrl, options);
        } catch (error) {
            // 送信できなかった値を後から追跡できるよう、ペイロードごとログに残す
            Logger.log(`failed to post metrics to Mackerel. payload: ${payload}`);
            throw error;
        }
    }

    /**
     * Nature RemoAPIから返ってきたnewest_events/ getSmartMeterValuesで整形したsmart_meterの各値を
     * metricValueのarrayに変換する
     *
     * 値が取得できていないkeyや、数値・時刻に変換できないkeyはスキップする
     * (Remo miniのように湿度・照度を持たない機種や、プロパティが欠落したレスポンスへの対策)
     *
     * metricValueは https://mackerel.io/ja/api-docs/entry/host-metrics#post 参照
     * @param name deviceの名前(Mackerelのメトリック分割用に `device名.key`という名前に変換する)
     * @param result newest_events/ getSmartMeterValuesのArray
     * @returns {Object[]} metricValueの形に合わせた値の配列
     */
    function convertMackerelMetricValue(name, result) {

        let return_array = []

        for (const [key, value] of Object.entries(result)) {
            if (!value) {
                Logger.log(`skip metric. value is empty. name: ${name}.${key}`)
                continue
            }

            const timeBaseValue = value['created_at'] || value['updated_at']
            const time = Math.floor(new Date(timeBaseValue).getTime() / 1000)
            const metricValue = Number(value['val'])

            if (!Number.isFinite(time) || !Number.isFinite(metricValue)) {
                Logger.log(`skip metric. invalid value. name: ${name}.${key}, time: ${timeBaseValue}, val: ${value['val']}`)
                continue
            }

            const escapeName = `${name}.${key}`.split(' ').join('_')
            const metric = {
                name: escapeName,
                time: time,
                value: metricValue,
            };

            // サービスメトリックはhostIdを持たない
            if (!MACKEREL_SERVICE_NAME) {
                metric.hostId = MACKEREL_HOST_ID;
            }

            return_array.push(metric);
        }

        return return_array
    }

    /**
     * Nature Remo Cloud APIのGET /1/appliancesから取得したJSONから、スマートメーターに関する値を成形して返す
     * スマートメーターの値の成形については、https://developer.nature.global/jp/how-to-calculate-energy-data-from-smart-meter-values 参照
     *
     * @param appliances Nature Remo Cloud APIのGET /1/appliancesから取得したJSONをJSON.parseしたオブジェクト
     * @returns {Object[]}
     */
    function getSmartMeterValues(appliances) {
        /**
         * スマートメーターから受け取った値群のArrayをオブジェクトに変換する
         * 機種によって返らないプロパティがあるため、見つからない場合はundefinedが入る
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
         * 取得できなかったプロパティに対応する値は含めない
         * (epc 227(逆方向積算電力量)を返さないメーターが存在するため)
         *
         * @param properties
         * @returns {Object} 算出できた値のみを持つオブジェクト
         */
        function convertSmartMeterValues(properties) {
            const values = {};

            // 係数(epc 211)は返さないメーターがあり、その場合は1として扱う
            // 参考: https://developer.nature.global/jp/how-to-calculate-energy-data-from-smart-meter-values
            const coefficient = properties.coefficient ? Number(properties.coefficient.val) : 1;
            const cumulativeUnit = properties.cumulative_electric_energy_unit
                ? getCumulativeUnit(properties.cumulative_electric_energy_unit.val)
                : null;

            if (cumulativeUnit === null) {
                Logger.log('skip cumulative electric energy. cumulative_electric_energy_unit(epc 225) is missing or unknown.')
            } else {
                if (properties.normal_direction_cumulative_electric_energy) {
                    values.normal_electric_energy = {
                        val: properties.normal_direction_cumulative_electric_energy.val * coefficient * cumulativeUnit,
                        updated_at: properties.normal_direction_cumulative_electric_energy.updated_at
                    }
                }
                if (properties.reverse_direction_cumulative_electric_energy) {
                    values.reverse_electric_energy = {
                        val: properties.reverse_direction_cumulative_electric_energy.val * coefficient * cumulativeUnit,
                        updated_at: properties.reverse_direction_cumulative_electric_energy.updated_at
                    }
                }
            }

            if (properties.measured_instantaneous) {
                values.measured_instantaneous = {
                    val: properties.measured_instantaneous.val,
                    updated_at: properties.measured_instantaneous.updated_at
                }
            }

            return values;
        }

        /**
         * スマートメーターから取得した積算電力量単位を実際の単位(kW)に変換する
         * 未知の値の場合はnullを返す(その値のメトリクス送信のみを諦め、他の値は送信する)
         *
         * @param cumulativeUnit
         * @return {?Number}
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
                    Logger.log(`unknown cumulativeUnit: ${cumulativeUnit}`)
                    return null
            }
        }

        // smart_meterのkeyの存在有無でスマートメーターの値か否かを判定
        // 一旦、スマートメーターを複数設置しないという想定で[0]決め打ち
        const smartMeter = appliances.filter(function (obj) {
            return 'smart_meter' in obj
        })[0]

        // Nature Remo Eを使っていない構成や、APIが一時的に値を返さない場合でも
        // Nature Remo側のメトリクス送信は継続させる
        if (!smartMeter) {
            Logger.log('smart meter is not found in appliances. skip smart meter metrics.')
            return []
        }

        const name = smartMeter.device.name
        const properties = convertSmartMeterProperties(smartMeter.smart_meter.echonetlite_properties);
        const smartMeterValues = convertSmartMeterValues(properties);

        return convertMackerelMetricValue(name, smartMeterValues);
    }

    /**
     * Nature Remo Cloud APIのGET /1/appliancesから取得したJSONから、TARGET_NATURE_REMO_IDで指定されたデバイスで取得できた値を
     * MetricValueの形式に成形して返す
     *
     * @param devices Nature Remo Cloud APIのGET /1/devices から取得したJSONをJSON.parseしたオブジェクト
     * @returns {Object[]}
     */
    function getNatureRemoMetricValue(devices) {
        // newest_eventsのkeyとMackerelのメトリック名の対応
        const eventNames = {
            te: 'temperature',
            hu: 'humidity',
            il: 'illuminance',
            mo: 'human_sensor',
        };

        /**
         * device 1台分をmetricValueのarrayに変換する
         *
         * @param device GET /1/devices の要素
         * @returns {Object[]}
         */
        function convertDevice(device) {
            const newestEvents = device['newest_events'] || {};

            // 搭載センサーは機種によって異なる(例: Remo Lapisは温度・湿度のみ、Remo 3は照度・人感も持つ)ため、
            // 機種で分岐せず、実際に返ってきたkeyだけをメトリクス化する
            const result = {};
            for (const [eventKey, metricName] of Object.entries(eventNames)) {
                if (newestEvents[eventKey]) {
                    result[metricName] = newestEvents[eventKey];
                }
            }

            return convertMackerelMetricValue(device['name'], result);
        }

        const targetIds = (TARGET_NATURE_REMO_ID || '').split(',')
            .map(targetId => targetId.trim())
            .filter(targetId => targetId.length > 0);

        // TARGET_NATURE_REMO_IDが未指定の場合は、取得できた全デバイスを対象にする
        if (targetIds.length === 0) {
            return devices.reduce((metrics, device) => metrics.concat(convertDevice(device)), []);
        }

        return targetIds.reduce(function (metrics, targetId) {
            const device = devices.filter(object => object.id === targetId)[0];

            // 一部のIDが見つからなくても、残りのデバイスとスマートメーターの送信は継続させる
            if (!device) {
                Logger.log(`device is not found. TARGET_NATURE_REMO_ID: ${targetId}. skip this device.`)
                return metrics;
            }

            return metrics.concat(convertDevice(device));
        }, []);
    }

    /**
     * 値の更新が止まっているメトリクスをログに出す
     *
     * デバイスがオフラインになるとNature RemoAPIは最後に取得できた値を返し続けるため、
     * 送信自体は成功していても値が更新されていないことがある
     * メトリクスのタイムスタンプは取得時刻なので、現在時刻との差で判断できる
     *
     * 送信は止めない(判断を誤ったときにメトリクスが失われるのを避けるため)
     *
     * @param {Object[]} metricValue 送信するmetricValueのarray
     */
    function logStaleMetrics(metricValue) {
        const defaultThresholdMinutes = 180;
        const thresholdMinutes = STALE_THRESHOLD_MINUTES
            ? Number(STALE_THRESHOLD_MINUTES)
            : defaultThresholdMinutes;

        if (!Number.isFinite(thresholdMinutes) || thresholdMinutes <= 0) {
            Logger.log(`invalid STALE_THRESHOLD_MINUTES: ${STALE_THRESHOLD_MINUTES}. skip stale check.`)
            return
        }

        const nowSeconds = Math.floor(Date.now() / 1000);

        metricValue.forEach(function (metric) {
            const elapsedMinutes = Math.floor((nowSeconds - metric.time) / 60);
            if (elapsedMinutes < thresholdMinutes) {
                return
            }

            const lastUpdate = new Date(metric.time * 1000).toISOString();
            Logger.log(`stale metric. name: ${metric.name}, last update: ${lastUpdate} (${elapsedMinutes} min ago)`)
        });
    }

    validateScriptProperties()

    const devices = JSON.parse(requestNatureAPI("https://api.nature.global/1/devices").getContentText())
    const natureRemoMetricValue = getNatureRemoMetricValue(devices)
    const appliances = JSON.parse(requestNatureAPI("https://api.nature.global/1/appliances").getContentText())
    const smartMeterMetricValue = getSmartMeterValues(appliances)
    const metricValue = natureRemoMetricValue.concat(smartMeterMetricValue);

    Logger.log(metricValue)

    if (metricValue.length === 0) {
        Logger.log('no metrics to post. skip posting to Mackerel.')
        return
    }

    logStaleMetrics(metricValue)

    postMackerel(metricValue)
}
