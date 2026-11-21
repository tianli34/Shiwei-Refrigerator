// 临期口径回归测试（Node 环境）：已过期 ≠ 快过期。
// 曾经的 bug：首页把所有 left <= 2 的食材数进「快过期」，整冰箱过期时报「27 样快过期啦」。
// 用法：node scripts/verify-expiry.js
const assert = require('assert');
const path = require('path');
const Module = require('module');

const base = path.resolve(__dirname, '..', 'miniprogram', 'utils');

global.wx = {
    getStorageSync: function () { return ''; },
    setStorageSync: function () {},
    showToast: function () {},
};
global.getApp = function () { return { householdKey: '', userId: 'u1' }; };

const util = require(path.join(base, 'util.js'));

// subscribe.js 只做文案，叫法层给个最小桩，避免拉起云端依赖
const fakeNames = {
    displayName: function (id) { return id || ''; },
    labelOf: function (name) { return name || ''; },
};
const originalLoad = Module._load;
Module._load = function (request) {
    if (request === './food-names') return fakeNames;
    return originalLoad.apply(this, arguments);
};
const subscribe = require(path.join(base, 'subscribe.js'));
Module._load = originalLoad;

// left 为相对今天的天数：负数已过期，0 今天到期。
function row(left, name) {
    return { name: name || ('f' + left), food_id: name || ('f' + left), expiry_on: util.addDays(util.today(), left) };
}

function testBuckets() {
    const rows = [
        row(-7, '排骨'),
        row(-1, '牛奶'),
        row(0, '豆腐'),
        row(1, '青菜'),
        row(2, '鸡蛋'),
        row(3, '番茄'),
        row(30, '意面'),
    ];
    const buckets = util.expiryBuckets(rows);
    assert.deepStrictEqual(buckets.expired.map(function (r) { return r.name; }), ['排骨', '牛奶'], '过期按最久优先排');
    assert.deepStrictEqual(buckets.urgent.map(function (r) { return r.name; }), ['豆腐', '青菜', '鸡蛋'], '0~2 天算快过期，第 3 天不算');
    assert.strictEqual(buckets.expired.length + buckets.urgent.length, 5, '过期与快过期不重不漏');

    // 整冰箱都过期：urgent 必须为 0，否则又会被说成「N 样快过期啦」
    const allExpired = util.expiryBuckets(Array.from({ length: 27 }, function (_, i) { return row(-1 - i); }));
    assert.strictEqual(allExpired.urgent.length, 0, '全过期时不能有任何「快过期」');
    assert.strictEqual(allExpired.expired.length, 27);

    // 已 decorate 过的行带 fresh，也要按 fresh.left 走，不能重复算 diffDays
    const decorated = util.expiryBuckets([{ fresh: { left: -3 } }, { fresh: { left: 1 } }]);
    assert.strictEqual(decorated.expired.length, 1);
    assert.strictEqual(decorated.urgent.length, 1);

    assert.deepStrictEqual(util.expiryBuckets(null), { expired: [], urgent: [] }, '空数据不炸');
}

function testAlertCopy() {
    assert.deepStrictEqual(subscribe.alertCopy(0, 0), { title: '', tip: '', tone: '' }, '没东西时整卡不渲染');

    const onlyUrgent = subscribe.alertCopy(0, 2);
    assert.strictEqual(onlyUrgent.title, '⏰ 2 样快过期啦', '只有快过期时保留原文案');
    assert.strictEqual(onlyUrgent.tone, 'urgent');

    const onlyExpired = subscribe.alertCopy(27, 0);
    assert.strictEqual(onlyExpired.title, '⚠️ 27 样已过期，别再放了');
    assert.strictEqual(onlyExpired.tone, 'expired');
    assert.strictEqual(onlyExpired.title.indexOf('快过期'), -1, '全过期时文案里不能出现「快过期」');

    const both = subscribe.alertCopy(5, 2);
    assert.strictEqual(both.title, '⏰ 2 样快过期 · 5 样已过期');
    assert.strictEqual(both.tone, 'expired', '有过期的就先按过期配色');

    assert.strictEqual(subscribe.alertCopy(-1, 'x').title, '', '脏数据当 0 处理');
}

function testNoticeText() {
    // 微信推送模板写的是「还有 2 天过期」，已过期的不能混进去
    const urgent = util.expiryBuckets([row(-3, '排骨'), row(1, '青菜')]).urgent;
    const text = subscribe.expiryNoticeText(urgent);
    assert.strictEqual(text.indexOf('排骨'), -1, '过期食材不进订阅文案');
    assert.ok(text.indexOf('青菜') >= 0);
}

testBuckets();
testAlertCopy();
testNoticeText();
console.log('PASS: 临期口径（已过期 / 快过期）与提醒文案正常');
