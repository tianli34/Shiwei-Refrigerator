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
    assert.strictEqual(dict.resolve('测试用小米').status, 'custom', '短词覆盖率不足时不应硬猜');
    assert.strictEqual(dict.resolve('测试豆腐').canonical, '豆腐', '覆盖率过半仍可按模糊归一');
    assert.strictEqual(dict.resolve('美白').status, 'custom', '反向包含也要受覆盖率约束');
    assert.strictEqual(dict.resolve('猪里脊肉').canonical, '猪里脊', '正常的长词仍应归一');
    assert.notStrictEqual(dict.resolveId('鳙鱼'), dict.resolveId('鲢鱼'), '鳙鱼 / 鲢鱼不能合并');
    assert.strictEqual(dict.resolve('小米椒').canonical, '小米辣', '小米椒应归到小米辣');
    assert.strictEqual(dict.resolve('鳙鱼头').canonical, '鳙鱼头', '鳙鱼头不应落到鲢鱼');

    const testMallet = dict.resolveId('小米');
    const testTofu = dict.resolveId('豆腐');
    dict.BY_WORD['测试长'] = [testMallet];
    dict.BY_WORD['长词'] = [testTofu];
    try {
        assert.strictEqual(dict.resolve('测试长词').canonical, '小米', '模糊匹配应优先最长命中');
    } finally {
        delete dict.BY_WORD['测试长'];
        delete dict.BY_WORD['长词'];
    }
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

    // ---------- 父子级食材：子类可顶父类，父类顶不了子类 ----------
    const pork = dict.resolveId('猪肉');
    const belly = dict.resolveId('五花肉');
    const loin = dict.resolveId('猪里脊');
    assert.ok(pork && belly && loin, '猪肉 / 五花肉 / 猪里脊都应落在词表里');
    assert.strictEqual(dict.parentOf(belly), pork, '五花肉的父级应是猪肉');
    assert.strictEqual(dict.parentOf(loin), pork, '里脊肉的父级应是猪肉');
    assert.strictEqual(dict.isSubtype(belly, pork), true, '五花肉应是猪肉的子类');
    assert.strictEqual(dict.isSubtype(pork, belly), false, '父级不能被子类反过来认');
    assert.strictEqual(dict.relation(belly, pork), 'subtype', '有五花肉、菜谱要猪肉：可顶替');
    assert.strictEqual(dict.relation(pork, belly), 'supertype', '有猪肉、菜谱要五花肉：顶不上');
    assert.strictEqual(dict.relation(loin, belly), 'sibling', '里脊肉 / 五花肉是同父不同支，谁也顶不了谁');
    assert.strictEqual(recipes.hasIngredient(['五花肉'], '猪肉'), true, '五花肉算有猪肉');
    assert.strictEqual(recipes.hasIngredient(['里脊肉'], '五花肉'), false, '里脊肉不算有五花肉');
    assert.strictEqual(recipes.hasIngredient(['猪肉'], '五花肉'), false, '有猪肉也不算有五花肉');

    const cloudRows = [
        { id: 1, name: '青椒肉丝', main_items: ['猪肉', '青椒'] },
        { id: 2, name: '红烧肉', main_items: ['五花肉'] },
    ];
    const greenPepper = dict.resolveId('青椒');
    const withBelly = recipes.match([belly, greenPepper], cloudRows);
    const stirFry = withBelly.ready.filter(function (item) { return item.name === '青椒肉丝'; })[0];
    assert.ok(stirFry, '有五花肉时「青椒肉丝」应立即可做');
    assert.strictEqual(stirFry.approxText, '五花肉 代 猪肉', '用子类顶上时要说明换的是哪一样');
    assert.strictEqual(stirFry.matchedText, '五花肉 + 大椒', '「用到」应报实际下锅的食材，并跟随地域叫法');

    const withLoin = recipes.match([loin], cloudRows);
    assert.strictEqual(withLoin.ready.filter(function (item) { return item.name === '红烧肉'; }).length, 0,
        '只有里脊肉时红烧肉不能算立即可做');
    const braised = withLoin.missingOne.filter(function (item) { return item.name === '红烧肉'; })[0];
    assert.ok(braised, '部位不对时应落到「只差 1 样」并给出提示');
    assert.strictEqual(braised.missingText, '五花肉', '缺的仍应是五花肉');
    assert.strictEqual(braised.hintText, '只有猪里脊，这道菜要五花肉', '提示应说清是部位不对');

    // 「豆腐」以前不在词表里，菜谱要豆腐永远匹配不上；现在它有正式身份和三个子类。
    const tofu = dict.resolveId('豆腐');
    const firmTofu = dict.resolveId('老豆腐');
    assert.ok(tofu && !dict.isCustom(tofu), '豆腐应是词表实体，而不是自定义食材');
    assert.strictEqual(dict.parentOf(firmTofu), tofu, '老豆腐的父级应是豆腐');
    assert.strictEqual(recipes.toFoodId('custom:豆腐'), tofu, '历史 custom:豆腐 应升级成正式身份');
    const tofuSoup = recipes.match([firmTofu, dict.resolveId('海带')], []).ready
        .filter(function (item) { return item.id === 'b19'; })[0];
    assert.ok(tofuSoup, '老豆腐 + 海带应能做「豆腐味噌汤」');
    assert.strictEqual(tofuSoup.approxText, '老豆腐 代 豆腐', '汤里用的是老豆腐要说清楚');

    const parsed = ai.normalizeFoods([{ name: '西红柿', quantity: '两个', shelf_days: 6 }]);
    assert.strictEqual(parsed[0].food_id, tomato, 'AI 解析结果应带 food_id');
    assert.strictEqual(parsed[0].raw_name, '西红柿', 'AI 解析应保留用户原话');
    assert.strictEqual(parsed[0].name, '番茄', '落库名称应为通用主名');
    const fallback = ai.fallbackParse('买了洋芋、鸡蛋');
    assert.ok(fallback.some(function (item) { return item.food_id === potato; }), '离线兜底也应归一');

    console.log('PASS: 归一 / 歧义 / 优先级链 / 外部回退 / 菜谱 ID 匹配 / AI 解析 / 父子级食材 全部通过');
    console.log('实体数 ' + Object.keys(dict.BY_ID).length + '，父子关系 ' + Object.keys(dict.PARENT).length +
        ' 条，地域词包 ' + dict.regionList().length + ' 套');
}

main().catch(function (error) {
    console.error('FAIL:', error && error.stack ? error.stack : error);
    process.exit(1);
});
