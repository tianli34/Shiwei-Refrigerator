// 单位录入冒烟测试（Node 环境）：mock 掉小程序运行时、Storage 与页面依赖，
// 验证内置单位口径、最近置顶、自建增删，以及 index 页的实际交互。
// 用法：node scripts/verify-units.js
const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');

const root = path.resolve(__dirname, '..', 'miniprogram');
const base = path.join(root, 'utils');
const memory = {};
let modalResult = { confirm: true };

global.wx = {
    getStorageSync: function (key) {
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : '';
    },
    setStorageSync: function (key, value) { memory[key] = value; },
    showToast: function () {},
    showModal: function (options) { if (options.success) options.success(modalResult); },
};
global.getApp = function () {
    return { householdKey: '', userId: 'u1', userName: 'tester', playDoorSound: function () {} };
};

function clearStorage() {
    Object.keys(memory).forEach(function (key) { delete memory[key]; });
}

const units = require(path.join(base, 'units.js'));
const qty = require(path.join(base, 'quantity.js'));

// ---- 页面桩：拦截 index.js 的所有依赖，只留 quantity / units 为真模块 ----
let pageOptions = null;
global.Page = function (options) { pageOptions = options; };
const stubs = {
    // 真实 mixin 会注入登录门禁相关方法，WXML 也绑定了它们
    '../../../utils/auth': {
        createAuthMixin: function (o) {
            return Object.assign({}, o, {
                onShow: function () {},
                restore: function () {},
                onSignedIn: function () {},
                onRetryAuth: function () {},
                onSignOut: function () {},
            });
        },
    },
    '../../../utils/store': { ingredients: { list: async function () { return { data: [] }; } } },
    '../../../utils/ai': {},
    '../../../utils/util': {
        ZONES: [{ key: 'cold', hint: '冷藏' }, { key: 'freeze', hint: '冷冻' }, { key: 'room', hint: '常温' }],
        COMMON_FOODS: [],
        toast: function () {},
        today: function () { return '2026-11-14'; },
        addDays: function () { return '2026-11-17'; },
        freshness: function () { return { left: 3 }; },
        expiryBuckets: function () { return { expired: [], urgent: [] }; },
        errorMessage: function () { return ''; },
    },
    '../../../utils/food-dict': { resolve: function () { return {}; }, meta: function () { return {}; } },
    '../../../utils/food-names': {
        decorate: function (row) { return row; },
        labelOf: function (name) { return name; },
        displayName: function () { return ''; },
    },
    '../../../utils/subscribe': {
        expiringNamesText: function () { return ''; },
        alertCopy: function () { return { title: '', tip: '', tone: '' }; },
    },
};
const originalLoad = Module._load;
Module._load = function (request) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.apply(this, arguments);
};
require(path.join(root, 'pages', 'core', 'index', 'index.js'));
Module._load = originalLoad;

function makePage() {
    const page = Object.assign({}, pageOptions, { data: JSON.parse(JSON.stringify(pageOptions.data)) });
    page.setData = function (patch) {
        const that = this;
        Object.keys(patch).forEach(function (key) {
            if (key.indexOf('form.') === 0) that.data.form[key.slice(5)] = patch[key];
            else that.data[key] = patch[key];
        });
    };
    return page;
}

function values(chips) {
    return chips.map(function (chip) { return chip.value; });
}

function testBuiltin() {
    // 内置口径必须与 food-dict.js 清洗食材名时的单位正则一致，但两边不互相引用。
    const source = fs.readFileSync(path.join(base, 'food-dict.js'), 'utf8');
    const line = source.split('\n').filter(function (text) {
        return text.indexOf('\\s*(') >= 0 && text.indexOf('公斤') >= 0;
    })[0];
    assert.ok(line, 'food-dict.js 里应能找到单位正则');
    // 只取 \s*(...) 这一组，别把前面 text.replace( 的括号算进来
    const fromDict = line.match(/\\s\*\(([^)]+)\)/)[1].split('|');
    assert.deepStrictEqual(units.BUILTIN.slice().sort(), fromDict.slice().sort(), '内置单位集合与 food-dict 一致');
    assert.strictEqual(units.BUILTIN.length, 21, '21 个内置单位');
    assert.strictEqual(new Set(units.BUILTIN).size, 21, '内置单位不重复');

    const chips = units.chips([], []);
    assert.strictEqual(chips.length, 22, '无 + 21 个单位');
    assert.deepStrictEqual(
        { value: chips[0].value, label: chips[0].label, none: chips[0].none },
        { value: '', label: '无', none: true }, '「无」固定首位且值是不带单位的空串'
    );
    assert.strictEqual(new Set(chips.map(function (c) { return c.id; })).size, 22, 'wx:key 用的 id 必须唯一');
    assert.strictEqual(chips.every(function (c) { return c.custom === false; }), true, '默认没有自建单位');
}

function testRecent() {
    const chips = units.chips([], ['斤', '个']);
    assert.strictEqual(chips[0].label, '无', '最近排序不能挤掉「无」');
    assert.strictEqual(chips[1].value, '斤', '最近用过的排最前');
    assert.strictEqual(chips[2].value, '个', '次近的紧随其后');
    assert.strictEqual(chips[1].recent, true, '最近项带标记，供 UI 描边');
    assert.strictEqual(chips[3].recent, false);
    assert.strictEqual(chips.length, 22, '置顶不能产生重复项');

    // 已被删掉 / 不在全集里的最近项直接忽略，不留空格子
    const dirty = units.chips([], ['串', '个', '个', '', '无']);
    assert.strictEqual(dirty[1].value, '个');
    assert.strictEqual(dirty.length, 22);
    assert.strictEqual(values(dirty).indexOf('串') < 0, true);
}

function testCustom() {
    const chips = units.chips(['串', '碗'], ['碗']);
    assert.strictEqual(chips[1].value, '碗', '自建单位也能最近置顶');
    assert.strictEqual(chips[1].custom, true);
    assert.strictEqual(chips[chips.length - 1].value, '串', '没用过的自建单位排在内置之后');
    assert.strictEqual(chips.length, 24);
    // 传入脏数据（内置 / 重复 / 无）也不能撑出重复 chip
    const cleaned = units.chips(['盒', '串', '串', '无'], []);
    assert.strictEqual(cleaned.length, 23);
    assert.strictEqual(cleaned.filter(function (c) { return c.value === '串'; }).length, 1);
}

function testAddRemove() {
    clearStorage();
    assert.strictEqual(units.add('').ok, false, '空名字不允许');
    assert.strictEqual(units.add('  ').ok, false);
    assert.strictEqual(units.add('2 盒').ok, false, '带空格数字不允许混进 quantity');
    assert.strictEqual(units.add('一二三四五').ok, false, '超过 4 个字不允许');
    assert.strictEqual(units.add('盒').ok, false, '内置单位不允许重复新建');
    assert.strictEqual(units.add('无').ok, false, '「无」是保留占位');

    const added = units.add(' 串 ');
    assert.strictEqual(added.ok, true);
    assert.strictEqual(added.value, '串', '自动去空格');
    assert.strictEqual(added.chips[1].value, '串', '新建即置顶，不用滑着找');
    assert.strictEqual(added.chips[1].custom, true);
    assert.strictEqual(units.isCustom('串'), true);
    assert.strictEqual(units.isCustom('盒'), false);
    assert.strictEqual(units.add('串').ok, false, '重复新建被挡住');
    assert.strictEqual(units.add('mL').ok, true, '允许字母单位');
    assert.strictEqual(units.add('ml').ok, false, '字母大小写视为同一个');
    assert.strictEqual(units.read().chips.length, 24, '持久化后能读回');
    assert.strictEqual(qty.build('exact', '2', '串'), '2 串', '自建单位只是 quantity 文本的一部分');

    assert.strictEqual(units.remove('盒').ok, false, '内置单位不能删');
    const removed = units.remove('串');
    assert.strictEqual(removed.ok, true);
    assert.strictEqual(values(removed.chips).indexOf('串') < 0, true);
    assert.strictEqual(units.isCustom('串'), false);
    assert.strictEqual(units.read().recent.indexOf('串') < 0, true, '删除时一并清掉最近记录');
    assert.strictEqual(units.read().chips.length, 23);
}

function testPick() {
    clearStorage();
    units.pick('');           // 选「无」不进最近
    assert.deepStrictEqual(units.read().recent, []);
    ['个', '盒', '斤', '瓶', '袋', '份', '根'].forEach(units.pick);
    const recent = units.read().recent;
    assert.strictEqual(recent.length, units.RECENT_LIMIT, '最近记录有上限');
    assert.strictEqual(recent[0], '根', '最近点的最靠前');
    assert.strictEqual(recent.indexOf('个') < 0, true, '最旧的被挤掉');
    units.pick('盒');
    assert.strictEqual(units.read().recent[0], '盒', '重复点选移到最前而不是新增');
    assert.strictEqual(units.read().recent.filter(function (v) { return v === '盒'; }).length, 1);
    assert.strictEqual(units.read().chips[1].value, '盒', 'read 时按最近重排');
}

function testCustomLimit() {
    clearStorage();
    const names = ['串', '碗', '杯', '听', '支', '卷', '箱', '层', '锅', '盘', '笼', '屉', '瓣', '粒', '尾', '坨', '捧', '撮', '刀', '桌'];
    names.forEach(function (name) { assert.strictEqual(units.add(name).ok, true, name); });
    assert.strictEqual(units.add('多余').ok, false, '自建数量到上限后拒绝');
    assert.ok(units.add('多余').error.indexOf('长按') >= 0, '提示要告诉用户怎么腾位置');
}

function testPage() {
    clearStorage();
    assert.ok(pageOptions, 'index.js 应注册页面');

    // WXML 里所有事件绑定的处理函数都必须真实存在
    const wxml = fs.readFileSync(path.join(root, 'pages', 'core', 'index', 'index.wxml'), 'utf8');
    const handlers = (wxml.match(/(?:bind|catch)[a-zA-Z]+="(on\w+)"/g) || []).map(function (text) {
        return text.match(/"(on\w+)"/)[1];
    });
    const missing = handlers.filter(function (name) { return typeof pageOptions[name] !== 'function'; });
    assert.deepStrictEqual(missing, [], 'WXML 绑定的方法缺失：' + missing.join(', '));
    assert.ok(wxml.indexOf('scroll-view class="unit-scroll" scroll-x') >= 0, '单位区是横向滚动');
    assert.ok(wxml.indexOf('class="tag unit unit-add" bindtap="onUnitAddTap"') >= 0, '末尾有 + 号');
    const start = wxml.indexOf('wx:for="{{qtyUnits}}"');
    const unitLoop = wxml.slice(start, start + 700);
    assert.ok(unitLoop.indexOf('wx:key="id"') >= 0, 'chip 列表用稳定 id 作 key');
    assert.ok(unitLoop.indexOf('bindlongpress="onUnitLongPress"') >= 0, 'chip 支持长按删自建单位');
    assert.ok(unitLoop.indexOf('class="tag unit unit-add"') >= 0, '+ 号在两排滚动区末尾');

    const page = makePage();
    assert.strictEqual(page.data.qtyUnits.length, 22, '首屏就渲染完整单位表');
    page.data.form.qty = '2';

    const before = values(page.data.qtyUnits);
    page.onUnitTap({ currentTarget: { dataset: { unit: '盒' } } });
    assert.strictEqual(page.data.form.unit, '盒');
    assert.strictEqual(page.data.qtyPreview, '2 盒', '预览跟着更新');
    assert.deepStrictEqual(values(page.data.qtyUnits), before, '点选不立刻重排，避免列表跳位');
    assert.strictEqual(units.read().recent[0], '盒', '但最近使用已记下');

    page.onUnitTap({ currentTarget: { dataset: { unit: '' } } });
    assert.strictEqual(page.data.form.unit, '', '点「无」回到不带单位');
    assert.strictEqual(page.data.qtyPreview, '2');

    // 打开弹层才刷新顺序
    page.openAddSheet();
    assert.strictEqual(page.data.showAdd, true);
    assert.strictEqual(page.data.qtyUnits[1].value, '盒', '下次打开时最近项置顶');
    assert.strictEqual(page.data.qtyUnits[1].recent, true);

    // 就近新建单位
    page.onUnitAddTap();
    assert.strictEqual(page.data.unitEditor, true);
    page.onUnitDraftInput({ detail: { value: '2 盒' } });
    page.onUnitSave();
    assert.ok(page.data.unitError, '非法输入给出行内提示');
    assert.strictEqual(page.data.qtyUnits.length, 22, '失败不改动列表');
    page.onUnitDraftInput({ detail: { value: '串' } });
    assert.strictEqual(page.data.unitError, '');
    page.onUnitSave();
    assert.strictEqual(page.data.unitEditor, false);
    assert.strictEqual(page.data.form.unit, '串', '新建后自动选中');
    assert.strictEqual(page.data.qtyPreview, '2 串');
    assert.strictEqual(page.data.qtyUnits[1].value, '串', '新单位置顶可见');

    // 长按：内置静默忽略，自建确认后删除并清掉当前选中
    page.onUnitLongPress({ currentTarget: { dataset: { unit: '盒' } } });
    assert.strictEqual(units.isCustom('盒'), false);
    assert.strictEqual(units.isCustom('串'), true, '内置单位长按不应删掉任何东西');
    page.onUnitLongPress({ currentTarget: { dataset: { unit: '串' } } });
    assert.strictEqual(values(page.data.qtyUnits).indexOf('串') < 0, true);
    assert.strictEqual(page.data.form.unit, '', '删掉正选中的单位后回到「无」');
    assert.strictEqual(page.data.qtyPreview, '2');

    // 取消新建
    page.onUnitAddTap();
    page.onUnitDraftInput({ detail: { value: '碗' } });
    page.onUnitCancel();
    assert.strictEqual(page.data.unitEditor, false);
    assert.strictEqual(page.data.unitDraft, '');
    assert.strictEqual(units.isCustom('碗'), false);
}

function main() {
    clearStorage();
    testBuiltin();
    testRecent();
    testCustom();
    testAddRemove();
    testPick();
    testCustomLimit();
    testPage();
    console.log('PASS: 单位表 / 最近置顶 / 自建增删 / 页面交互均正常');
}

main();
