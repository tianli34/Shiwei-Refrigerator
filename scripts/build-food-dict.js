// 词表构建器：把根目录 ingredients.json 编译成小程序可直接 require 的 JS 数据模块。
// 用法：node scripts/build-food-dict.js
//
// 源格式：{ name, aliases, parent? }
//   parent 写父级食材的「通用主名」，不写 id —— 名字人肉可读，id 由这里统一分配。
// 产物格式：{ id, name, aliases, parent_id? }
//   id 是稳定身份；parent_id 指向父级身份，缺省表示它是顶层食材（没有上位词）。
//
// 两条硬规则：
// 1. ID 按原始顺序分配，新食材只能追加到数组末尾。中间插队会让所有历史 food_id 失配。
// 2. 父子关系只表达「它是父级的一种」，不表达「做法相近」。宁可少连，不要乱连。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'ingredients.json');
const outputPath = path.join(root, 'miniprogram', 'utils', 'food-dict.data.js');

const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const entries = [];

raw.forEach(function (row, index) {
    const name = String((row && row.name) || '').trim();
    if (!name) return;
    const aliases = (Array.isArray(row.aliases) ? row.aliases : [])
        .map(function (item) { return String(item || '').trim(); })
        .filter(function (item) { return item && item !== name; });
    const unique = aliases.filter(function (item, i) { return aliases.indexOf(item) === i; });
    entries.push({
        id: 'f' + String(index + 1).padStart(3, '0'),
        name: name,
        aliases: unique,
        parentName: String((row && row.parent) || '').trim(),
        parent_id: '',
    });
});

const byName = {};
entries.forEach(function (entry) { byName[entry.name] = entry; });

// 父级解析 + 自环/缺父/成环校验。任何一条不合法都只丢这条关系，不影响整张表。
const problems = [];
entries.forEach(function (entry) {
    if (!entry.parentName) return;
    const parent = byName[entry.parentName];
    if (!parent) {
        problems.push(entry.name + ' 的父级「' + entry.parentName + '」不在词表里，已忽略');
        return;
    }
    if (parent.id === entry.id) {
        problems.push(entry.name + ' 把自己设成了父级，已忽略');
        return;
    }
    entry.parent_id = parent.id;
});

// 成环检测：顺着 parent_id 往上走，走回自己就说明这条链是死循环。
const byId = {};
entries.forEach(function (entry) { byId[entry.id] = entry; });
entries.forEach(function (entry) {
    const seen = {};
    let cursor = entry;
    while (cursor && cursor.parent_id) {
        if (seen[cursor.id]) {
            problems.push(entry.name + ' 的父级链成环，已断开');
            entry.parent_id = '';
            return;
        }
        seen[cursor.id] = true;
        cursor = byId[cursor.parent_id];
    }
});

// 别名指向多个实体时，运行时不能直接归一，必须让用户确认。
const owners = {};
entries.forEach(function (entry) {
    [entry.name].concat(entry.aliases).forEach(function (word) {
        if (!owners[word]) owners[word] = [];
        if (owners[word].indexOf(entry.id) < 0) owners[word].push(entry.id);
    });
});
const conflicts = Object.keys(owners).filter(function (word) { return owners[word].length > 1; });

// ID 漂移守门：把上一次生成的 id -> name 拿出来对一遍，历史 ID 变过就必须人工确认。
function readExistingNames() {
    if (!fs.existsSync(outputPath)) return {};
    const text = fs.readFileSync(outputPath, 'utf8');
    const map = {};
    const re = /id: "(f\d+)", name: "([^"]+)"/g;
    let hit = re.exec(text);
    while (hit) {
        map[hit[1]] = hit[2];
        hit = re.exec(text);
    }
    return map;
}

const previous = readExistingNames();
const drifted = Object.keys(previous).filter(function (id) {
    return byId[id] && byId[id].name !== previous[id];
});

const header = [
    '// 自动生成，请勿手改。词表源：项目根目录 ingredients.json',
    '// 重新生成：node scripts/build-food-dict.js',
    '// 每条：id 稳定身份 / name 全国通用主名 / aliases 同物异名（可能含地域叫法）',
    '// parent_id：父级食材身份，缺省即顶层。子类可以顶替父类做菜，反之不行。',
    'module.exports = [',
];
const lines = entries.map(function (entry) {
    const tail = entry.parent_id ? ', parent_id: ' + JSON.stringify(entry.parent_id) : '';
    return '    { id: ' + JSON.stringify(entry.id) + ', name: ' + JSON.stringify(entry.name) +
        ', aliases: ' + JSON.stringify(entry.aliases) + tail + ' },';
});
const footer = ['];', ''];

fs.writeFileSync(outputPath, header.concat(lines, footer).join('\n'), 'utf8');

const linked = entries.filter(function (entry) { return entry.parent_id; });
console.log('生成 ' + outputPath);
console.log('实体 ' + entries.length + ' 条，叫法 ' + Object.keys(owners).length + ' 个，冲突别名 ' + conflicts.length + ' 个');
console.log('父子关系 ' + linked.length + ' 条（顶层 ' + (entries.length - linked.length) + ' 条）');
if (linked.length) {
    console.log(linked.map(function (entry) {
        return '  ' + byId[entry.parent_id].name + ' ← ' + entry.name;
    }).join('\n'));
}
if (conflicts.length) {
    console.log('冲突别名：');
    console.log(conflicts.map(function (word) { return '  ' + word + ' -> ' + owners[word].join('/'); }).join('\n'));
}
if (problems.length) {
    console.log('忽略的父子关系：');
    console.log(problems.map(function (text) { return '  ' + text; }).join('\n'));
}
if (drifted.length) {
    console.log('⚠️ ID 漂移（历史 food_id 已失配，请人工确认）：');
    console.log(drifted.map(function (id) { return '  ' + id + ' ' + previous[id] + ' -> ' + byId[id].name; }).join('\n'));
}
