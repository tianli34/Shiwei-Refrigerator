// 词表构建器：把根目录 ingredients.json 编译成小程序可直接 require 的 JS 数据模块。
// 用法：node scripts/build-food-dict.js
// 词表有增删改时重跑即可，ID 按原始顺序固定分配，已有 ID 不会漂移。
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
    });
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

const header = [
    '// 自动生成，请勿手改。词表源：项目根目录 ingredients.json',
    '// 重新生成：node scripts/build-food-dict.js',
    '// 每条：id 稳定身份 / name 全国通用主名 / aliases 同物异名（可能含地域叫法）',
    'module.exports = [',
];
const lines = entries.map(function (entry) {
    return '    { id: ' + JSON.stringify(entry.id) + ', name: ' + JSON.stringify(entry.name) +
        ', aliases: ' + JSON.stringify(entry.aliases) + ' },';
});
const footer = ['];', ''];

fs.writeFileSync(outputPath, header.concat(lines, footer).join('\n'), 'utf8');

console.log('生成 ' + outputPath);
console.log('实体 ' + entries.length + ' 条，叫法 ' + Object.keys(owners).length + ' 个，冲突别名 ' + conflicts.length + ' 个');
console.log(conflicts.map(function (word) { return word + ' -> ' + owners[word].join('/'); }).join('\n'));
