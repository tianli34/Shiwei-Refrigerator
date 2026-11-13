const { createAuthMixin } = require('../../utils/auth');
const stores = require('../../utils/store');
const util = require('../../utils/util');
const subscribe = require('../../utils/subscribe');
const dict = require('../../utils/food-dict');
const foodNames = require('../../utils/food-names');

Page(createAuthMixin({
    data: {
        viewState: 'ready',
        userLabel: '',
        householdLabel: '还没加入共享冰箱',
        stats: { foods: 0, urgent: 0, shopping: 0, aiRecipes: 0 },
        reminderOn: true,
        subscribeHint: subscribe.hint(),
        nameRegion: 'common',
        nameRegionLabel: '通用叫法',
        nameRegions: [],
        nameUnified: false,
        nameSyncHint: '',
        namePrefCount: 0,
        showRegionSheet: false,
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
        const status = foodNames.status();
        const pack = dict.REGION_PACKS[status.region] || dict.REGION_PACKS.common;
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
            subscribeHint: subscribe.hint(),
            nameRegion: status.region,
            nameRegionLabel: pack.label,
            nameRegions: dict.regionList().map(function (item) {
                return Object.assign({}, item, { on: item.key === status.region });
            }),
            nameUnified: status.unified,
            namePrefCount: status.prefCount,
            nameSyncHint: status.cloudOk
                ? '已同步到云端，换设备也认得你的叫法'
                : ('暂用本机设置' + (status.error ? ' · ' + status.error : '')),
        });
    },

    onReminderChange: function (event) {
        const on = event.detail.value;
        wx.setStorageSync('reminder_on', on);
        this.setData({ reminderOn: on });
        util.toast(on ? '临期提醒已打开 ⏰' : '临期提醒已关闭');
    },

    // 唤起微信订阅授权弹窗。一次性订阅：每 accept 一次累积 1 条下发额度。
    onSubscribeTap: async function () {
        const result = await subscribe.request();
        if (result.state === 'ban') {
            wx.showModal({
                title: '订阅消息已关闭',
                content: '之前在微信里关闭了这个小程序的订阅消息，需要到设置里重新打开。',
                confirmText: '去设置',
                success: function (res) {
                    if (res.confirm && typeof wx.openSetting === 'function') wx.openSetting({});
                },
            });
            return;
        }
        util.toast(result.message);
        this.setData({ subscribeHint: subscribe.hint() });
    },

    // ---------- 千人千面：叫法偏好 ----------
    onOpenRegion: function () { this.setData({ showRegionSheet: true }); },
    onCloseRegion: function () { this.setData({ showRegionSheet: false }); },

    onPickRegion: async function (event) {
        const key = event.currentTarget.dataset.key;
        const pack = dict.REGION_PACKS[key];
        if (!pack) return;
        await foodNames.setRegion(key);
        this.setData({ showRegionSheet: false });
        util.toast('已切换为「' + pack.label + '」');
        await this.loadData();
    },

    onUnifiedChange: async function (event) {
        const on = event.detail.value;
        await foodNames.setHouseholdUnified(on);
        util.toast(on ? '已统一全家叫法 🏡' : '已改为各叫各的');
        await this.loadData();
    },

    // 预览将来微信服务通知里会出现的食材叫法。
    onPreviewNotice: async function () {
        const result = await stores.ingredients.list();
        const rows = (result.error ? [] : (result.data || []))
            .filter(function (row) { return !row.consumed && util.diffDays(row.expiry_on) <= 2; })
            .slice(0, 3)
            .map(function (row) { return foodNames.decorate(row); });
        const demoId = dict.BY_CANONICAL['番茄'];
        const text = subscribe.expiryNoticeText(rows) ||
            subscribe.expiryNoticeText([{ food_id: demoId }]);
        wx.showModal({ title: '提醒预览', content: text, showCancel: false, confirmText: '知道了' });
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
