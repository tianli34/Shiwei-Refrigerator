// 食材实体词表：稳定身份 + 同物异名归一。
// 纯函数层，不依赖云端、不依赖用户状态；所有「身份」判断都必须经过这里。
const DATA = require('./food-dict.data');
const { COMMON_FOODS } = require('./util');

const BY_ID = {};
const BY_WORD = {};
const BY_CANONICAL = {};

DATA.forEach(function (entry) {
    BY_ID[entry.id] = entry;
    BY_CANONICAL[entry.name] = entry.id;
    [entry.name].concat(entry.aliases).forEach(function (word) {
        if (!BY_WORD[word]) BY_WORD[word] = [];
        if (BY_WORD[word].indexOf(entry.id) < 0) BY_WORD[word].push(entry.id);
    });
});

// 父子关系：parent_id 表示「它是父级的一种」，是物种/部位关系，不是做法相似。
// 做菜时子类可以顶替父类（有五花肉，菜谱要猪肉 -> 能炒）；反过来不行
// （只有里脊肉，菜谱要五花肉 -> 红烧肉的口感就差远了，只能提示补货）。
const PARENT = {};
const CHILDREN = {};
DATA.forEach(function (entry) {
    if (!entry.parent_id || !BY_ID[entry.parent_id]) return;
    PARENT[entry.id] = entry.parent_id;
    if (!CHILDREN[entry.parent_id]) CHILDREN[entry.parent_id] = [];
    CHILDREN[entry.parent_id].push(entry.id);
});

// 泛称 / 上位词：只做精确归一，绝不参与模糊包含匹配。
// 「萝卜」不等于「白萝卜」，「白菜」不等于「大白菜」，硬猜会毁掉菜谱匹配。
// 真正有父子关系的（五花肉 -> 猪肉）走上面的 parent_id，不走这里。
const GENERIC_WORDS = [
    '萝卜', '白菜', '青菜', '木耳', '豆芽', '葱', '姜', '蒜', '菜', '瓜', '豆',
    '蛋', '椒', '薯', '菇', '肉', '米', '面', '奶', '菜花', '水栗', '百叶',
];
const GENERIC_SET = {};
GENERIC_WORDS.forEach(function (word) { GENERIC_SET[word] = true; });

// 模糊命中至少覆盖较长一方的一半，否则宁可落到自定义食材。
const MIN_FUZZY_COVERAGE = 0.5;

// 地域词包：写「通用主名 -> 当地叫法」，初始化时反查实体 ID 并校验叫法合法。
// 词包只影响显示，绝不影响身份；叫法不在该实体别名表里会被自动丢弃。
const REGION_DEFS = {
    common: { label: '通用叫法', hint: '全国通行度最高的叫法', names: {} },
    southwest: {
        label: '川渝西南', hint: '洋芋 · 海椒 · 红苕 · 莲花白',
        names: { '土豆': '洋芋', '辣椒': '海椒', '红薯': '红苕', '卷心菜': '莲花白', '南瓜': '倭瓜' },
    },
    north: {
        label: '华北东北', hint: '西红柿 · 圆白菜 · 大椒 · 葱头',
        names: { '番茄': '西红柿', '卷心菜': '圆白菜', '青椒': '大椒', '洋葱': '葱头', '红薯': '地瓜' },
    },
    jiangnan: {
        label: '江浙沪', hint: '落苏 · 青菜 · 草头 · 小棠菜',
        names: { '茄子': '落苏', '小白菜': '青菜', '苜蓿': '草头', '上海青': '小棠菜', '菠菜': '鹦鹉菜' },
    },
    lingnan: {
        label: '两广', hint: '矮瓜 · 凉瓜 · 胜瓜 · 通菜 · 菜头',
        names: { '茄子': '矮瓜', '苦瓜': '凉瓜', '丝瓜': '胜瓜', '空心菜': '通菜', '大白菜': '黄芽白', '白萝卜': '菜头', '生菜': '西生菜', '南瓜': '金瓜' },
    },
};

const REGION_PACKS = {};
Object.keys(REGION_DEFS).forEach(function (key) {
    const def = REGION_DEFS[key];
    const names = {};
    Object.keys(def.names).forEach(function (canonical) {
        const id = BY_CANONICAL[canonical];
        if (!id) return;
        const entry = BY_ID[id];
        const wanted = def.names[canonical];
        if (wanted !== entry.name && entry.aliases.indexOf(wanted) < 0) return;
        names[id] = wanted;
    });
    REGION_PACKS[key] = { key: key, label: def.label, hint: def.hint, names: names };
});

function clean(value) {
    let text = String(value == null ? '' : value).trim().toLowerCase();
    text = text.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '');
    text = text.replace(/[两一二三四五六七八九十百零\d.]+\s*(公斤|千克|斤|克|个|盒|袋|根|只|把|瓶|份|块|片|颗|头|条|捆|包|罐|勺)/g, '');
    text = text.replace(/^(新鲜|有机|冷冻|冷藏|切好|洗净|去皮|特级|进口)\s*/, '');
    text = text.replace(/[\s，,、；;。!！?？:：'"「」『』《》<>~·_\-]/g, '');
    return text.trim();
}

function isCustom(id) {
    return String(id || '').indexOf('custom:') === 0;
}

function customLabel(id) {
    return String(id || '').replace(/^custom:/, '');
}

function hit(id, raw, key, status) {
    const entry = BY_ID[id];
    return {
        id: id,
        status: status,
        raw: raw,
        clean: key,
        canonical: entry ? entry.name : customLabel(id),
        candidates: [],
    };
}

function ambiguous(ids, raw, key) {
    return {
        id: null,
        status: 'ambiguous',
        raw: raw,
        clean: key,
        canonical: '',
        candidates: ids.slice(0, 4).map(function (id) {
            return { id: id, canonical: BY_ID[id] ? BY_ID[id].name : id };
        }),
    };
}

// 归一入口。status: exact / fuzzy / ambiguous / custom / empty
function resolve(value) {
    const raw = String(value == null ? '' : value).trim();
    if (isCustom(raw)) return { id: raw, status: 'custom', raw: raw, clean: raw, canonical: customLabel(raw), candidates: [] };
    if (BY_ID[raw]) return hit(raw, raw, raw, 'exact');
    const key = clean(raw);
    if (!key) return { id: null, status: 'empty', raw: raw, clean: key, canonical: '', candidates: [] };
    if (BY_ID[key]) return hit(key, raw, key, 'exact');

    const exact = BY_WORD[key];
    if (exact && exact.length === 1) return hit(exact[0], raw, key, 'exact');
    if (exact && exact.length > 1) return ambiguous(exact, raw, key);

    // 模糊匹配：先按覆盖率过滤短词，再只保留命中长度最长的一档。
    // 覆盖率按较长一方计算，避免长词里只命中两个字就被短词带走。
    const matches = [];
    Object.keys(BY_WORD).forEach(function (word) {
        if (word.length < 2 || GENERIC_SET[word]) return;
        let matched = 0;
        if (key.indexOf(word) >= 0) {
            matched = word.length;
        } else if (word.length >= 3 && word.indexOf(key) >= 0) {
            matched = key.length;
        } else {
            return;
        }
        const coverage = matched / Math.max(key.length, word.length);
        if (coverage < MIN_FUZZY_COVERAGE) return;
        BY_WORD[word].forEach(function (id) {
            matches.push({ id: id, length: matched });
        });
    });
    let longest = 0;
    matches.forEach(function (item) {
        if (item.length > longest) longest = item.length;
    });
    const ids = [];
    matches.forEach(function (item) {
        if (item.length !== longest) return;
        if (ids.indexOf(item.id) < 0) ids.push(item.id);
    });
    if (ids.length === 1) return hit(ids[0], raw, key, 'fuzzy');
    if (ids.length > 1) return ambiguous(ids, raw, key);

    return {
        id: 'custom:' + key,
        status: 'custom',
        raw: raw,
        clean: key,
        canonical: raw.slice(0, 16),
        candidates: [],
    };
}

function resolveId(value) {
    return resolve(value).id;
}

function canonicalOf(id) {
    if (BY_ID[id]) return BY_ID[id].name;
    return customLabel(id);
}

function namesOf(id) {
    if (!BY_ID[id]) return [customLabel(id)];
    const entry = BY_ID[id];
    return [entry.name].concat(entry.aliases).filter(function (word, i, list) {
        return word && list.indexOf(word) === i;
    });
}

function parentOf(id) {
    return PARENT[id] || null;
}

function childrenOf(id) {
    return (CHILDREN[id] || []).slice();
}

// 由近及远的祖先链。数据万一被写成环，这里提前收手，绝不无限递归。
function ancestorsOf(id) {
    const chain = [];
    const seen = {};
    let cursor = PARENT[id];
    while (cursor && !seen[cursor] && chain.length < 8) {
        chain.push(cursor);
        seen[cursor] = true;
        cursor = PARENT[cursor];
    }
    return chain;
}

function isSubtype(childId, ancestorId) {
    if (!childId || !ancestorId || childId === ancestorId) return false;
    return ancestorsOf(childId).indexOf(ancestorId) >= 0;
}

// 同父不同支：五花肉和里脊肉都是猪肉，但谁也顶不了谁（红烧肉要的就是那层肥瘦相间）。
function shareParent(a, b) {
    const parent = PARENT[a];
    return !!parent && PARENT[b] === parent;
}

// 库存 vs 菜谱需求的关系判定，菜谱匹配只看这一个函数：
//   exact     同一个东西
//   subtype   库存更具体，可以顶替（有五花肉，菜谱要猪肉）
//   sibling   同父不同支，顶不上但能提示买哪样（有里脊肉，菜谱要五花肉）
//   supertype 库存更宽泛，顶不上（只有猪肉，菜谱要五花肉）
//   none      不搭界
function relation(ownedId, neededId) {
    if (!ownedId || !neededId) return 'none';
    if (ownedId === neededId) return 'exact';
    if (isSubtype(ownedId, neededId)) return 'subtype';
    if (isSubtype(neededId, ownedId)) return 'supertype';
    if (shareParent(ownedId, neededId)) return 'sibling';
    return 'none';
}

function meta(id) {
    const fallback = { emoji: '🥣', zone: 'cold', shelfDays: 3, known: false };
    if (!BY_ID[id]) return fallback;
    const words = namesOf(id);
    const known = COMMON_FOODS.filter(function (food) {
        return words.some(function (word) {
            return word === food.name || word.indexOf(food.name) >= 0 || food.name.indexOf(word) >= 0;
        });
    })[0];
    if (!known) return fallback;
    return { emoji: known.emoji, zone: known.zone, shelfDays: known.shelfDays, known: true };
}

function regionList() {
    return Object.keys(REGION_DEFS).map(function (key) {
        return { key: key, label: REGION_PACKS[key].label, hint: REGION_PACKS[key].hint };
    });
}

module.exports = {
    BY_ID: BY_ID,
    BY_WORD: BY_WORD,
    BY_CANONICAL: BY_CANONICAL,
    PARENT: PARENT,
    CHILDREN: CHILDREN,
    REGION_PACKS: REGION_PACKS,
    regionList: regionList,
    clean: clean,
    resolve: resolve,
    resolveId: resolveId,
    isCustom: isCustom,
    customLabel: customLabel,
    canonicalOf: canonicalOf,
    namesOf: namesOf,
    parentOf: parentOf,
    childrenOf: childrenOf,
    ancestorsOf: ancestorsOf,
    isSubtype: isSubtype,
    shareParent: shareParent,
    relation: relation,
    meta: meta,
};
