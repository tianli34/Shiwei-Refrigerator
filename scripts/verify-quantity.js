// 数量语义冒烟测试（Node 环境）：mock 掉小程序运行时与云端，验证
// 精确/模糊/未记三种写法的组装、档位判定，以及一句话录入、AI 结果的兼容。
// 用法：node scripts/verify-quantity.js
const assert = require('assert');
const Module = require('module');
const path = require('path');

global.wx = {
    getStorageSync: function () { return ''; },
    setStorageSync: function () {},
    showToast: function () {},
    showActionSheet: function () {},
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
const qty = require(path.join(base, 'quantity.js'));
const ai = require(path.join(base, 'ai.js'));

function main() {
    // 四种模式平级：选哪个就只产出哪个的值，绝不叠加
    assert.strictEqual(qty.build('exact', '2', '盒'), '2 盒', '精确：数值 + 单位');
    assert.strictEqual(qty.build('exact', '2', '无'), '2', '精确：选「无」时不带单位');
    assert.strictEqual(qty.build('exact', '', '盒'), '', '精确：只选单位不填数字视为没记');
    assert.strictEqual(qty.build('unknown', '3', '斤'), '3 斤', '未知模式安全回退成精确');
    assert.strictEqual(qty.build('many', '2', '盒'), '很多', '选很多时忽略数值与单位');
    assert.strictEqual(qty.build('little', '2', '盒'), '少量', '选少量时忽略数值与单位');
    assert.strictEqual(qty.build('none', '2', '盒'), '', '空档兜底：改档回显空值仍然给空串');
    assert.strictEqual(qty.build('很多', '2', '盒'), '很多', '字面值也能直接回显');
    assert.strictEqual(qty.build('少量', '', ''), '少量', '字面值少量');

    // 模式表就是 UI 的三选一，每一档都自带通俗解释；
    // 「不记」不做成按钮：空值本身就是没记，多一个按钮等于同一个结果开两个入口
    assert.deepStrictEqual(qty.MODES.map(function (m) { return m.key; }), ['exact', 'many', 'little'], '三档顺序固定');
    assert.strictEqual(qty.MODES.some(function (m) { return m.key === 'none'; }), false, '不再有「不记」按钮');
    assert.strictEqual(qty.modeMeta('many').desc.indexOf('够做好几顿') >= 0, true, '「很多」要有通俗解释');
    assert.strictEqual(qty.modeMeta('little').desc.indexOf('只剩一点') >= 0, true, '「少量」要有通俗解释');
    assert.strictEqual(qty.modeOf('很多'), 'many', '历史模糊值可反推模式');
    assert.strictEqual(qty.modeOf('少量'), 'little');
    assert.strictEqual(qty.modeOf('2 盒'), 'exact');
    assert.strictEqual(qty.modeOf(''), 'none');
    assert.strictEqual(qty.isFuzzy('很多'), true);
    assert.strictEqual(qty.isFuzzy('许多'), true, '口语说法也算模糊档，只是不再改写成「很多」');
    assert.strictEqual(qty.isFuzzy('一大堆'), true);
    assert.strictEqual(qty.isFuzzy('两斤'), false, '带数值的描述不是模糊档');
    assert.deepStrictEqual(qty.FUZZY, ['很多', '少量'], '档位顺序固定');

    // 展示分类：历史行（精确/空串）原样可读
    assert.strictEqual(qty.kindOf('很多'), 'fuzzy');
    assert.strictEqual(qty.kindOf('少量'), 'fuzzy');
    assert.strictEqual(qty.kindOf('一大堆'), 'fuzzy', '口语值照样走模糊色');
    assert.strictEqual(qty.kindOf('两斤'), 'exact');
    assert.strictEqual(qty.kindOf(''), 'none');

    // 词表只判定档位，不改写值
    assert.strictEqual(qty.canonical('许多'), '很多', '许多 → 属于「很多」档');
    assert.strictEqual(qty.canonical('一大堆'), '很多', '一大堆 → 属于「很多」档');
    assert.strictEqual(qty.canonical('一点点'), '少量', '一点点 → 属于「少量」档');
    assert.strictEqual(qty.canonical('少许'), '少量', '少许 → 属于「少量」档');
    assert.strictEqual(qty.canonical('很多啊'), '很多', '语气词应被去掉');
    assert.strictEqual(qty.canonical('2 盒'), '', '精确数量不能被当成模糊量');
    assert.strictEqual(qty.canonical(''), '');
    assert.strictEqual(qty.modeOf('一大堆'), 'many', '回显时能认出属于「很多」档，但库里存的还是原话');
    assert.strictEqual(qty.modeOf('一点点'), 'little');
    assert.strictEqual(qty.scan('还有一点点香菜').value, '少量', '长词优先，不能被「一点」截断');
    assert.strictEqual(qty.scan('少量香菜和很多鸡蛋').value, '少量', '同句多档位时取最靠前的一次');
    assert.strictEqual(qty.scan('一大堆土豆').value, '很多');
    assert.strictEqual(qty.scan('两斤排骨').value, '', '精确描述里不应扫出模糊量');

    // AI / 小票识别结果：数量原样保留，不再折成「很多 / 少量」
    const normalized = ai.normalizeFoods([
        { name: '香菜', quantity: '少许', shelf_days: 3, zone: 'cold' },
        { name: '鸡蛋', quantity: '超多', shelf_days: 20, zone: 'cold' },
        { name: '牛奶', quantity: '2 盒', shelf_days: 5, zone: 'cold' },
        { name: '土豆', quantity: '', shelf_days: 20, zone: 'room' },
    ]);
    assert.strictEqual(normalized[0].quantity, '少许', 'AI 给「少许」就存「少许」');
    assert.strictEqual(normalized[1].quantity, '超多', '「超多」原样保留');
    assert.strictEqual(normalized[2].quantity, '2 盒', '精确数量不受影响');
    assert.strictEqual(normalized[3].quantity, '', '空数量保持空串');
    assert.strictEqual(qty.kindOf(normalized[0].quantity), 'fuzzy', '原话仍判成模糊档，列表才好上奶酪黄');
    assert.strictEqual(qty.modeOf(normalized[1].quantity), 'many', '点数量改档时能认出所属档位');

    // 离线兜底拆解：口语词要从食材名里剔掉，但原词照样落库
    const fuzzy = ai.fallbackParse('还有少量香菜');
    assert.strictEqual(fuzzy.length, 1, '应拆出 1 样食材');
    assert.strictEqual(fuzzy[0].name, '香菜', '模糊词不能混进食材名');
    assert.strictEqual(fuzzy[0].quantity, '少量', '原话就是「少量」，存原词');

    const many = ai.fallbackParse('很多鸡蛋');
    assert.strictEqual(many[0].name, '鸡蛋');
    assert.strictEqual(many[0].quantity, '很多');

    const little = ai.fallbackParse('买了一点点洋葱');
    assert.strictEqual(little[0].name, '洋葱');
    assert.strictEqual(little[0].quantity, '一点点', '「一点点」原样保留，不折成「少量」');

    const pile = ai.fallbackParse('买了一大堆土豆');
    assert.strictEqual(pile[0].name, '土豆', '「一大堆」要从食材名里剪掉');
    assert.strictEqual(pile[0].quantity, '一大堆', '口语量词原词落库');

    const exact = ai.fallbackParse('买了两斤排骨保质期3天');
    assert.strictEqual(exact[0].name, '猪排骨', '精确拆解的名归一不受影响');
    assert.strictEqual(exact[0].quantity, '两斤', '有数值时优先精确');
    assert.strictEqual(exact[0].shelf_days, 3);

    const box = ai.fallbackParse('还有一盒牛奶');
    assert.strictEqual(box[0].name, '牛奶');
    assert.strictEqual(box[0].quantity, '一盒');

    console.log('PASS: 数量三选一（精确/很多/少量，空即不记）、口语原样保留与 AI 拆解均正常');
}

main();
