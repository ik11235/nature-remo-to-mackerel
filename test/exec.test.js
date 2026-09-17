const test = require('node:test');
const assert = require('node:assert');

const {runExec, sensorEvent, echonetProperty, toNameValue, DEFAULT_PROPERTIES} = require('./gas_stub');

const TARGET_ID = DEFAULT_PROPERTIES.TARGET_NATURE_REMO_ID;

/**
 * 温度・湿度・照度・人感をすべて持つデバイス(Remo 3相当)
 */
function fullSensorDevice(name = 'Remo 3') {
    return [{
        id: TARGET_ID,
        name: name,
        newest_events: {
            te: sensorEvent(22.8),
            hu: sensorEvent(68),
            il: sensorEvent(110),
            mo: sensorEvent(1),
        },
    }];
}

/**
 * 温度・湿度のみを持つデバイス(Remo Lapis相当)
 */
function temperatureAndHumidityDevice(name = 'Remo Lapis') {
    return [{
        id: TARGET_ID,
        name: name,
        newest_events: {
            te: sensorEvent(22.8),
            hu: sensorEvent(68),
        },
    }];
}

/**
 * スマートメーターのappliances
 *
 * @param {Object[]} [properties] echonetlite_properties(未指定なら全項目そろった状態)
 */
function smartMeterAppliances(properties) {
    return [{
        device: {name: 'Remo E lite'},
        smart_meter: {
            echonetlite_properties: properties || [
                echonetProperty(224, 37569), // 正方向積算電力量
                echonetProperty(227, 11),    // 逆方向積算電力量
                echonetProperty(211, 1),     // 係数
                echonetProperty(225, 1),     // 積算電力量単位(0x01 = 0.1kWh)
                echonetProperty(215, 6),     // 有効桁数
                echonetProperty(231, 504),   // 瞬時電力
            ],
        },
    }];
}

/**
 * 指定したepcを除いたechonetlite_properties
 */
function echonetPropertiesWithout(...excludedEpcs) {
    return smartMeterAppliances()[0].smart_meter.echonetlite_properties
        .filter((property) => !excludedEpcs.includes(property.epc));
}

test('Nature Remoのセンサー値', async (t) => {
    await t.test('搭載センサーがすべて値を返す場合、4項目すべてを送信する', () => {
        const result = runExec({devices: fullSensorDevice()});

        assert.deepStrictEqual(toNameValue(result.metrics), {
            'Remo_3.temperature': 22.8,
            'Remo_3.humidity': 68,
            'Remo_3.illuminance': 110,
            'Remo_3.human_sensor': 1,
        });
    });

    await t.test('照度・人感を持たない機種では、返ってきた項目だけを送信する', () => {
        const result = runExec({devices: temperatureAndHumidityDevice()});

        assert.deepStrictEqual(toNameValue(result.metrics), {
            'Remo_Lapis.temperature': 22.8,
            'Remo_Lapis.humidity': 68,
        });
    });

    await t.test('未搭載センサーについてはログを出さない', () => {
        const result = runExec({devices: temperatureAndHumidityDevice()});

        assert.deepStrictEqual(result.logs.filter((log) => log.startsWith('skip metric')), []);
    });

    await t.test('device名の空白はアンダースコアに置換する', () => {
        const result = runExec({devices: temperatureAndHumidityDevice('living room remo')});

        assert.ok(Object.keys(toNameValue(result.metrics)).every((name) => name.startsWith('living_room_remo.')));
    });

    await t.test('created_atをepoch秒に変換して送信する', () => {
        const devices = [{
            id: TARGET_ID,
            name: 'remo',
            newest_events: {te: sensorEvent(22.8, '2026-09-17T12:23:00Z')},
        }];

        const result = runExec({devices: devices});

        assert.strictEqual(result.metrics[0].time, Math.floor(Date.UTC(2026, 8, 17, 12, 23, 0) / 1000));
    });

    await t.test('MACKEREL_HOST_IDをhostIdに設定する', () => {
        const result = runExec({devices: temperatureAndHumidityDevice()});

        assert.ok(result.metrics.every((metric) => metric.hostId === DEFAULT_PROPERTIES.MACKEREL_HOST_ID));
    });

    await t.test('newest_eventsを持たないデバイスでも落ちない', () => {
        const result = runExec({devices: [{id: TARGET_ID, name: 'remo'}], appliances: smartMeterAppliances()});

        assert.strictEqual(result.error, null);
        assert.ok(result.metrics.every((metric) => metric.name.startsWith('Remo_E_lite.')));
    });

    await t.test('数値に変換できない値はスキップし、ログを残す', () => {
        const devices = [{
            id: TARGET_ID,
            name: 'remo',
            newest_events: {te: sensorEvent('not-a-number'), hu: sensorEvent(68)},
        }];

        const result = runExec({devices: devices});

        assert.deepStrictEqual(toNameValue(result.metrics), {'remo.humidity': 68});
        assert.ok(result.logs.some((log) => log.includes('skip metric. invalid value. name: remo.temperature')));
    });

    await t.test('TARGET_NATURE_REMO_IDに一致するデバイスが無い場合、スマートメーター側の送信は継続する', () => {
        const devices = [{id: 'other-remo-id', name: 'other', newest_events: {te: sensorEvent(22.8)}}];

        const result = runExec({devices: devices, appliances: smartMeterAppliances()});

        assert.strictEqual(result.error, null);
        assert.ok(result.metrics.every((metric) => metric.name.startsWith('Remo_E_lite.')));
        assert.ok(result.logs.some((log) => log.includes('device is not found')));
    });
});

test('スマートメーターの値', async (t) => {
    await t.test('係数と積算電力量単位を掛けた値を送信する', () => {
        const result = runExec({appliances: smartMeterAppliances()});

        assert.deepStrictEqual(toNameValue(result.metrics), {
            'Remo_E_lite.normal_electric_energy': 3756.9,
            'Remo_E_lite.reverse_electric_energy': 1.1,
            'Remo_E_lite.measured_instantaneous': 504,
        });
    });

    await t.test('updated_atをepoch秒に変換して送信する', () => {
        const result = runExec({appliances: smartMeterAppliances()});

        assert.ok(result.metrics.every((metric) => metric.time === Math.floor(Date.UTC(2026, 8, 17, 12, 23, 0) / 1000)));
    });

    await t.test('逆方向積算電力量(epc 227)を返さないメーターでも、他の値を送信する', () => {
        const result = runExec({appliances: smartMeterAppliances(echonetPropertiesWithout(227))});

        assert.strictEqual(result.error, null);
        assert.deepStrictEqual(toNameValue(result.metrics), {
            'Remo_E_lite.normal_electric_energy': 3756.9,
            'Remo_E_lite.measured_instantaneous': 504,
        });
    });

    await t.test('係数(epc 211)が無い場合は係数1として扱う', () => {
        const result = runExec({appliances: smartMeterAppliances(echonetPropertiesWithout(211))});

        assert.strictEqual(toNameValue(result.metrics)['Remo_E_lite.normal_electric_energy'], 3756.9);
    });

    await t.test('係数が1以外の場合、積算電力量に反映する', () => {
        const properties = echonetPropertiesWithout(211).concat([echonetProperty(211, 10)]);

        const result = runExec({appliances: smartMeterAppliances(properties)});

        assert.strictEqual(toNameValue(result.metrics)['Remo_E_lite.normal_electric_energy'], 37569);
    });

    await t.test('積算電力量単位(epc 225)が無い場合、積算電力量のみスキップする', () => {
        const result = runExec({appliances: smartMeterAppliances(echonetPropertiesWithout(225))});

        assert.deepStrictEqual(toNameValue(result.metrics), {'Remo_E_lite.measured_instantaneous': 504});
        assert.ok(result.logs.some((log) => log.includes('skip cumulative electric energy')));
    });

    await t.test('未知の積算電力量単位の場合、例外を投げずにスキップする', () => {
        const properties = echonetPropertiesWithout(225).concat([echonetProperty(225, 0xFF)]);

        const result = runExec({appliances: smartMeterAppliances(properties)});

        assert.strictEqual(result.error, null);
        assert.deepStrictEqual(toNameValue(result.metrics), {'Remo_E_lite.measured_instantaneous': 504});
        assert.ok(result.logs.some((log) => log.includes('unknown cumulativeUnit: 255')));
    });

    await t.test('スマートメーターが無い構成では、Nature Remo側の送信は継続する', () => {
        const result = runExec({devices: temperatureAndHumidityDevice(), appliances: []});

        assert.strictEqual(result.error, null);
        assert.deepStrictEqual(Object.keys(toNameValue(result.metrics)), [
            'Remo_Lapis.temperature',
            'Remo_Lapis.humidity',
        ]);
        assert.ok(result.logs.some((log) => log.includes('smart meter is not found')));
    });
});

test('HTTPリクエスト', async (t) => {
    const natureApi = (url) => url.includes('api.nature.global');
    const mackerelApi = (url) => url.includes('api.mackerelio.com');

    await t.test('Nature APIにBearerトークンを付与する', () => {
        const result = runExec({devices: temperatureAndHumidityDevice()});
        const request = result.requests.find((r) => natureApi(r.url));

        assert.strictEqual(request.options.headers.Authorization, `Bearer ${DEFAULT_PROPERTIES.NATURE_TOKEN}`);
    });

    await t.test('MackerelにAPIキーを付与してPOSTする', () => {
        const result = runExec({devices: temperatureAndHumidityDevice()});
        const request = result.requests.find((r) => mackerelApi(r.url));

        assert.strictEqual(request.options.method, 'POST');
        assert.strictEqual(request.options.headers['X-Api-Key'], DEFAULT_PROPERTIES.MACKEREL_TOKEN);
    });

    await t.test('ステータスを自前で判定するためmuteHttpExceptionsを有効にする', () => {
        const result = runExec({devices: temperatureAndHumidityDevice()});

        assert.ok(result.requests.every((request) => request.options.muteHttpExceptions === true));
    });

    await t.test('429のあと成功した場合、リトライして送信を完了する', () => {
        let natureCallCount = 0;
        const statusFor = (url) => {
            if (!natureApi(url)) {
                return 200;
            }
            natureCallCount += 1;
            return natureCallCount === 1 ? 429 : 200;
        };

        const result = runExec({devices: temperatureAndHumidityDevice(), statusFor: statusFor});

        assert.strictEqual(result.error, null);
        assert.deepStrictEqual(result.sleeps, [1000]);
        assert.strictEqual(Object.keys(toNameValue(result.metrics)).length, 2);
    });

    await t.test('429が続く場合、指数バックオフで3回試行してから失敗する', () => {
        const result = runExec({
            devices: temperatureAndHumidityDevice(),
            statusFor: (url) => (natureApi(url) ? 429 : 200),
        });

        assert.deepStrictEqual(result.sleeps, [1000, 2000]);
        assert.strictEqual(result.requests.filter((r) => natureApi(r.url)).length, 3);
        assert.match(result.error.message, /status: 429/);
    });

    await t.test('5xxもリトライ対象にする', () => {
        const result = runExec({
            devices: temperatureAndHumidityDevice(),
            statusFor: (url) => (natureApi(url) ? 503 : 200),
        });

        assert.strictEqual(result.requests.filter((r) => natureApi(r.url)).length, 3);
    });

    await t.test('4xx(429以外)はリトライせずに失敗する', () => {
        const result = runExec({
            devices: temperatureAndHumidityDevice(),
            statusFor: (url) => (natureApi(url) ? 401 : 200),
        });

        assert.strictEqual(result.requests.filter((r) => natureApi(r.url)).length, 1);
        assert.deepStrictEqual(result.sleeps, []);
        assert.match(result.error.message, /status: 401/);
    });

    await t.test('Mackerelへの送信に失敗した場合、ペイロードをログに残して失敗する', () => {
        const result = runExec({
            devices: temperatureAndHumidityDevice(),
            statusFor: (url) => (mackerelApi(url) ? 400 : 200),
        });

        assert.match(result.error.message, /status: 400/);
        assert.ok(result.logs.some((log) => log.includes('failed to post metrics to Mackerel')
            && log.includes('Remo_Lapis.temperature')));
    });
});

test('スクリプトプロパティの検証', async (t) => {
    await t.test('未設定のプロパティがある場合、APIを呼ばずに失敗する', () => {
        const properties = Object.assign({}, DEFAULT_PROPERTIES, {MACKEREL_HOST_ID: null});

        const result = runExec({devices: temperatureAndHumidityDevice(), properties: properties});

        assert.match(result.error.message, /script property is not set: MACKEREL_HOST_ID/);
        assert.deepStrictEqual(result.requests, []);
    });

    await t.test('未設定のプロパティをすべて列挙する', () => {
        const result = runExec({properties: {}});

        assert.match(
            result.error.message,
            /script property is not set: NATURE_TOKEN, MACKEREL_TOKEN, MACKEREL_HOST_ID, TARGET_NATURE_REMO_ID/,
        );
    });
});

test('送信するメトリクスが無い場合', async (t) => {
    await t.test('Mackerelへリクエストせずに終了する', () => {
        const result = runExec({devices: [], appliances: []});

        assert.strictEqual(result.error, null);
        assert.deepStrictEqual(result.requests.filter((r) => r.url.includes('api.mackerelio.com')), []);
        assert.ok(result.logs.some((log) => log.includes('no metrics to post')));
    });
});
