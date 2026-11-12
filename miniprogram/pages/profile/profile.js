const { createAuthMixin } = require('../../utils/auth');
const stores = require('../../utils/store');
const util = require('../../utils/util');

Page(createAuthMixin({
    data: {
        viewState: 'ready',
        userLabel: '',
        householdLabel: '还没加入共享冰箱',
        stats: { foods: 0, urgent: 0, shopping: 0, aiRecipes: 0 },
        reminderOn: true,
    },

    loadData: async function () {
        const results = await Promise.all([
            stores.ingredients.list(),
            stores.shopping.list(),
            stores.recipes.list(),
        ]);
        const foods = results[0].error ? [] : (results[0].data || []);
        const shopping = results[1].error ? [] : (results[1].data || []);
        const saved = results[2].error ? [] : (results[2].data || []);
        const active = foods.filter(function (row) { return !row.consumed; });
        const user = this.data.user || {};
        const app = getApp();
        this.setData({
            stats: {
                foods: active.length,
                urgent: active.filter(function (row) { return util.diffDays(row.expiry_on) <= 2; }).length,
                shopping: shopping.filter(function (row) { return !row.done; }).length,
                aiRecipes: saved.filter(function (row) { return row.source === 'ai'; }).length,
            },
            userLabel: user.name || user.email || app.userName || '厨房小管家',
            householdLabel: app.householdName ? '🏡 ' + app.householdName + ' · 实时同步' : '还没加入共享冰箱',
            reminderOn: wx.getStorageSync('reminder_on') !== false,
        });
    },

    onReminderChange: function (event) {
        const on = event.detail.value;
        wx.setStorageSync('reminder_on', on);
        this.setData({ reminderOn: on });
        util.toast(on ? '临期提醒已打开 ⏰' : '临期提醒已关闭');
    },

    onSubscribeTap: function () {
        wx.showModal({
            title: '微信服务通知',
            content: '应用内的临期提醒已经可以使用。若要让微信在食材剩 2 天时主动推送服务通知，需要在小程序后台申请订阅消息模板并配置定时下发，这一步请在正式发布前完成。',
            showCancel: false,
            confirmText: '知道了',
        });
    },

    // 用户在客服会话里点击小程序消息卡片返回时，按卡片携带的 path / query 回到对应页面。
    onContact: function (event) {
        const detail = event.detail || {};
        if (!detail.path || typeof detail.path !== 'string') return;
        const query = detail.query || {};
        const parts = Object.keys(query).map(function (key) {
            return encodeURIComponent(key) + '=' + encodeURIComponent(query[key]);
        });
        const url = detail.path + (parts.length ? '?' + parts.join('&') : '');
        wx.navigateTo({ url: url, fail: function () { wx.reLaunch({ url: url }); } });
    },

    goFamily: function () { wx.reLaunch({ url: '/pages/family/family' }); },
    goFridge: function () { wx.reLaunch({ url: '/pages/index/index' }); },
    goFavorites: function () {
        wx.navigateTo({
            url: '/pages/favorites/favorites',
            fail: function () { wx.reLaunch({ url: '/pages/favorites/favorites' }); },
        });
    },
}));
