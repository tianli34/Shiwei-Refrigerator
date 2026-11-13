// 微信订阅消息 · 一次性订阅「食物临期提醒」
// 模板 ID 来自小程序后台「订阅消息 → 我的模板」。
// 关键词顺序（提交后不可修改）：食物名称 / 到期时间 / 剩余天数 / 剩余数量 / 温馨提示。
//
// 注意：这里只完成「用户授权」。真正下发必须由服务端调用 subscribeMessage.send，
// 一次性订阅每 accept 一次只获得 1 条下发额度，额度需要服务端记账；
// 本文件的本地记录仅用于界面状态展示，不代表可下发次数。
const TEMPLATE_ID = 'qgNrO6iTHFH-O-lXuueIY-JpgUkNFkYafSc61wTETro';
const STATE_KEY = 'subscribe_expiry_state';
const foodNames = require('./food-names');

// 临期文案统一由这里产出：应用内提醒条与将来服务端下发的订阅消息共用同一套叫法。
function displayOf(row) {
    if (row.food_id) return foodNames.displayName(row.food_id);
    return foodNames.labelOf(row.name);
}

function expiringNamesText(rows) {
    return (rows || []).slice(0, 3).map(function (row) {
        const label = (row.fresh && row.fresh.label) || '';
        return displayOf(row) + (label ? '(' + label + ')' : '');
    }).join('、');
}

// 服务端调用 subscribeMessage.send 时，食物名称字段应传这个结果。
function expiryNoticeText(rows) {
    const list = (rows || []).slice(0, 3).map(displayOf).filter(Boolean);
    if (!list.length) return '';
    return '您的【' + list.join('、') + '】还有 2 天过期，点击查看能消耗它们的快手菜！';
}

function localState() {
    const saved = wx.getStorageSync(STATE_KEY);
    return saved && typeof saved === 'object' ? saved : { accepted: false, acceptedAt: 0 };
}

function hint() {
    return localState().accepted
        ? '已授权 · 每授权一次可收 1 条提醒，重复点击可累积'
        : '点击授权，食材剩 2 天时由微信推送提醒';
}

// 必须由用户点击触发（bindtap），不能在一进入页面时自动调用。
function request() {
    return new Promise(function (resolve) {
        if (typeof wx.requestSubscribeMessage !== 'function') {
            resolve({ ok: false, state: 'unsupported', message: '当前微信版本不支持订阅消息' });
            return;
        }
        wx.requestSubscribeMessage({
            tmplIds: [TEMPLATE_ID],
            success: function (res) {
                const state = res[TEMPLATE_ID] || 'reject';
                const ok = state === 'accept';
                if (ok) wx.setStorageSync(STATE_KEY, { accepted: true, acceptedAt: Date.now() });
                resolve({
                    ok: ok,
                    state: state,
                    message: ok
                        ? '订阅成功，临期时微信会提醒你'
                        : (state === 'ban'
                            ? '你已关闭该小程序的订阅消息'
                            : (state === 'filter' ? '模板被微信过滤，请检查模板状态' : '你取消了订阅')),
                });
            },
            fail: function () {
                resolve({ ok: false, state: 'fail', message: '订阅失败，请稍后再试' });
            },
        });
    });
}

module.exports = {
    TEMPLATE_ID: TEMPLATE_ID,
    hint: hint,
    request: request,
    expiringNamesText: expiringNamesText,
    expiryNoticeText: expiryNoticeText,
};
