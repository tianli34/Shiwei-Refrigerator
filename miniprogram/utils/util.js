const ZONES = [
    { key: 'cold', label: '冷藏室', emoji: '❄️', hint: '2~6℃ · 新鲜优先吃' },
    { key: 'freeze', label: '冷冻室', emoji: '🧊', hint: '-18℃ · 慢慢来也行' },
    { key: 'room', label: '常温区', emoji: '🧺', hint: '阴凉处 · 别忘了我' },
];

const COMMON_FOODS = [
    { name: '鸡蛋', emoji: '🥚', zone: 'cold', shelfDays: 20 },
    { name: '牛奶', emoji: '🥛', zone: 'cold', shelfDays: 5 },
    { name: '番茄', emoji: '🍅', zone: 'cold', shelfDays: 6 },
    { name: '土豆', emoji: '🥔', zone: 'room', shelfDays: 20 },
    { name: '鸡胸肉', emoji: '🍗', zone: 'cold', shelfDays: 3 },
    { name: '排骨', emoji: '🍖', zone: 'freeze', shelfDays: 60 },
    { name: '米饭', emoji: '🍚', zone: 'cold', shelfDays: 2 },
    { name: '青菜', emoji: '🥬', zone: 'cold', shelfDays: 4 },
    { name: '西兰花', emoji: '🥦', zone: 'cold', shelfDays: 5 },
    { name: '胡萝卜', emoji: '🥕', zone: 'cold', shelfDays: 12 },
    { name: '洋葱', emoji: '🧅', zone: 'room', shelfDays: 20 },
    { name: '香菇', emoji: '🍄', zone: 'cold', shelfDays: 5 },
    { name: '豆腐', emoji: '🧈', zone: 'cold', shelfDays: 3 },
    { name: '香蕉', emoji: '🍌', zone: 'room', shelfDays: 5 },
    { name: '面包', emoji: '🍞', zone: 'room', shelfDays: 4 },
    { name: '酸奶', emoji: '🥣', zone: 'cold', shelfDays: 10 },
    { name: '牛肉', emoji: '🥩', zone: 'freeze', shelfDays: 60 },
    { name: '意面', emoji: '🍝', zone: 'room', shelfDays: 180 },
];

function pad(n) {
    return n < 10 ? '0' + n : '' + n;
}

function dateString(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function today() {
    return dateString(new Date());
}

function addDays(base, days) {
    const parts = String(base || today()).split('-');
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    date.setDate(date.getDate() + Number(days || 0));
    return dateString(date);
}

function diffDays(target) {
    if (!target) return 999;
    const parts = String(target).slice(0, 10).split('-');
    const a = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const now = new Date();
    const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((a - b) / 86400000);
}

// 「快过期」只指还没坏的那 2 天。已过期（left < 0）单独成桶，
// 否则整冰箱都过期时会被说成「27 样快过期啦」，等于没提醒。
const URGENT_DAYS = 2;

function leftOf(row) {
    if (row && row.fresh && typeof row.fresh.left === 'number') return row.fresh.left;
    return diffDays(row && row.expiry_on);
}

// 首页提醒条、我的统计、订阅文案预览都从这里取，口径只留一处。
function expiryBuckets(rows) {
    const expired = [];
    const urgent = [];
    (rows || []).forEach(function (row) {
        const left = leftOf(row);
        if (left < 0) expired.push(row);
        else if (left <= URGENT_DAYS) urgent.push(row);
    });
    // 过期最久 / 最快到期的排前面：提醒条只露前几个名字，得挑最该先处理的。
    const byLeft = function (a, b) { return leftOf(a) - leftOf(b); };
    expired.sort(byLeft);
    urgent.sort(byLeft);
    return { expired: expired, urgent: urgent };
}

// 保质期进度：绿 → 黄 → 红，返回渲染所需的全部字段，避免在 WXML 里做计算。
function freshness(row) {
    const left = diffDays(row.expiry_on);
    const total = Math.max(1, Number(row.shelf_days) || 3);
    const used = Math.max(0, Math.min(total, total - left));
    const percent = Math.max(4, Math.min(100, Math.round((used / total) * 100)));
    let level = 'fresh';
    let label = '还剩 ' + left + ' 天';
    if (left < 0) {
        level = 'expired';
        label = '已过期 ' + Math.abs(left) + ' 天';
    } else if (left === 0) {
        level = 'urgent';
        label = '今天到期！';
    } else if (left <= 2) {
        level = 'urgent';
        label = '还剩 ' + left + ' 天';
    } else if (left <= Math.max(3, Math.ceil(total * 0.35))) {
        level = 'soon';
    }
    return { left: left, percent: percent, level: level, label: label };
}

function makeCode(length) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < (length || 6); i += 1) {
        out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
}

function pick(source, fields) {
    const out = {};
    if (!source) return out;
    for (const key of fields) {
        if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
            out[key] = source[key];
        }
    }
    return out;
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function toast(title, icon) {
    wx.showToast({ title: title, icon: icon || 'none', duration: 1800 });
}

function errorMessage(error, fallback) {
    if (error && typeof error.message === 'string' && error.message) return error.message;
    return fallback || '操作失败，请稍后重试';
}

module.exports = {
    ZONES: ZONES,
    COMMON_FOODS: COMMON_FOODS,
    URGENT_DAYS: URGENT_DAYS,
    today: today,
    addDays: addDays,
    diffDays: diffDays,
    leftOf: leftOf,
    expiryBuckets: expiryBuckets,
    freshness: freshness,
    makeCode: makeCode,
    pick: pick,
    safeArray: safeArray,
    toast: toast,
    errorMessage: errorMessage,
};
