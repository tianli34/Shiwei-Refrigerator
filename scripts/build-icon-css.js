#!/usr/bin/env node
// 把 assets-src/icons/food/*.png 内联成 data URI 的 WXSS。
// 内联的原因：WorkBuddy 更新链路对新增静态资源不可靠（整包历史里从没用过 <image>，
// webp 文件在预览端加载为空白），内联后不依赖文件部署与路径解析。
//
// 用法：node scripts/build-icon-css.js
// 母版 PNG 是 96px（对应卡片 64rpx @3x 屏），改图后重新跑本脚本。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets-src', 'icons', 'food');
const OUT = path.join(ROOT, 'miniprogram', 'styles', 'food-icons.wxss');

const files = fs.readdirSync(SRC).filter(function (f) { return /\.png$/.test(f); }).sort();

const lines = [
    '/* 自动生成：node scripts/build-icon-css.js，请勿手改 */',
    '.food-icon {',
    '    flex-shrink: 0;',
    '    background-repeat: no-repeat;',
    '    background-position: center;',
    '    background-size: contain;',
    '}',
];

files.forEach(function (file) {
    const name = file.replace(/\.png$/, '');
    const b64 = fs.readFileSync(path.join(SRC, file)).toString('base64');
    lines.push('.icon-' + name + ' { background-image: url("data:image/png;base64,' + b64 + '"); }');
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n') + '\n');
console.log('[ok] ' + path.relative(ROOT, OUT) + '（' + files.length + ' 个图标，' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB）');