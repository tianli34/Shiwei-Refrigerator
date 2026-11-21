// 食材已消耗次数冒烟测试（Node 环境）：mock 掉小程序运行时与云端数据访问，
// 验证表配置 / 双层白名单 / 字典兜底 / 冰箱卡片装配。用法：node scripts/verify-consumed-counts.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.resolve(__dirname, '..', 'miniprogram');
const base = path.join(root, 'utils');

global.wx = {
    getStorageSync: function () { return ''; },
    setStorageSync: function () {},
    removeStorageSync: function () {},
    showToast: function () {},
    showModal: function (options) { if (options && options.success) options.success({ confirm: false }); },
};
global.getApp = function () {
    return { householdKey: '', userId: 'u1', userName: 'tester', playDoorSound: function () {} };
};

// ---- 云端桩：只记录每个表拿到的配置，list 返回预置行 ----
const tableConfigs = {};
const rowsByTable = {};
let listError = null;

const accessStub = {
    createTableAccess: function (cloud, config) {
        tableConfigs[config.table] = config;
        return {
            config: config,
            list: async function () {
                if (listError) return { data: [], error: listError };
                return { data: (rowsByTable[config.table] || []).slice(), error: null };
            },
            create: async function (row) {
                const list = rowsByTable[config.table] = rowsByTable[config.table] || [];
                const saved = Object.assign({ id: 'new-' + list.length }, row);
                list.push(saved);
                return { data: saved, error: null };
            },
            update: async function (id, patch) {
                const list = rowsByTable[config.table] || [];
                const hit = list.filter(function (row) { return String(row.id) === String(id); })[0];
                if (!hit) return { data: null, error: { code: 'NOT_FOUND_OR_FORBIDDEN' } };
                Object.assign(hit, patch);
                return { data: hit, error: null };
            },
            remove: async function () { return { data: null, error: null }; },
        };
    },
};

const realLoad = Module._load;
Module._load = function (request) {
    if (request === './cloud') return { cloud: {} };
    if (request === './workbuddy-data-access') return accessStub;
    return realLoad.apply(this, arguments);
};
const stores = require(path.join(base, 'store.js'));
Module._load = realLoad;

function testTableConfig() {
    const config = tableConfigs.ingredient_consumed_counts;
    assert.ok(config, '应注册 ingredient_consumed_counts 表');
    assert.strictEqual(config.table, 'ingredient_consumed_counts');

    // 双层白名单：columns 少写会被读取丢掉，FIELDS 少写会在写入时丢掉。
    // 硬编码 columns 里少写一个字段时，select 回来就没有它，toRow 也无从拷贝。
    const columns = config.columns;
    ['id', 'owner_id', 'owner_name', 'household_key', 'food_id', 'consumed_count', 'created_at']
        .forEach(function (name) {
            assert.ok(columns.indexOf(name) >= 0, 'columns 缺少 ' + name);
        });
    assert.strictEqual(columns.indexOf('food_id') > 0, true, 'food_id 必须在 select 列表里');

    const row = config.toRow({
        id: 7, owner_id: 'secret-owner', owner_name: '小美', household_key: 'hk1',
        food_id: 'pork', consumed_count: 3, created_at: '2026-11-20T00:00:00Z',
    });
    assert.deepStrictEqual(row, {
        owner_name: '小美', household_key: 'hk1', food_id: 'pork', consumed_count: 3,
    }, 'toRow 白名单必须丢掉 owner_id / id / created_at');

    // 前端伪造 owner_id 不该有机会写进库：owner 由服务端 DEFAULT auth.uid() 与 RLS 决定。
    const forged = config.toRow({ owner_id: 'forged', food_id: 'egg', consumed_count: 1, household_key: '' });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(forged, 'owner_id'), false, 'owner_id 不进白名单');
    assert.deepStrictEqual(Object.keys(forged).sort(), ['consumed_count', 'food_id', 'household_key'], '只留可写字段');
}

async function testCountMap() {
    rowsByTable.ingredient_consumed_counts = [
        { food_id: 'pork', consumed_count: 3 },
        { food_id: 'egg', consumed_count: 0 },
        { food_id: 'milk', consumed_count: -2 },
        { food_id: '', consumed_count: 9 },
        { food_id: 'tofu', consumed_count: 'abc' },
        { food_id: 'rice', consumed_count: '4' },
        null,
    ];
    const map = await stores.consumedCountMap();
    assert.strictEqual(map.pork, 3, '正常次数原样保留');
    assert.strictEqual(map.egg, 0, '0 次就是 0');
    assert.strictEqual(map.milk, 0, '负数兜底为 0，不能出现「吃掉 -2 次」');
    assert.strictEqual(map.tofu, 0, '非数字兜底为 0');
    assert.strictEqual(map.rice, 4, '字符串数字按数值处理');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(map, ''), false, '空 food_id 不进字典');
    assert.strictEqual(Object.keys(map).length, 5, '空 key 与 null 行被跳过');

    // 读失败必须退化成「全 0 正常渲染」，不能把冰箱整页拖进错误态。
    listError = { code: 'BOOM', message: '表还没建好' };
    const warned = [];
    const realWarn = console.warn;
    console.warn = function (msg) { warned.push(msg); };
    const empty = await stores.consumedCountMap();
    console.warn = realWarn;
    listError = null;
    assert.deepStrictEqual(empty, {}, '读失败返回空字典');
    assert.strictEqual(warned.length, 1, '读失败要留一条 warn，区分钟「表没建好」与「确实 0 次」');
}

// ---- 冰箱卡片装配：用页面桩跑 loadData，确认徽章文案与 legacy 行兜底 ----
const pageStubs = {
    '../../utils/auth': {
        createAuthMixin: function (options) {
            return Object.assign({}, options, {
                onShow: function () {}, restore: function () {}, onSignedIn: function () {},
                onRetryAuth: function () {}, onSignOut: function () {},
            });
        },
    },
    '../../utils/store': {
        ingredients: {
            list: async function () {
                return {
                    data: [
                        { id: 1, name: '五花肉', food_id: 'pork', zone: 'cold', quantity: '2 盒', consumed: false },
                        // 老数据没有 food_id：靠名字归一兜底，仍要能对上次数
                        { id: 2, name: '牛奶', zone: 'cold', quantity: '', consumed: false },
                        { id: 3, name: '豆腐', food_id: 'tofu', zone: 'cold', quantity: '少量', consumed: false },
                        { id: 4, name: '酸奶', food_id: 'yogurt', zone: 'cold', quantity: '', consumed: true },
                    ],
                    error: null,
                };
            },
        },
        consumedCountMap: async function () {
            return { pork: 5, milk: 2, tofu: 0 };
        },
    },
    '../../utils/ai': {},
    '../../utils/food-dict': {
        resolve: function () { return {}; },
        meta: function () { return {}; },
        resolveId: function (name) { return name === '牛奶' ? 'milk' : ''; },
    },
    '../../utils/food-names': {
        decorate: function (row) {
            const id = row.food_id || (pageStubs['../../utils/food-dict'].resolveId(row.name) || ('custom:' + row.name));
            return Object.assign({}, row, { food_id: id, display: row.name, canonical: row.name });
        },
        labelOf: function (name) { return name; },
        displayName: function () { return ''; },
    },
    '../../utils/subscribe': {
        expiringNamesText: function () { return ''; },
        alertCopy: function () { return { title: '', tip: '', tone: '' }; },
    },
};

function loadPage() {
    let options = null;
    global.Page = function (pageOptions) { options = pageOptions; };
    const original = Module._load;
    Module._load = function (request) {
        if (Object.prototype.hasOwnProperty.call(pageStubs, request)) return pageStubs[request];
        return original.apply(this, arguments);
    };
    require(path.join(root, 'pages', 'index', 'index.js'));
    Module._load = original;
    return options;
}

async function testCardBadge() {
    const options = loadPage();
    const page = Object.assign({}, options, { data: JSON.parse(JSON.stringify(options.data)) });
    page.setData = function (patch) {
        const that = this;
        Object.keys(patch).forEach(function (key) { that.data[key] = patch[key]; });
    };

    await page.loadData();
    const zoneItems = page.data.zoneItems || [];
    assert.strictEqual(zoneItems.length, 3, '已消耗的行不进入冰箱列表');
    assert.strictEqual(zoneItems[0].consumedCount, 5);
    assert.strictEqual(zoneItems[0].consumedLabel, '已吃掉 5 次');
    assert.strictEqual(zoneItems[1].consumedLabel, '已吃掉 2 次', '没有 food_id 的老行要按名字归一后仍能计数');
    assert.strictEqual(zoneItems[2].consumedCount, 0);
    assert.strictEqual(zoneItems[2].consumedLabel, '', '0 次不占版面：模板用 wx:if 直接不渲染');
    assert.strictEqual(page.data.viewState, 'ready');

    // 徽章模板与样式是这条链路的落点，删掉等于功能消失，锁死关键字。
    const wxml = fs.readFileSync(path.join(root, 'pages', 'index', 'index.wxml'), 'utf8');
    assert.ok(wxml.indexOf('food-consumed') >= 0, 'index.wxml 必须渲染消耗徽章');
    assert.ok(wxml.indexOf('item.consumedLabel') >= 0, '徽章文案由页面装配，不在模板里拼数字');
    assert.ok(
        wxml.split('\n').some(function (line) {
            return line.indexOf('food-consumed') >= 0 && line.indexOf('consumedCount > 0') >= 0;
        }),
        '0 次必须整枚徽章不渲染'
    );
    const wxss = fs.readFileSync(path.join(root, 'pages', 'index', 'index.wxss'), 'utf8');
    assert.ok(wxss.indexOf('.food-consumed') >= 0, '次数徽章要有自己的样式');
}

// ---- 计数自增 / 自减：没有计数行就先建一行，减到 0 为止不写负数 ----
async function testBumpCounts() {
    rowsByTable.recipe_cook_counts = [
        { id: 'r1', household_key: '', recipe_key: 'b2', cook_count: 2 },
    ];
    const up = await stores.bumpCookCount('b2', 1);
    assert.strictEqual(up.data, 3, '已有行按绝对值 +1');
    assert.strictEqual(rowsByTable.recipe_cook_counts[0].cook_count, 3);
    const down = await stores.bumpCookCount('b2', -1);
    assert.strictEqual(down.data, 2, '撤销就是 -1');

    const created = await stores.bumpCookCount('b9', 1);
    assert.strictEqual(created.data, 1, '第一次做就建一行，从 1 开始');
    assert.strictEqual(rowsByTable.recipe_cook_counts.filter(function (row) { return row.recipe_key === 'b9'; }).length, 1, '同一道菜只留一行');

    const floor = await stores.bumpCookCount('b9', -5);
    assert.strictEqual(floor.data, 0, '减到底也只到 0，不能出现负数');
    assert.strictEqual(rowsByTable.recipe_cook_counts.filter(function (row) { return row.recipe_key === 'b9'; })[0].cook_count, 0);

    const missing = await stores.bumpCookCount('', 1);
    assert.ok(missing.error, '没有计数键直接报错，不发请求');

    rowsByTable.ingredient_consumed_counts = [];
    const one = await stores.bumpConsumedCount('pork', 1);
    assert.strictEqual(one.data, 1, '食材消耗次数同样支持首建');
    assert.strictEqual(rowsByTable.ingredient_consumed_counts[0].food_id, 'pork');
    assert.strictEqual(rowsByTable.ingredient_consumed_counts[0].household_key, '', '写入带上当前作用域');
}

(async function run() {
    testTableConfig();
    await testCountMap();
    await testBumpCounts();
    await testCardBadge();
    console.log('PASS 食材已消耗次数：表配置 / 白名单 / 字典兜底 / 卡片装配 / 计数增减');
})().catch(function (error) {
    console.error('FAIL', error && error.message);
    process.exit(1);
});
