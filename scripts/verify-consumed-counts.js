// 批次消耗次数冒烟测试（Node 环境）：mock 掉小程序运行时与云端数据访问，
// 验证表配置 / 批次键 / 双层白名单 / 卡片装配 / 已做归批 / 计数增减。
// 用法：node scripts/verify-consumed-counts.js
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
const bumpCalls = [];
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

async function testBatchCountMap() {
    rowsByTable.ingredient_consumed_counts = [
        { food_id: 'ing:42', consumed_count: 3 },
        { food_id: 'ing:43', consumed_count: 0 },
        { food_id: 'ing:44', consumed_count: -2 },
        // 历史按食材种类记的行不再读取，不能混进批次字典
        { food_id: 'pork', consumed_count: 9 },
        { food_id: 'ing:', consumed_count: 9 },
        { food_id: 'ing:45', consumed_count: 'abc' },
        { food_id: 'ing:46', consumed_count: '4' },
        null,
    ];
    const map = await stores.batchConsumedCountMap();
    assert.strictEqual(map['42'], 3, '正常次数原样保留');
    assert.strictEqual(map['43'], 0, '0 次就是 0');
    assert.strictEqual(map['44'], 0, '负数兜底为 0，不能出现「消耗 -2 次」');
    assert.strictEqual(map['45'], 0, '非数字兜底为 0');
    assert.strictEqual(map['46'], 4, '字符串数字按数值处理');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(map, 'pork'), false, '历史种类键不进批次字典');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(map, ''), false, '空批次 id 不进字典');
    assert.strictEqual(Object.keys(map).length, 5, '只保留五个带 id 的批次键');

    // 读失败必须退化成「全 0 正常渲染」，不能把冰箱整页拖进错误态。
    listError = { code: 'BOOM', message: '表还没建好' };
    const warned = [];
    const realWarn = console.warn;
    console.warn = function (msg) { warned.push(msg); };
    const empty = await stores.batchConsumedCountMap();
    console.warn = realWarn;
    listError = null;
    assert.deepStrictEqual(empty, {}, '读失败返回空字典');
    assert.strictEqual(warned.length, 1, '读失败要留一条 warn，区分「表没建好」与「确实 0 次」');
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
                        { id: 1, name: '五花肉', food_id: 'pork', zone: 'cold', quantity: '2 盒', expiry_on: '2030-01-01', consumed: false },
                        // 老数据没有 food_id：靠名字归一兜底，仍要能对上次数
                        { id: 2, name: '牛奶', zone: 'cold', quantity: '', consumed: false },
                        { id: 3, name: '豆腐', food_id: 'tofu', zone: 'cold', quantity: '少量', consumed: false },
                        { id: 4, name: '酸奶', food_id: 'yogurt', zone: 'cold', quantity: '', consumed: true },
                        // 同一食材的第二批：次数按批次统计，不继承第一批
                        { id: 5, name: '五花肉', food_id: 'pork', zone: 'cold', quantity: '1 盒', expiry_on: '2031-01-01', consumed: false },
                    ],
                    error: null,
                };
            },
            update: async function () { return { data: null, error: null }; },
        },
        recipes: {
            list: async function () { return { data: [], error: null }; },
        },
        batchConsumedCountMap: async function () {
            // 每批各记各的：第 5 行是另一批五花肉，不继承第 1 行的次数
            return { '1': 5, '2': 2, '5': 1 };
        },
        cookCountMap: async function () { return {}; },
        bumpCookCount: async function () { return { data: 1, error: null }; },
        bumpBatchConsumed: async function (id, delta) {
            bumpCalls.push({ id: id, delta: delta });
            return { data: 1, error: null };
        },
    },
    '../../utils/recommend': {
        DAYS_MIN: 3,
        DAYS_MAX: 30,
        DAYS_DEFAULT: 10,
        SORTS: [],
        clampDays: function (n) { return n; },
        rank: function () {
            return {
                ready: [{ key: 'b1', name: '五花肉小炒', emoji: '🍲', used: ['pork'], mainItems: ['猪肉'] }],
                missing: [],
            };
        },
        profile: function () { return { total: 2, urgent: 1 }; },
        pager: function (total) {
            return { count: total, visible: total, showTen: false, showAll: false, showCollapse: false };
        },
    },
    '../../utils/recipes': {},
    '../../utils/ai': {},
    '../../utils/food-dict': {
        resolve: function () { return {}; },
        meta: function () { return {}; },
        canonicalOf: function (id) { return id; },
        resolveId: function (name) { return name === '牛奶' ? 'milk' : ''; },
    },
    '../../utils/food-names': {
        decorate: function (row) {
            const id = row.food_id || (pageStubs['../../utils/food-dict'].resolveId(row.name) || ('custom:' + row.name));
            return Object.assign({}, row, { food_id: id, display: row.name, canonical: row.name });
        },
        decorateList: function (rows) {
            return (rows || []).map(pageStubs['../../utils/food-names'].decorate);
        },
        labelOf: function (name) { return name; },
        displayName: function () { return ''; },
    },
    '../../utils/subscribe': {
        expiringNamesText: function () { return ''; },
        alertCopy: function () { return { title: '', tip: '', tone: '' }; },
    },
};

function loadPage(pagePath) {
    let options = null;
    global.Page = function (pageOptions) { options = pageOptions; };
    const original = Module._load;
    Module._load = function (request) {
        if (Object.prototype.hasOwnProperty.call(pageStubs, request)) return pageStubs[request];
        return original.apply(this, arguments);
    };
    const fullPath = path.join(root, 'pages', pagePath);
    // 同一个页面测两次时要重新执行 Page()，否则 require 缓存会把 options 留空。
    delete require.cache[require.resolve(fullPath)];
    require(fullPath);
    Module._load = original;
    return options;
}

async function testCardBadge() {
    const options = loadPage(path.join('index', 'index.js'));
    const page = Object.assign({}, options, { data: JSON.parse(JSON.stringify(options.data)) });
    page.setData = function (patch) {
        const that = this;
        Object.keys(patch).forEach(function (key) { that.data[key] = patch[key]; });
    };

    await page.loadData();
    const zoneItems = page.data.zoneItems || [];
    assert.strictEqual(zoneItems.length, 4, '已消耗的行不进入冰箱列表');
    assert.strictEqual(zoneItems[0].consumedCount, 5);
    assert.strictEqual(zoneItems[0].consumedLabel, '已消耗 5 次');
    assert.strictEqual(zoneItems[1].consumedLabel, '已消耗 2 次', '没有 food_id 的老行也要按批次 id 对上次数');
    assert.strictEqual(zoneItems[2].consumedCount, 0);
    assert.strictEqual(zoneItems[2].consumedLabel, '', '0 次不占版面：模板用 wx:if 直接不渲染');
    assert.strictEqual(zoneItems[3].consumedCount, 1, '同一食材的第二批按自己的计数走');
    assert.strictEqual(zoneItems[3].consumedLabel, '已消耗 1 次', '新批次不继承旧批次的次数');
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

// ---- 「已做」只给最早到期的那一批 +1，撤销也只动那一批 ----
async function testBatchBumpOnCook() {
    bumpCalls.length = 0;
    const options = loadPage(path.join('alchemy', 'alchemy.js'));
    const page = Object.assign({}, options, { data: JSON.parse(JSON.stringify(options.data)) });
    page.setData = function (patch) {
        const that = this;
        Object.keys(patch).forEach(function (key) { that.data[key] = patch[key]; });
    };

    await page.loadData();
    assert.strictEqual((page.readyAll || []).length, 1, '推荐列表应有一道菜');

    // flashCooked 的 4 秒回退计时器留着只会拖慢测试进程
    const realSetTimeout = global.setTimeout;
    global.setTimeout = function () { return 0; };
    await page.onMarkCook({ currentTarget: { dataset: { key: 'b1' } } });
    global.setTimeout = realSetTimeout;

    assert.strictEqual(bumpCalls.length, 1, '一样主料只给一批 +1');
    assert.strictEqual(bumpCalls[0].id, 1, '记到最早到期的那一批');
    assert.strictEqual(bumpCalls[0].delta, 1);

    await page.onUndoCook();
    assert.strictEqual(bumpCalls.length, 2, '撤销同样只动那一批');
    assert.strictEqual(bumpCalls[1].id, 1);
    assert.strictEqual(bumpCalls[1].delta, -1);
}

// ---- 临期相同时按先买先算：added_on 早的批次优先，不依赖列表顺序 ----
async function testSameExpiryBatchOrder() {
    bumpCalls.length = 0;
    const storeStub = pageStubs['../../utils/store'];
    const originalList = storeStub.ingredients.list;
    storeStub.ingredients.list = async function () {
        return {
            data: [
                // 故意把晚买的排在前面，验证不是靠云端返回顺序
                { id: 11, name: '五花肉', food_id: 'pork', zone: 'cold', quantity: '1 盒', expiry_on: '2030-06-01', added_on: '2026-02-01', consumed: false },
                { id: 12, name: '五花肉', food_id: 'pork', zone: 'cold', quantity: '1 盒', expiry_on: '2030-06-01', added_on: '2026-01-15', consumed: false },
            ],
            error: null,
        };
    };

    try {
        const options = loadPage(path.join('alchemy', 'alchemy.js'));
        const page = Object.assign({}, options, { data: JSON.parse(JSON.stringify(options.data)) });
        page.setData = function (patch) {
            const that = this;
            Object.keys(patch).forEach(function (key) { that.data[key] = patch[key]; });
        };

        await page.loadData();
        const realSetTimeout = global.setTimeout;
        global.setTimeout = function () { return 0; };
        await page.onMarkCook({ currentTarget: { dataset: { key: 'b1' } } });
        global.setTimeout = realSetTimeout;

        assert.strictEqual(bumpCalls.length, 1);
        assert.strictEqual(bumpCalls[0].id, 12, '同一天到期时，先买的批次优先');
    } finally {
        storeStub.ingredients.list = originalList;
    }
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
    const one = await stores.bumpBatchConsumed(77, 1);
    assert.strictEqual(one.data, 1, '批次消耗次数同样支持首建');
    assert.strictEqual(rowsByTable.ingredient_consumed_counts[0].food_id, 'ing:77', '键是批次 id，和历史种类键区分开');
    assert.strictEqual(rowsByTable.ingredient_consumed_counts[0].household_key, '', '写入带上当前作用域');
    const two = await stores.bumpBatchConsumed(77, 1);
    assert.strictEqual(two.data, 2, '同一批次继续累计');
    const other = await stores.bumpBatchConsumed(78, 1);
    assert.strictEqual(other.data, 1, '另一批从 0 开始，不继承');
    assert.strictEqual(rowsByTable.ingredient_consumed_counts.length, 2, '每批只留一行');
    const batchDown = await stores.bumpBatchConsumed(77, -5);
    assert.strictEqual(batchDown.data, 1, '一次只挪一步');
    const batchFloor = await stores.bumpBatchConsumed(77, -1);
    assert.strictEqual(batchFloor.data, 0, '减到底也只到 0，不能出现负数');
    const batchMissing = await stores.bumpBatchConsumed('', 1);
    assert.ok(batchMissing.error, '没有批次 id 直接报错，不发请求');
}

(async function run() {
    testTableConfig();
    await testBatchCountMap();
    await testBumpCounts();
    await testCardBadge();
    await testBatchBumpOnCook();
    await testSameExpiryBatchOrder();
    console.log('PASS 食材消耗次数：表配置 / 白名单 / 批次字典兜底 / 卡片装配 / 计数增减 / 已做归批 / 同临期排序');
})().catch(function (error) {
    console.error('FAIL', error && error.message);
    process.exit(1);
});
