// 今日推荐菜排序冒烟测试（Node 环境）：mock 掉小程序运行时与云端，
// 验证「临期过滤 → 最急优先 → 已做次数排序 → 展开配额」这一整条链路。
// 用法：node scripts/verify-recommend.js
const assert = require('assert');
const Module = require('module');
const path = require('path');

global.wx = {
    getStorageSync: function () { return ''; },
    setStorageSync: function () {},
    showToast: function () {},
};

global.getApp = function () {
    return { householdKey: '', userId: 'u1', userName: 'tester' };
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === './cloud') {
        return { cloud: { database: { from: function () { return {}; } } }, publicConfig: {} };
    }
    return originalLoad.apply(this, arguments);
};

const base = path.resolve(__dirname, '..', 'miniprogram', 'utils');
const dict = require(path.join(base, 'food-dict.js'));
const util = require(path.join(base, 'util.js'));
const qty = require(path.join(base, 'quantity.js'));
const recipes = require(path.join(base, 'recipes.js'));
const rec = require(path.join(base, 'recommend.js'));

// 精确顺序断言只覆盖手写 'b' 与云端 'c' 菜谱；'h' 开头的简版家常菜单独断言，
// 否则 500 道菜一进池，每次改菜谱源文件都要重排一遍期望值。
function legacyOnly(list) {
    return list.filter(function (item) { return !/^h/.test(item.id); });
}

// 一行食材：名字决定身份，left 是「还能放几天」，过期/临期都靠它。
function row(name, left) {
    const foodId = dict.resolveId(name) || ('custom:' + dict.clean(name));
    return {
        id: 'row-' + foodId,
        food_id: foodId,
        name: name,
        display: name,
        quantity: '',
        emoji: '🥬',
        expiry_on: util.addDays(util.today(), left),
    };
}

function keys(list) {
    return list.map(function (item) { return item.id; });
}

function pick(list, id) {
    return list.filter(function (item) { return item.id === id; })[0];
}

function main() {
    // 阈值只在 3~30 之间：太小等于不筛，太大就没有「急」可言
    assert.strictEqual(rec.clampDays(2), 3, '低于下限夹到 3');
    assert.strictEqual(rec.clampDays(31), 30, '高于上限夹到 30');
    assert.strictEqual(rec.clampDays(''), 10, '空值回默认 10');
    assert.strictEqual(rec.clampDays('abc'), 10, '非数字回默认 10');
    assert.strictEqual(rec.clampDays('12'), 12, '数字字符串照常');
    assert.strictEqual(rec.DAYS_MIN, 3);
    assert.strictEqual(rec.DAYS_MAX, 30);

    // 番茄 1 天、土豆 3 天、米饭 4 天、青椒 8 天、鸡蛋 12 天
    const fridge = [row('番茄', 1), row('土豆', 3), row('米饭', 4), row('青椒', 8), row('鸡蛋', 12)];
    const plain = rec.rank(fridge, [], { days: 10, sort: 'urgency' });
    // 番茄炒蛋(1) 与 鸡蛋番茄汤(1) 打平 → 保持词表顺序；接着青椒土豆丝(3)、蛋炒饭(4)
    assert.deepStrictEqual(keys(legacyOnly(plain.ready)), ['b2', 'b17', 'b3', 'b7'], '按命中的最急食材升序');
    assert.strictEqual(plain.ready[0].minLeft, 1, '主排序取命中最急的那样');
    assert.strictEqual(pick(plain.ready, 'b7').minLeft, 4, '蛋炒饭最急的是 4 天后的米饭');
    assert.strictEqual(plain.ready[0].urgentCount, 1, '番茄与鸡蛋里只有番茄在 10 天内');
    assert.strictEqual(plain.ready[0].daysText, '还能放 1 天', '卡片上要能直接读出还剩几天');
    assert.strictEqual(plain.ready[0].hot, true, '≤2 天标红');

    // 阈值收紧到 3 天：只剩番茄炒蛋、鸡蛋番茄汤、青椒土豆丝（土豆 3 天，strictly < 3 才算临期）
    const tight = rec.rank(fridge, [], { days: 3, sort: 'urgency' });
    assert.deepStrictEqual(keys(legacyOnly(tight.ready)), ['b2', 'b17'], '3 天阈值下只留番茄 1 天的那两道');

    // 只差一样：鸡蛋有、米饭没有 → 蛋炒饭进兜底列表，且标出缺什么
    const onlyEgg = rec.rank([row('鸡蛋', 1)], [], { days: 10, sort: 'urgency' });
    assert.deepStrictEqual(keys(legacyOnly(onlyEgg.ready)), [], '只有鸡蛋时，手写菜谱一道现成的都没有');
    assert.deepStrictEqual(keys(onlyEgg.ready).sort(), ['h11ddidw', 'hym66du'],
        '只有鸡蛋时，简版菜里的鸡蛋羹 / 虎皮蛋可以现做');
    const eggFried = pick(onlyEgg.missing, 'b7');
    assert.ok(eggFried, '蛋炒饭应进「只差一样」');
    assert.deepStrictEqual(eggFried.missing, ['米饭'], '缺的就是米饭这一样');

    // 全量匹配：不做临期过滤，把整池能做的菜都放出来
    const farFridge = fridge.concat([row('西兰花', 20), row('大蒜', 25)]);
    const urgentOnly = rec.rank(farFridge, [], { days: 10, sort: 'urgency' });
    assert.strictEqual(keys(urgentOnly.ready).indexOf('b4'), -1, '西兰花 20 天，不该进「只推临期」');
    const fullMode = rec.rank(farFridge, [], { days: 10, full: true, sort: 'urgency' });
    assert.ok(keys(fullMode.ready).indexOf('b4') >= 0, '全量匹配要能捞出蒜蓉西兰花');
    const legacyFull = legacyOnly(fullMode.ready);
    assert.strictEqual(legacyFull[legacyFull.length - 1].id, 'b4', '20 天的菜排在最后');

    // 简版家常菜（根目录 家常菜4.json 编译）也在同一个匹配池里：命中主料多、更急的照样排前。
    const tomatoSoup = pick(plain.ready, 'h3njwhh');
    assert.ok(tomatoSoup, '简版家常菜「番茄蛋花汤」应进入推荐');
    assert.strictEqual(tomatoSoup.matched, 2, '简版菜按命中主料数参与排序');
    assert.ok(keys(plain.ready).indexOf('h1ej722j') > keys(plain.ready).indexOf('h3njwhh'),
        '只命中 1 样的「糖拌西红柿」排在命中 2 样的菜后面');
    const noTime = pick(plain.ready, 'h1ej722j');
    assert.strictEqual(noTime.metaText.indexOf('分钟'), -1, '源数据没有用时不编造分钟数');
    assert.ok(noTime.metaText.indexOf('用到') >= 0, '缺用时也要保留「用到」这一句');
    assert.ok(pick(plain.ready, 'b2').metaText.indexOf('10 分钟') >= 0, '手写菜谱照常展示用时');
    const duplicated = recipes.BUILTIN.filter(function (item) { return item.name === '番茄炒蛋'; });
    assert.strictEqual(duplicated.length, 1, '和手写菜谱重名的简版菜不重复入池');
    assert.ok(duplicated[0].steps.length > 0, '重名时保留带做法的版本');

    // 剩余天数相同 → 次排序看「消耗总样数」（命中主料多的先上）
    const tieRows = [row('番茄', 1), row('鸡蛋', 1)];
    const tieCloud = [{ id: 9, name: '水煮蛋', main_items: ['鸡蛋'], seasonings: [], steps: [], source: 'ai' }];
    const tie = rec.rank(tieRows, tieCloud, { days: 10, sort: 'urgency' });
    assert.deepStrictEqual(keys(legacyOnly(tie.ready)), ['b2', 'b17', 'c9'], '同样急时，命中 2 样的排在只命中 1 样的前面');

    // 已做次数排序：正反两个方向，平票时回到剩余天数
    const counts = { b2: 5, b7: 2 };
    const desc = rec.rank(fridge, [], { days: 10, sort: 'cookDesc', counts: counts });
    assert.deepStrictEqual(keys(legacyOnly(desc.ready)), ['b2', 'b7', 'b17', 'b3'], '做得最多：5 → 2 → 0 → 0');
    const asc = rec.rank(fridge, [], { days: 10, sort: 'cookAsc', counts: counts });
    assert.deepStrictEqual(keys(legacyOnly(asc.ready)), ['b17', 'b3', 'b7', 'b2'], '做得最少：0 → 0 → 2 → 5，0 次里按紧迫度');
    assert.strictEqual(pick(asc.ready, 'b2').cookCount, 5, '次数要贴到菜品上');
    const noCounts = rec.rank(fridge, [], { days: 10, sort: 'cookDesc' });
    assert.deepStrictEqual(keys(legacyOnly(noCounts.ready)), ['b2', 'b17', 'b3', 'b7'], '没有次数记录时全部算 0，退回紧迫度');

    // 展开 / 收起：≤5 不给按钮；6~10 只给「显示全部」；>10 两个都给
    const p3 = rec.pager(3, 5);
    assert.strictEqual(p3.visible, 3, '不足 5 道就全显示');
    assert.strictEqual(p3.showTen || p3.showAll || p3.showCollapse, false, '≤5 道不给按钮');
    const p8 = rec.pager(8, 5);
    assert.strictEqual(p8.showTen, false, '6~10 道不出现「显示 10 道」');
    assert.strictEqual(p8.showAll, true, '6~10 道只出现「显示全部」');
    const p12 = rec.pager(12, 5);
    assert.strictEqual(p12.showTen, true, '>10 道两个按钮都出现');
    assert.strictEqual(p12.showAll, true);
    assert.strictEqual(p12.showCollapse, false);
    const p12b = rec.pager(12, 10);
    assert.strictEqual(p12b.showTen, false, '已经显示 10 道就不再劝你显示 10 道');
    assert.strictEqual(p12b.showAll, true, '但还能继续「显示全部」');
    const p12c = rec.pager(12, 12);
    assert.strictEqual(p12c.showAll, false, '全展开了就不再有「显示全部」');
    assert.strictEqual(p12c.showCollapse, true, '展开后给「收起」');

    // 回归：漏传 visible 不能让列表清空（曾经点「显示全部 6 道」变成一道都不显示）
    const p8All = rec.pager(8, undefined);
    assert.strictEqual(p8All.visible, 8, '没传 visible 时按全展开算，不能兜成 0');
    assert.strictEqual(p8All.showAll, false, '全展开了就不再给「显示全部」');
    assert.strictEqual(p8All.showCollapse, true, '全展开了给「收起」');
    assert.strictEqual(rec.pager(8, 'abc').visible, 8, 'visible 不是数字也按全展开算');

    // 顶部那行统计：同一样食材记了多行只算一样，临期取最早到期的那行
    const prof = rec.profile([row('番茄', 1), row('土豆', 3), row('鸡蛋', 12), row('鸡蛋', 2), row('西兰花', 20)], 10);
    assert.strictEqual(prof.total, 4, '鸡蛋记了两行仍然只算 1 样');
    assert.strictEqual(prof.urgent, 3, '番茄 / 土豆 / 鸡蛋（2 天那行）在临期内');

    // 改数量时回显：拆得出数值与单位，拆不出的整串留在输入框
    assert.deepStrictEqual(qty.parse('2 盒'), { mode: 'exact', qty: '2', unit: '盒' });
    assert.deepStrictEqual(qty.parse('2盒'), { mode: 'exact', qty: '2', unit: '盒' });
    assert.deepStrictEqual(qty.parse('两斤'), { mode: 'exact', qty: '两斤', unit: '' }, '中文数字不硬拆');
    assert.deepStrictEqual(qty.parse('很多'), { mode: 'many', qty: '', unit: '' });
    assert.deepStrictEqual(qty.parse(''), { mode: 'none', qty: '', unit: '' });

    console.log('PASS: 今日推荐菜的临期过滤、最急优先、已做次数排序与展开配额均正常');
}

main();
