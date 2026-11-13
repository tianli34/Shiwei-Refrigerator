// 轻量 WXML 标签配对检查：把 {{...}} 里的表达式先抹平，避免 "a > 0" 误判为标签结束。
// 用法：node scripts/verify-wxml.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'miniprogram');

function walk(dir, out) {
    fs.readdirSync(dir).forEach(function (name) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full, out);
        else if (/\.wxml$/.test(name)) out.push(full);
    });
    return out;
}

const files = walk(root, []);
const problems = [];
const tagPattern = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;

files.forEach(function (file) {
    const source = fs.readFileSync(file, 'utf8');
    const flat = source.replace(/\{\{[\s\S]*?\}\}/g, function (block) {
        return block.replace(/[^\n]/g, ' ');
    });
    const stack = [];
    let match;
    tagPattern.lastIndex = 0;
    while ((match = tagPattern.exec(flat)) !== null) {
        const closing = match[1] === '/';
        const tag = match[2];
        const selfClosing = match[4] === '/' || /\/\s*$/.test(match[3]);
        if (closing) {
            if (stack[stack.length - 1] === tag) stack.pop();
            else problems.push(file + ': 闭合标签 </' + tag + '> 与 <' + (stack[stack.length - 1] || '空') + '> 不匹配');
        } else if (!selfClosing) {
            stack.push(tag);
        }
    }
    if (stack.length) problems.push(file + ': 未闭合 ' + stack.join(', '));
});

if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
}
console.log('PASS: ' + files.length + ' 个 WXML 标签配对正常');
