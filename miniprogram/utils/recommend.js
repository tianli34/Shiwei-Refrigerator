// 今日推荐菜：把「全部未过期食材」当成一个匹配池，再按「最急的食材」排成排行榜。
// 只做纯计算，不碰云也不碰 wx，方便 scripts/verify-recommend.js 直接跑。
//
// 排序口径（与需求逐条对应）：
//   urgency            ：命中的最急迫食材剩余天数升序 → 命中主料数降序（消耗总样数）
//   cookDesc / cookAsc ：已做次数 → 剩余天数 → 命中临期主料数 → 命中主料数（两级兜底）
//
// 「剩余天数」只看真正会下锅的那几样：菜谱要「猪肉」、冰箱里是「五花肉」，
// 记的就是五花肉那一行 —— explain() 的 used 已经是这个口径。
const recipes = require('./recipes');
const util = require('./util');

const DAYS_MIN = 3;
const DAYS_MAX = 30;
const DAYS_DEFAULT = 10;
const NO_EXPIRY = 999;

const SORTS = [
    { key: 'urgency', label: '最急优先' },
    { key: 'cookDesc', label: '做得最多' },
    { key: 'cookAsc', label: '做得最少' },
];

// 临期天数只在 3~30 之间有意义：太小等于没有筛选，太大就分不出「急」。
function clampDays(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return DAYS_DEFAULT;
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return DAYS_DEFAULT;
    return Math.max(DAYS_MIN, Math.min(DAYS_MAX, n));
}

// 同一样食材可能被录入多次（两盒牛奶分两行记），只剩最早到期的那一行说了算。
function leftMapOf(rows) {
    const map = Object.create(null);
    (rows || []).forEach(function (row) {
        const id = row && row.food_id;
        if (!id) return;
        const left = util.diffDays(row.expiry_on);
        if (map[id] === undefined || left < map[id]) map[id] = left;
    });
    return map;
}

function countOf(countMap, recipe) {
    const n = Number((countMap || {})[recipes.recipeKey(recipe)]);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

// 一道菜在「还剩几天」这件事上的三个数：最急的那样／多少样在临期内／命中几样主料。
function urgencyOf(info, leftMap, days) {
    const used = info.used || [];
    const lefts = [];
    let urgent = 0;
    used.forEach(function (id) {
        const left = leftMap[id];
        if (left === undefined) return;
        lefts.push(left);
        if (left >= 0 && left < days) urgent += 1;
    });
    return {
        minLeft: lefts.length ? Math.min.apply(null, lefts) : NO_EXPIRY,
        urgentCount: urgent,
        matchedCount: (info.matched || []).length,
    };
}

function byUrgency(a, b) {
    if (a.minLeft !== b.minLeft) return a.minLeft - b.minLeft;
    // 次排序：消耗总样数 —— 同样急的时候，能一次清掉更多食材的菜先上。
    if (a.matchedCount !== b.matchedCount) return b.matchedCount - a.matchedCount;
    return (a.minutes || 0) - (b.minutes || 0);
}

function byCook(dir) {
    return function (a, b) {
        if (a.cookCount !== b.cookCount) return (a.cookCount - b.cookCount) * dir;
        if (a.minLeft !== b.minLeft) return a.minLeft - b.minLeft;
        if (a.urgentCount !== b.urgentCount) return b.urgentCount - a.urgentCount;
        if (a.matchedCount !== b.matchedCount) return b.matchedCount - a.matchedCount;
        return (a.minutes || 0) - (b.minutes || 0);
    };
}

function comparatorOf(sort) {
    if (sort === 'cookDesc') return byCook(-1);
    if (sort === 'cookAsc') return byCook(1);
    return byUrgency;
}

function daysText(minLeft) {
    if (minLeft === NO_EXPIRY) return '日期没记';
    if (minLeft < 0) return '已过期 ' + Math.abs(minLeft) + ' 天';
    if (minLeft === 0) return '今天到期';
    return '还能放 ' + minLeft + ' 天';
}

function decorate(item, leftMap, days, index) {
    const hot = item.minLeft !== NO_EXPIRY && item.minLeft <= 2;
    return Object.assign({}, item, {
        key: recipes.recipeKey(item),
        rank: index + 1,
        cookCount: item.cookCount || 0,
        daysText: daysText(item.minLeft),
        hot: hot,
        urgentText: item.urgentCount > 0 ? item.urgentCount + ' 样 ' + days + ' 天内到期' : '',
    });
}

// rows：未过期的食材行（已经不带 consumed）；cloudRows：云端 AI 菜谱。
// opts.days：临期阈值 N；opts.full：全量匹配（不做「至少含 1 样临期」过滤）；
// opts.sort：urgency / cookDesc / cookAsc；opts.counts：recipe_key → 已做次数。
function rank(rows, cloudRows, options) {
    const opt = options || {};
    const days = clampDays(opt.days);
    const full = !!opt.full;
    const counts = opt.counts || {};
    const sort = opt.sort || 'urgency';

    const ownedIds = (rows || []).map(function (row) { return row.food_id; }).filter(Boolean);
    const leftMap = leftMapOf(rows);
    const ready = [];
    const missing = [];

    recipes.allRecipes(cloudRows).forEach(function (recipe) {
        const need = recipe.mainItems || [];
        if (!need.length) return;
        const info = recipes.explain(ownedIds, need);
        const urgent = urgencyOf(info, leftMap, days);
        const item = Object.assign({}, recipe, {
            matched: urgent.matchedCount,
            matchedCount: urgent.matchedCount,
            missing: info.missing,
            missingRaw: info.missing.join('|'),
            missingText: info.missingText,
            matchedText: info.matchedText,
            substitutes: info.substitutes,
            approxText: info.approxText,
            hints: info.hints,
            hintText: info.hintText,
            used: info.used,
            totalNeeded: need.length,
            minLeft: urgent.minLeft,
            urgentCount: urgent.urgentCount,
            cookCount: countOf(counts, recipe),
        });
        if (info.missing.length === 0 && info.matched.length >= 1) {
            // 默认只留「至少含 1 样 N 天内到期」的菜；全量匹配就是整池都能做出来的菜。
            if (full || urgent.urgentCount >= 1) ready.push(item);
        } else if (info.missing.length === 1 && (info.matched.length >= 1 || info.hints.length > 0)) {
            missing.push(item);
        }
    });

    ready.sort(comparatorOf(sort));
    // 「只差一样」是兜底列表，永远按紧迫度排，不跟已做次数走。
    missing.sort(byUrgency);

    return {
        days: days,
        full: full,
        sort: sort,
        ready: ready.map(function (item, index) { return decorate(item, leftMap, days, index); }),
        missing: missing.map(function (item, index) { return decorate(item, leftMap, days, index); }),
    };
}

// 顶部那行「冰箱里 N 样食材，M 样 10 天内到期」：同一样食材记了多行只算一样。
function profile(rows, days) {
    const d = clampDays(days);
    const leftMap = leftMapOf(rows);
    const ids = Object.keys(leftMap);
    return {
        days: d,
        total: ids.length,
        urgent: ids.filter(function (id) { return leftMap[id] >= 0 && leftMap[id] < d; }).length,
    };
}

// 展开 / 收起的按钮配额：≤5 不给按钮；6~10 只给「显示全部」；>10 两个都给。
function pager(total, visible) {
    const count = Math.max(0, Number(total) || 0);
    const shown = Math.max(0, Math.min(Number(visible) || 0, count));
    return {
        count: count,
        visible: shown,
        items: shown,
        showTen: count > 10 && shown <= 5,
        showAll: count > 5 && shown < count,
        showCollapse: shown > 5,
    };
}

module.exports = {
    DAYS_MIN: DAYS_MIN,
    DAYS_MAX: DAYS_MAX,
    DAYS_DEFAULT: DAYS_DEFAULT,
    NO_EXPIRY: NO_EXPIRY,
    SORTS: SORTS,
    clampDays: clampDays,
    leftMapOf: leftMapOf,
    daysText: daysText,
    rank: rank,
    profile: profile,
    pager: pager,
};
