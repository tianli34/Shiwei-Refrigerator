// 单位只服务于「录入时可选」和「列表里怎么展示」两件事：
//   - 不新增数据库列，不改 store.js 白名单，不做历史数据迁移；
//   - 不参与 quantity 的语义判定（精确 / 模糊 / 未记）、菜谱匹配、AI 拆解；
//   - 内置清单口径对齐 food-dict.js 清洗食材名时的正则，但刻意互不引用，
//     这样扩充单位不会顺带改变 AI / 小票 / 名称归一的行为。
// 最终写进 ingredients.quantity 的仍然是 quantity.build() 产出的描述性字符串。

// 「无」不是单位，是「这次不写单位」的占位；固定首位、不参与最近使用排序。
const NONE_LABEL = '无';

// 与 utils/food-dict.js:81 的单位集合一致（21 个），按常用容器 → 度量排列。
const BUILTIN = [
    '个', '盒', '袋', '瓶', '份', '根', '只', '把', '块', '片', '颗', '头', '条',
    '捆', '包', '罐', '勺', '斤', '克', '公斤', '千克',
];

const K_CUSTOM = 'qty_units_custom';
const K_RECENT = 'qty_units_recent';
const RECENT_LIMIT = 6;
const CUSTOM_LIMIT = 20;
const NAME_PATTERN = /^[\u4e00-\u9fa5a-zA-Z]{1,4}$/;

function storage(key, fallback) {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return fallback;
    try {
        const value = wx.getStorageSync(key);
        return value === '' || value == null ? fallback : value;
    } catch (error) {
        return fallback;
    }
}

function save(key, value) {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return;
    try { wx.setStorageSync(key, value); } catch (error) { /* 存储不可用时仅本次会话有效 */ }
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function uniq(list) {
    const seen = Object.create(null);
    return list.filter(function (item) {
        if (!item || seen[item]) return false;
        seen[item] = true;
        return true;
    });
}

function readCustom() {
    return uniq(safeArray(storage(K_CUSTOM, [])).map(function (item) {
        return String(item == null ? '' : item).trim();
    })).filter(function (item) {
        return NAME_PATTERN.test(item) && item !== NONE_LABEL && BUILTIN.indexOf(item) < 0;
    }).slice(0, CUSTOM_LIMIT);
}

function readRecent() {
    return uniq(safeArray(storage(K_RECENT, [])).map(function (item) {
        return String(item == null ? '' : item).trim();
    })).filter(function (item) {
        return item && item !== NONE_LABEL;
    }).slice(0, RECENT_LIMIT);
}

// 纯函数：把「内置 + 自建 + 最近使用」摊平成渲染用的 chip 列表。
// 顺序 = 无（固定） → 最近用过的（按最近程度） → 其余内置 → 其余自建。
// 已从列表里消失（例如被删掉）的最近项直接忽略，不会留下空格子。
function chips(custom, recent) {
    const extras = uniq(safeArray(custom)).filter(function (item) {
        return item && item !== NONE_LABEL && BUILTIN.indexOf(item) < 0;
    });
    const customSet = Object.create(null);
    extras.forEach(function (item) { customSet[item] = true; });
    const all = BUILTIN.concat(extras);

    const used = Object.create(null);
    const ordered = [];
    safeArray(recent).forEach(function (value) {
        if (!value || value === NONE_LABEL || used[value] || all.indexOf(value) < 0) return;
        used[value] = true;
        ordered.push({ value: value, recent: true });
    });
    all.forEach(function (value) {
        if (used[value]) return;
        used[value] = true;
        ordered.push({ value: value, recent: false });
    });

    function toChip(entry) {
        return {
            id: (customSet[entry.value] ? 'c:' : 'b:') + entry.value,
            value: entry.value,
            label: entry.value,
            none: false,
            custom: !!customSet[entry.value],
            recent: entry.recent,
        };
    }
    return [{
        id: '__none__', value: '', label: NONE_LABEL,
        none: true, custom: false, recent: false,
    }].concat(ordered.map(toChip));
}

// 页面初始化 / 每次打开录入弹层时调用：读缓存并算好本轮固定的顺序。
function read() {
    const custom = readCustom();
    const recent = readRecent();
    return { custom: custom, recent: recent, chips: chips(custom, recent) };
}

// 点选单位时只记「最近」，不立刻重排 chip —— 否则手一点列表就跳位。
// 新顺序在下次打开录入弹层（read）时才生效，连续录入期间保持稳定。
function pick(value) {
    const picked = String(value == null ? '' : value).trim();
    let recent = readRecent();
    if (picked && picked !== NONE_LABEL) {
        recent = [picked].concat(recent.filter(function (item) { return item !== picked; })).slice(0, RECENT_LIMIT);
        save(K_RECENT, recent);
    }
    return { recent: recent };
}

// 新建单位：只收 1~4 个中英文字，避免空格 / 数字 / 标点混进 quantity 描述串。
function add(raw) {
    const name = String(raw == null ? '' : raw).trim();
    const custom = readCustom();
    if (!NAME_PATTERN.test(name)) {
        return { ok: false, error: '单位写 1~4 个中文字或字母就行', chips: chips(custom, readRecent()) };
    }
    if (name === NONE_LABEL || BUILTIN.indexOf(name) >= 0) {
        return { ok: false, error: '这个单位本来就有，直接点它就好', chips: chips(custom, readRecent()) };
    }
    const lowered = name.toLowerCase();
    const exists = custom.some(function (item) { return item.toLowerCase() === lowered; });
    if (exists) {
        return { ok: false, error: '「' + name + '」已经在列表里了', chips: chips(custom, readRecent()) };
    }
    if (custom.length >= CUSTOM_LIMIT) {
        return { ok: false, error: '自建单位最多 ' + CUSTOM_LIMIT + ' 个，长按删掉不用的再加', chips: chips(custom, readRecent()) };
    }
    const next = custom.concat([name]);
    save(K_CUSTOM, next);
    // 新建即视为用过一次，让它排到最前，用户不用再滑着找。
    const state = pick(name);
    return { ok: true, value: name, chips: chips(next, state.recent) };
}

// 只允许删自建单位；已经入库的食材不受影响（quantity 是快照文本）。
function remove(value) {
    const name = String(value == null ? '' : value).trim();
    const custom = readCustom();
    if (custom.indexOf(name) < 0) {
        return { ok: false, error: '内置单位不能删', chips: chips(custom, readRecent()) };
    }
    const next = custom.filter(function (item) { return item !== name; });
    const recent = readRecent().filter(function (item) { return item !== name; });
    save(K_CUSTOM, next);
    save(K_RECENT, recent);
    return { ok: true, value: name, chips: chips(next, recent) };
}

function isCustom(value) {
    return readCustom().indexOf(String(value == null ? '' : value).trim()) >= 0;
}

module.exports = {
    NONE_LABEL: NONE_LABEL,
    BUILTIN: BUILTIN,
    RECENT_LIMIT: RECENT_LIMIT,
    CUSTOM_LIMIT: CUSTOM_LIMIT,
    chips: chips,
    read: read,
    pick: pick,
    add: add,
    remove: remove,
    isCustom: isCustom,
};
