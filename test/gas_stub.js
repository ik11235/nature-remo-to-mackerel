/**
 * script.js をGoogle Apps Scriptの外で実行するためのテスト用ヘルパー
 *
 * script.js は clasp でそのままGASへpushするため、module.exports などNode固有の記法を持ち込めない。
 * そこで、GASのグローバルオブジェクト(PropertiesService / UrlFetchApp / Logger / Utilities)を
 * スタブしたvmコンテキストにscript.jsを読み込み、exec()を実行してその結果を観測する。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT_PATH = path.join(__dirname, '..', 'script.js');

/**
 * テストで既定値として使うスクリプトプロパティ
 */
const DEFAULT_PROPERTIES = {
    NATURE_TOKEN: 'nature-token',
    MACKEREL_TOKEN: 'mackerel-token',
    MACKEREL_HOST_ID: 'test-host-id',
    TARGET_NATURE_REMO_ID: 'target-remo-id',
};

/**
 * GASのグローバルをスタブした状態で exec() を実行する
 *
 * @param {Object} options
 * @param {Object[]} [options.devices] GET /1/devices が返すJSON
 * @param {Object[]} [options.appliances] GET /1/appliances が返すJSON
 * @param {Object} [options.properties] スクリプトプロパティ(未指定ならDEFAULT_PROPERTIES)
 * @param {function(string): number} [options.statusFor] urlからHTTPステータスを決める関数
 * @returns {{metrics: Object[], requests: Object[], logs: string[], error: ?Error, sleeps: number[]}}
 *          metrics: Mackerelへ送信されたメトリクス(送信前に落ちた場合は空配列)
 *          requests: UrlFetchApp.fetch の呼び出し履歴
 *          logs: Logger.log の出力
 *          error: exec() が送出したエラー
 *          sleeps: Utilities.sleep に渡されたミリ秒(リトライの間隔確認用)
 */
function runExec(options = {}) {
    const {
        devices = [],
        appliances = [],
        properties = DEFAULT_PROPERTIES,
        statusFor = () => 200,
    } = options;

    const metrics = [];
    const requests = [];
    const logs = [];
    const sleeps = [];

    const sandbox = {
        PropertiesService: {
            getScriptProperties: () => ({
                getProperty: (key) => (key in properties ? properties[key] : null),
            }),
        },
        Logger: {
            log: (message) => logs.push(String(message)),
        },
        Utilities: {
            sleep: (ms) => sleeps.push(ms),
        },
        UrlFetchApp: {
            fetch: (url, fetchOptions) => {
                requests.push({url: url, options: fetchOptions});

                const statusCode = statusFor(url);
                if (fetchOptions.method === 'POST' && statusCode >= 200 && statusCode < 300) {
                    JSON.parse(fetchOptions.payload).forEach((metric) => metrics.push(metric));
                }

                let body = '{}';
                if (url.endsWith('/1/devices')) {
                    body = JSON.stringify(devices);
                } else if (url.endsWith('/1/appliances')) {
                    body = JSON.stringify(appliances);
                }

                return {
                    getResponseCode: () => statusCode,
                    getContentText: () => body,
                };
            },
        },
    };

    vm.createContext(sandbox);

    let error = null;
    try {
        vm.runInContext(`${fs.readFileSync(SCRIPT_PATH, 'utf8')}\nexec();`, sandbox, {filename: SCRIPT_PATH});
    } catch (e) {
        error = e;
    }

    return {metrics: metrics, requests: requests, logs: logs, error: error, sleeps: sleeps};
}

/**
 * newest_events の1項目を組み立てる
 *
 * @param val 値
 * @param [createdAt] 取得時刻(ISO8601)
 */
function sensorEvent(val, createdAt = '2026-09-17T12:23:00Z') {
    return {val: val, created_at: createdAt};
}

/**
 * ECHONET Liteプロパティの1項目を組み立てる
 *
 * @param epc ECHONETプロパティコード
 * @param val 値
 * @param [updatedAt] 取得時刻(ISO8601)
 */
function echonetProperty(epc, val, updatedAt = '2026-09-17T12:23:00Z') {
    return {epc: epc, val: String(val), updated_at: updatedAt};
}

/**
 * メトリクスの配列を {name: value} に畳む(アサーションを読みやすくするため)
 *
 * @param {Object[]} metrics
 */
function toNameValue(metrics) {
    const result = {};
    metrics.forEach((metric) => {
        result[metric.name] = metric.value;
    });
    return result;
}

module.exports = {
    DEFAULT_PROPERTIES,
    runExec,
    sensorEvent,
    echonetProperty,
    toNameValue,
};
