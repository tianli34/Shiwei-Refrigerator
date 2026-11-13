// 核心逻辑冒烟测试（Node 环境）：mock 掉小程序运行时与云端，验证
// 同物异名归一、展示名优先级、外部受众回退、菜谱 ID 匹配。
// 用法：node scripts/verify-food-names.js
const assert = require('assert');
const Module = require('module');
const path = require('path');

const memory = {};
global.wx = {
    getStorageSync: function (key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : ''; },
    setStorageSync: function (key, value) { memory[key] = value; },
    showActionSheet: function () {},
};
global.getApp = function () {
    return { householdKey: '', userId: 'u1', userName: 'tester' };
};

const prefRows = [];
const settingRows = [];
const fakeStore = {
    foodNamePrefs: {
        list: async function () { return { data: prefRows.slice(), error: null }; },
        create: async function (row) {
            prefRows.push(Object.assign({ id: prefRows.length + 1, owner_id: 'u1' }, row));
            return { data: row, error: null };
        },
        update: async function (id, patch) { return { data: patch, error: null }; },
        remove: async function (id) {
            const index = prefRows.findIndex(function (row) { return row.id === id; });
            if (index >= 0) prefRows.splice(index, 1);
            return { data: null, error: null };
        },
    },
    foodNameSettings: {
        list: async function () { return { data: settingRows.slice(), error: null }; },
        create: async function (row) {
            settingRows.push(Object.assign({ id: settingRows.length + 1, owner_id: 'u1' }, row));
            return { data: row, error: null };
        },
        update: async function (id, patch) {
            const hit = settingRows.filter(function (row) { return row.id === id; })[0];
            if (hit) Object.assign(hit, patch);
            return { data: patch, error: null };
        },
    },
    scope: function (payload) {
        return Object.assign({ household_key: '', owner_name: 'tester' }, payload);
    },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === './cloud') return { cloud: { database: { from: function () { return {}; } } }, publicConfig: {} };
    if (request === './store') return fakeStore;
    return originalLoad.apply(this, arguments);
};

const base = path.resolve(__dirname, '..', 'miniprogram', 'utils');
const dict = require(path.join(base, 'food-dict.js'));
const foodNames = require(path.join(base, 'food-names.js'));
const recipes = require(path.join(base, 'recipes.js'));
const ai = require(path.join(base, 'ai.js'));

async function main() {
    const tomato = dict.resolveId('番茄');
    assert.strictEqual(dict.resolveId('西红柿'), tomato, '番茄 / 西红柿应归一到同一身份');
    assert.strictEqual(dict.resolveId('洋柿子'), tomato, '洋柿子应归一到番茄');
    const potato = dict.resolveId('土豆');
    assert.strictEqual(dict.resolveId('马铃薯'), potato, '土豆 / 马铃薯应归一');
    assert.strictEqual(dict.resolveId('洋芋'), potato, '洋芋应归一到土豆');
    assert.notStrictEqual(tomato, potato, '不同实体不能合并');
    assert.strictEqual(dict.resolve('番瓜').status, 'ambiguous', '番瓜应触发歧义确认');
    assert.strictEqual(dict.resolve('custom:洋山芋').id, 'custom:洋山芋', '自定义身份应稳定复用');
    assert.strictEqual(recipes.hasIngredient(['西红柿'], '番茄'), true, '菜谱匹配应按身份相等');
    assert.strictEqual(recipes.hasIngredient(['番茄'], '土豆'), false, '不同食材不应模糊命中');

    await foodNames.init();
    assert.strictEqual(foodNames.displayName(potato), '土豆', '默认应显示通用主名');
    await foodNames.setRegion('southwest');
    assert.strictEqual(foodNames.displayName(potato), '洋芋', '川渝词包应生效');
    await foodNames.setPreference(potato, '洋山芋', { scope: 'personal' });
    assert.strictEqual(foodNames.displayName(potato), '洋山芋', '个人显式覆盖应高于词包');
    await foodNames.setPreference(potato, '山药蛋', { scope: 'household' });
    await foodNames.setHouseholdUnified(true);
    assert.strictEqual(foodNames.displayName(potato), '山药蛋', '家庭统一叫法应高于个人覆盖');
    assert.strictEqual(foodNames.displayName(potato, foodNames.CTX_EXTERNAL), '土豆', '外部受众应回退通用主名');
    assert.strictEqual(foodNames.labelOf('洋芋'), '山药蛋', 'labelOf 应把任意叫法翻译成展示名');

    const decorated = foodNames.decorate({ name: '西红柿' });
    assert.strictEqual(decorated.food_id, tomato, '历史行应能按名称兜底归一');
    assert.strictEqual(decorated.display, dict.canonicalOf(tomato), '历史行展示应跟随偏好');

    await foodNames.setRegion('north');
    await foodNames.setHouseholdUnified(false);
    await foodNames.clearPreference(potato, 'household');
    const result = recipes.match([potato], []);
    const dish = result.missingOne.filter(function (item) { return item.id === 'b3'; })[0];
    assert.ok(dish, '土豆应命中「青椒土豆丝」为只差一样');
    assert.strictEqual(dish.missingText, '大椒', '缺失食材名应按地域词包展示');
    assert.ok(dish.missingRaw.indexOf('青椒') >= 0, '内部传参仍应保留原始名');

    const parsed = ai.normalizeFoods([{ name: '西红柿', quantity: '两个', shelf_days: 6 }]);
    assert.strictEqual(parsed[0].food_id, tomato, 'AI 解析结果应带 food_id');
    assert.strictEqual(parsed[0].raw_name, '西红柿', 'AI 解析应保留用户原话');
    assert.strictEqual(parsed[0].name, '番茄', '落库名称应为通用主名');
    const fallback = ai.fallbackParse('买了洋芋、鸡蛋');
    assert.ok(fallback.some(function (item) { return item.food_id === potato; }), '离线兜底也应归一');

    console.log('PASS: 归一 / 歧义 / 优先级链 / 外部回退 / 菜谱 ID 匹配 / AI 解析 全部通过');
    console.log('实体数 ' + Object.keys(dict.BY_ID).length + '，地域词包 ' + dict.regionList().length + ' 套');
}

main().catch(function (error) {
    console.error('FAIL:', error && error.stack ? error.stack : error);
    process.exit(1);
});
