// 菜谱构建器：把根目录 家常菜4.json 编译成小程序可直接 require 的简版菜谱模块。
// 用法：node scripts/build-home-recipes.js
//
// 源格式：{ 数量, 字段: ["序号","菜名","主料"], 菜品: [[序号, 菜名, [主料...]]] }
// 产物格式：{ id, name, emoji, mainItems, seasonings, minutes, difficulty, tags, steps }
//
// 这份数据只有菜名和主料，所以：
// - emoji 按菜名/首主料猜一个，猜不出给 🍽️；
// - minutes = 0、difficulty = '' 表示「源数据没有」，页面不展示，绝不编造用时；
// - steps 为空，详情页沿用 recipes.js 里的通用兜底文案。
// id 由菜名哈希得到，源文件增删改顺序都不影响已有菜的「已做」次数。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, '家常菜4.json');
const outputPath = path.join(root, 'miniprogram', 'utils', 'home-recipes.data.js');
const dict = require(path.join(root, 'miniprogram', 'utils', 'food-dict.js'));

// 菜品形态优先于主料：汤羹、主食类先认菜名，剩下的再按第一样主料选图标。
const DISH_RULES = [
    [/汤|羹/, '🍲'],
    [/饭$/, '🍚'],
    [/面$|米粉$|米线$|粉丝$|粉条$|粉皮$|凉粉$|凉皮$|蕨根粉$/, '🍜'],
    [/饺|馄饨|烧麦|包子/, '🥟'],
    [/饼$|馍$|馒头$/, '🥞'],
    [/炒蛋|煎蛋|拌蛋|蛋花|蛋饼|蛋卷/, '🥚'],
];

// 主料关键词。顺序有讲究：鸡肉里也有「肉」，所以禽类、水产要排在猪肉前面。
const ITEM_RULES = [
    [/蛋/, '🥚'],
    [/鸡/, '🍗'],
    [/鸭|鹅/, '🦆'],
    [/牛/, '🥩'],
    [/羊/, '🍖'],
    [/鱼|鲈|鲫|鲳|鳕|带鱼|黄鱼|龙利|巴沙/, '🐟'],
    [/虾/, '🦐'],
    [/蟹/, '🦀'],
    [/鱿鱼|章鱼|墨鱼|贝|蛤|蚬|蚝|蛏|螺|海参/, '🦑'],
    [/猪|肉|排骨|蹄|五花|里脊|火腿|腊肉|腊肠|香肠|腊味/, '🍖'],
    [/豆腐|腐竹|豆干|千张|豆皮|油面筋|素鸡|百叶|香干/, '🧈'],
    [/毛豆|黄豆/, '🌱'],
    [/木耳|银耳|香菇|蘑菇|菌|菇/, '🍄'],
    [/番茄|西红柿/, '🍅'],
    [/土豆|马铃薯/, '🥔'],
    [/红薯|紫薯|山药|芋头/, '🍠'],
    [/玉米/, '🌽'],
    [/南瓜/, '🎃'],
    [/茄子/, '🍆'],
    [/黄瓜|冬瓜|丝瓜|苦瓜|西葫芦|瓜/, '🥒'],
    [/萝卜/, '🥕'],
    [/藕|莲藕/, '🥬'],
    [/椒|辣椒|尖椒|泡椒/, '🌶️'],
    [/白菜|青菜|菠菜|生菜|油菜|菜心|芥蓝|花菜|西兰花|卷心菜|包菜|芹菜|西芹|韭黄|韭菜|蒜薹|蒜苗|莴笋|茭白|豆角|四季豆|豌豆|荷兰豆|豆芽|竹笋|春笋|冬笋|笋|海带|紫菜|空心菜|苋菜|雪菜|雪里蕻|马兰头|香椿/, '🥬'],
    [/板栗|栗子|腰果/, '🌰'],
    [/洋葱/, '🧅'],
    [/蒜/, '🧄'],
    [/苹果/, '🍎'],
    [/香蕉/, '🍌'],
    [/菠萝/, '🍍'],
    [/柠檬/, '🍋'],
    [/橙|橘/, '🍊'],
    [/牛奶|奶油|酸奶/, '🥛'],
    [/奶酪|芝士/, '🧀'],
    [/面包|吐司/, '🍞'],
    [/米$|糯米/, '🍚'],
    [/淀粉|面粉/, '🌾'],
];

const DEFAULT_EMOJI = '🍽️';

function emojiFor(name, mainItems) {
    for (const rule of DISH_RULES) {
        if (rule[0].test(name)) return rule[1];
    }
    const items = (mainItems || []);
    for (const item of items) {
        const resolved = dict.resolve(item);
        const words = resolved && resolved.id ? dict.namesOf(resolved.id) : [];
        const candidates = [item].concat(words);
        for (const rule of ITEM_RULES) {
            if (candidates.some(function (word) { return word && rule[0].test(word); })) return rule[1];
        }
    }
    return DEFAULT_EMOJI;
}

// FNV-1a 32 位：名字不变则 id 不变，和源文件里的序号、顺序解耦。
function hashName(name) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < name.length; i += 1) {
        hash ^= name.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const rows = Array.isArray(raw) ? raw : (raw.菜品 || []);
const entries = [];
const usedIds = {};

rows.forEach(function (row, index) {
    const name = String((row && row[1]) || '').trim();
    const mainItems = (Array.isArray(row && row[2]) ? row[2] : [])
        .map(function (item) { return String(item || '').trim(); })
        .filter(Boolean);
    if (!name || !mainItems.length) return;

    let id = 'h' + hashName(name);
    if (usedIds[id]) {
        throw new Error('菜名哈希冲突：' + name + ' / ' + usedIds[id]);
    }
    usedIds[id] = name;

    entries.push({
        id: id,
        name: name,
        emoji: emojiFor(name, mainItems),
        mainItems: mainItems,
        seasonings: [],
        minutes: 0,
        difficulty: '',
        tags: [],
        steps: [],
    });
});

const lines = entries.map(function (entry) {
    return '    ' + JSON.stringify(entry);
});

const output = [
    '// 自动生成，请勿手改。数据源：项目根目录 家常菜4.json',
    '// 重新生成：node scripts/build-home-recipes.js',
    '// 只有菜名和主料：minutes=0 / difficulty=\'\' 表示源数据没有用时与难度，页面不展示。',
    'module.exports = [',
    lines.join(',\n'),
    '];',
    '',
].join('\n');

fs.writeFileSync(outputPath, output, 'utf8');

const emojiCount = {};
entries.forEach(function (entry) { emojiCount[entry.emoji] = (emojiCount[entry.emoji] || 0) + 1; });
const top = Object.keys(emojiCount).sort(function (a, b) { return emojiCount[b] - emojiCount[a]; })
    .map(function (key) { return key + ' ' + emojiCount[key]; })
    .join(' | ');
console.log('已生成 ' + entries.length + ' 道简版菜谱 → ' + path.relative(root, outputPath));
console.log('图标分布：' + top);