#!/usr/bin/env node
// 一套源码，构建两个版本。
//
// 用法：
//   node scripts/build.js              构建 social + personal
//   node scripts/build.js personal     只构建个人版
//   node scripts/build.js social       只构建社交版
//
// 只有读 miniprogram/、写 dist/ 两个方向。源目录永远不会被改动。
//
// 条件编译语法（行注释、wxml 注释、# 注释都认）：
//   // #if social      // #if !social      // #endif
//   <!-- #if social -->                 <!-- #endif -->
// 个人版构建时保留 !social 分支，社交版保留 social 分支，标记行本身不输出。
//
// 关于删除：不整体 rm 产物目录。社交路径在拷贝阶段就被排除，产物里的过期文件
// 由上一次的 .build-manifest.json 逐个对比删除，避免大批量删除操作。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'miniprogram');
const DIST = path.join(ROOT, 'dist');
const CONFIG = path.join(ROOT, 'config');

const ALL_VERSIONS = ['social', 'personal'];

// 个人版构建时既不拷贝、也要从旧产物里清掉的社交专属路径
const SOCIAL_PATHS = [
    'pages/social',
    'components/social',
    'utils/social.js',
];

// 不进入构建产物的名字（node_modules 由使用方在 dist 里自行安装）
const SKIP_NAMES = new Set(['.workbuddy', '.git', '.DS_Store', 'node_modules', 'project.private.config.json']);

const TEXT_EXT = new Set(['.js', '.json', '.wxml', '.wxss', '.wxs']);

const RE_IF = /^\s*(?:\/\/|<!--|#)\s*#if\s+(!?social)\s*(?:-->)?\s*$/;
const RE_ENDIF = /^\s*(?:\/\/|<!--|#)\s*#endif\s*(?:-->)?\s*$/;

const MANIFEST = '.build-manifest.json';

function rel(target) {
    return path.relative(ROOT, target).replace(/\\/g, '/');
}

function toPosix(p) {
    return p.replace(/\\/g, '/');
}

function isExcluded(relPath, excludes) {
    return excludes.some(function (prefix) {
        return relPath === prefix || relPath.indexOf(prefix + '/') === 0;
    });
}

function walk(root, dir, visit, excludes) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_NAMES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const relPath = toPosix(path.relative(root, full));
        if (excludes && isExcluded(relPath, excludes)) continue;
        if (entry.isDirectory()) walk(root, full, visit, excludes);
        else visit(full, relPath);
    }
}

function collectExpected(src, excludes) {
    const set = new Set();
    walk(src, src, function (file, relPath) { set.add(relPath); }, excludes);
    return set;
}

function forEachText(dir, fn) {
    walk(dir, dir, function (file) {
        if (!TEXT_EXT.has(path.extname(file))) return;
        fn(file, fs.readFileSync(file, 'utf8'));
    });
}

function removeEmptyDirs(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name));
    }
    try {
        fs.rmdirSync(dir);
    } catch (error) {
        // 还有内容就留着，这里只顺手清空目录
    }
}

// 从旧产物里清掉本次不该存在的社交路径。逐个 unlink，不做批量删除。
function removeExcluded(dir, excludes) {
    let removed = 0;
    excludes.forEach(function (prefix) {
        const target = path.join(dir, prefix);
        if (!fs.existsSync(target)) return;
        if (fs.statSync(target).isDirectory()) {
            walk(target, target, function (file) {
                fs.unlinkSync(file);
                removed += 1;
            });
            removeEmptyDirs(target);
        } else {
            fs.unlinkSync(target);
            removed += 1;
        }
    });
    return removed;
}

// 按上一次的 manifest 删除本次不再产出的文件（源码删页面时会用到）。
function pruneStale(dir, expected) {
    const manifestPath = path.join(dir, MANIFEST);
    if (!fs.existsSync(manifestPath)) return { pruned: 0, hasManifest: false };
    let old = [];
    try {
        old = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files || [];
    } catch (error) {
        return { pruned: 0, hasManifest: false };
    }
    let pruned = 0;
    old.forEach(function (relPath) {
        if (expected.has(relPath)) return;
        const target = path.join(dir, relPath);
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
            fs.unlinkSync(target);
            pruned += 1;
        }
    });
    return { pruned: pruned, hasManifest: true };
}

function copyTree(src, dest, excludes) {
    let count = 0;
    walk(src, src, function (file, relPath) {
        const target = path.join(dest, relPath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        // 用读写覆盖而不是 cpSync：cpSync 覆盖已存在文件时内部会先 unlink，
        // 在某些环境的删除守卫下会失败。
        fs.writeFileSync(target, fs.readFileSync(file));
        count += 1;
    }, excludes);
    return count;
}

// 按标记裁剪。标记不配对直接抛错，宁可构建失败，
// 也不要悄悄产出一个少了半段代码的包。
function stripMarkers(content, social, file) {
    const lines = content.split(/\r?\n/);
    const stack = [];
    const out = [];
    let removed = 0;

    lines.forEach(function (line, index) {
        const open = line.match(RE_IF);
        if (open) {
            stack.push(open[1] === 'social' ? social : !social);
            return;
        }
        if (RE_ENDIF.test(line)) {
            if (!stack.length) {
                throw new Error(rel(file) + ':' + (index + 1) + ' 出现了多余的 #endif');
            }
            stack.pop();
            return;
        }
        if (stack.every(Boolean)) out.push(line);
        else removed += 1;
    });

    if (stack.length) {
        throw new Error(rel(file) + ' 有 #if 没有配对的 #endif');
    }
    return { content: out.join('\n'), removedLines: removed };
}

function trimAll(root, social) {
    let touched = 0;
    let removedLines = 0;
    forEachText(root, function (file, text) {
        if (!/(?:^|\n)\s*(?:\/\/|<!--|#)\s*#(?:if\s+!?social|endif)/.test(text)) return;
        const result = stripMarkers(text, social, file);
        fs.writeFileSync(file, result.content);
        touched += 1;
        removedLines += result.removedLines;
    });
    return { touched: touched, removedLines: removedLines };
}

function writeProjectConfig(dir, cfg) {
    const projectConfig = {
        description: '拾味冰箱 · ' + cfg.label,
        packOptions: {
            ignore: [
                { type: 'folder', value: '.workbuddy' },
                { type: 'file', value: MANIFEST },
            ],
            include: [],
        },
        setting: {
            bundle: false,
            es6: true,
            minified: true,
            postcss: true,
            urlCheck: true,
        },
        compileType: 'miniprogram',
        appid: cfg.appid,
        projectname: 'shiwei-fridge-' + cfg.version,
        miniprogramRoot: './',
    };
    fs.writeFileSync(path.join(dir, 'project.config.json'), JSON.stringify(projectConfig, null, 2) + '\n');
}

function writeBuildConfig(dir, cfg) {
    const body = [
        '// 由 scripts/build.js 生成，不要手改。',
        'module.exports = ' + JSON.stringify({
            version: cfg.version,
            social: cfg.social,
        }, null, 4) + ';',
        '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'utils', 'build-config.js'), body);
}

// 校验产物。返回 { problems, notes }。
function verify(dir, cfg) {
    const problems = [];
    const notes = [];

    const appJsonPath = path.join(dir, 'app.json');
    if (!fs.existsSync(appJsonPath)) {
        problems.push('缺少 app.json');
        return { problems: problems, notes: notes };
    }

    let appJson = null;
    try {
        appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    } catch (error) {
        problems.push('app.json 不是合法 JSON：' + error.message);
        return { problems: problems, notes: notes };
    }

    const registered = new Set(appJson.pages.map(function (page) { return '/' + page; }));

    appJson.pages.forEach(function (page) {
        ['.js', '.wxml', '.json'].forEach(function (ext) {
            if (!fs.existsSync(path.join(dir, page + ext))) {
                problems.push('app.json 注册了不存在的页面文件：' + page + ext);
            }
        });
    });

    forEachText(dir, function (file, text) {
        const left = text.split(/\r?\n/).some(function (line) {
            return RE_IF.test(line) || RE_ENDIF.test(line);
        });
        if (left) problems.push(rel(file) + ' 仍有未裁掉的条件编译标记');
    });

    forEachText(dir, function (file, text) {
        if (!file.endsWith('.js')) return;
        const re = /['"](\/pages\/[A-Za-z0-9_/-]+)/g;
        let match;
        while ((match = re.exec(text))) {
            if (!registered.has(match[1])) {
                problems.push(rel(file) + ' 跳转到未注册页面：' + match[1]);
            }
        }
    });

    if (!cfg.social) {
        if (fs.existsSync(path.join(dir, 'pages/social'))) problems.push('个人版仍存在 pages/social 目录');
        if (fs.existsSync(path.join(dir, 'utils/social.js'))) problems.push('个人版仍存在 utils/social.js');
        const banned = ['menu_shares', 'menu_votes', 'household_members', 'open-type="share"', '点菜', '邀请码', '共享冰箱', '家人'];
        forEachText(dir, function (file, text) {
            banned.forEach(function (word) {
                if (text.indexOf(word) >= 0) {
                    problems.push(rel(file) + ' 仍含「' + word + '」');
                }
            });
        });
    }

    const pcPath = path.join(dir, 'project.config.json');
    if (!fs.existsSync(pcPath)) {
        problems.push('缺少 project.config.json');
    } else {
        const pc = JSON.parse(fs.readFileSync(pcPath, 'utf8'));
        if (pc.appid !== cfg.appid) problems.push('project.config.json 的 appid 与配置不一致');
        if (pc.miniprogramRoot !== './') problems.push('project.config.json 的 miniprogramRoot 应为 ./');
    }

    if (!fs.existsSync(path.join(dir, 'utils', 'build-config.js'))) {
        problems.push('缺少 utils/build-config.js');
    }

    if (!fs.existsSync(path.join(dir, 'miniprogram_npm'))) {
        notes.push('产物里没有 miniprogram_npm：首次导入后需在 dist 目录执行 npm install，再点「工具 → 构建 npm」');
    }

    return { problems: problems, notes: notes };
}

function loadConfig(version) {
    const file = path.join(CONFIG, version + '.js');
    if (!fs.existsSync(file)) throw new Error('缺少配置：' + rel(file));
    const cfg = require(file);
    if (!cfg || cfg.social !== (version === 'social')) {
        throw new Error(rel(file) + ' 的 social 开关与版本名不一致');
    }
    return cfg;
}

function build(version) {
    const cfg = loadConfig(version);
    const dir = path.join(DIST, version);
    const excludes = cfg.social ? [] : SOCIAL_PATHS;
    const warnings = [];

    console.log('\n=== ' + cfg.label + ' ===');
    console.log('输出：' + rel(dir));

    fs.mkdirSync(dir, { recursive: true });

    const expected = collectExpected(SRC, excludes);
    ['app.json', 'project.config.json', 'utils/build-config.js', MANIFEST].forEach(function (item) {
        expected.add(item);
    });

    if (excludes.length) {
        const removed = removeExcluded(dir, excludes);
        if (removed) console.log('  清掉上次遗留的社交文件：' + removed + ' 个');
    }

    const stale = pruneStale(dir, expected);
    if (stale.pruned) console.log('  清掉本次不再产出的文件：' + stale.pruned + ' 个');

    const copied = copyTree(SRC, dir, excludes);
    console.log('  拷贝文件：' + copied + ' 个' + (excludes.length ? '（已排除社交路径）' : ''));

    const appJsonSrc = path.join(CONFIG, 'app.' + version + '.json');
    if (!fs.existsSync(appJsonSrc)) throw new Error('缺少 ' + rel(appJsonSrc));
    fs.copyFileSync(appJsonSrc, path.join(dir, 'app.json'));
    console.log('  应用：config/app.' + version + '.json');

    // 平台的隐私能力声明也要按版本替换：个人版不能保留「用户发布内容」这类条目。
    const privacySrc = path.join(CONFIG, 'privacy.' + version + '.json');
    if (fs.existsSync(privacySrc)) {
        const privacyFiles = fs.readdirSync(dir).filter(function (name) {
            return /^\.wbapp_.*\.privacy\.json$/.test(name);
        });
        privacyFiles.forEach(function (name) {
            fs.copyFileSync(privacySrc, path.join(dir, name));
        });
        if (privacyFiles.length) console.log('  应用：config/privacy.' + version + '.json');
    }

    const trimmed = trimAll(dir, cfg.social);
    console.log('  裁剪条件编译：' + trimmed.touched + ' 个文件，删除 ' + trimmed.removedLines + ' 行');

    writeBuildConfig(dir, cfg);
    writeProjectConfig(dir, cfg);
    console.log('  生成：project.config.json（appid ' + cfg.appid + '）');

    const files = [];
    walk(dir, dir, function (file, relPath) { files.push(relPath); });
    fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify({ version: cfg.version, files: files }, null, 2) + '\n');

    if (!/^wx[0-9a-f]{16}$/.test(cfg.appid) || cfg.appid === 'wx0000000000000000') {
        warnings.push('appid 仍是占位值，上传前请改 config/' + version + '.js');
    }

    const result = verify(dir, cfg);
    warnings.forEach(function (item) { console.log('  [warn] ' + item); });
    result.notes.forEach(function (item) { console.log('  [note] ' + item); });

    if (result.problems.length) {
        result.problems.forEach(function (item) { console.log('  [fail] ' + item); });
        return { ok: false, warnings: warnings, problems: result.problems };
    }

    console.log('  [ok] 校验通过');
    return { ok: true, warnings: warnings, problems: [] };
}

function main() {
    const args = process.argv.slice(2);
    const versions = args.length ? args : ALL_VERSIONS;
    versions.forEach(function (item) {
        if (ALL_VERSIONS.indexOf(item) < 0) {
            console.error('未知版本：' + item + '（可选 ' + ALL_VERSIONS.join(' / ') + '）');
            process.exit(2);
        }
    });

    const summary = [];
    for (const version of versions) {
        summary.push({ version: version, result: build(version) });
    }

    console.log('\n=== 汇总 ===');
    let failed = 0;
    summary.forEach(function (item) {
        const line = item.result.ok
            ? '[ok]   dist/' + item.version
            : '[fail] dist/' + item.version + '（' + item.result.problems.length + ' 个问题）';
        console.log(line);
        if (!item.result.ok) failed += 1;
    });

    console.log('\n上传方式：微信开发者工具「导入项目」，分别选择 dist/social 与 dist/personal 目录。');
    process.exit(failed ? 1 : 0);
}

main();
