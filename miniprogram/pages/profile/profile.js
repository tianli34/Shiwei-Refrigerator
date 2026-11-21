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
        stats: { foods: 0, urgent: 0, expired: 0, shopping: 0, aiRecipes: 0 },
        reminderOn: true,
        subscribeHint: subscribe.hint(),
        nameRegion: 'common',
        nameRegionLabel: '通用叫法',
        nameRegions: [],
        nameUnified: false,
        nameSyncHint: '',
        namePrefCount: 0,
        showRegionSheet: false,
        clearHint: '冰箱现在是空的',
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
        // 和首页共用一套口径：快过期只数 0~2 天，已过期的另算。
        const buckets = util.expiryBuckets(active);
        const user = this.data.user || {};
        const app = getApp();
        const status = foodNames.status();
        const pack = dict.REGION_PACKS[status.region] || dict.REGION_PACKS.common;
        this.setData({
            stats: {
                foods: active.length,
                urgent: buckets.urgent.length,
                expired: buckets.expired.length,
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
            // 把「会删掉别人的东西」这件事写在按钮下面，而不是等 ta 点开才知道。
            clearHint: active.length
                ? (app.householdKey
                    ? '会删掉共享冰箱里全部 ' + active.length + ' 样，包括家人录的'
                    : '现在冰箱里有 ' + active.length + ' 样')
                : '冰箱现在是空的',
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
    // 推送模板写的是「还有 2 天过期」，已过期的食材不能混进来，否则文案自己打脸。
    onPreviewNotice: async function () {
        const result = await stores.ingredients.list();
        const rows = util.expiryBuckets((result.error ? [] : (result.data || []))
            .filter(function (row) { return !row.consumed; }))
            .urgent.slice(0, 3)
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

    // ---------- 冰箱清理 ----------
    // 全柜清空是不可恢复的，所以「双确认」用输入框做实打实的动作确认：
    // 弹窗写明影响范围（共享冰箱会连带删掉家人录的），还要手输「清空」两个字。
    // 只多花三秒，但能挡住「本来想清过期，顺手把整个冰箱清了」。
    onClearFridge: function () {
        const count = this.data.stats.foods;
        if (!count) {
            util.toast('冰箱已经是空的');
            return;
        }
        const app = getApp();
        const scope = app && app.householdKey
            ? '共享冰箱里的 ' + count + ' 样会全部删掉，包括家人录的，'
            : '冰箱里的 ' + count + ' 样会全部删掉，';
        const that = this;
        wx.showModal({
            title: '清空整个冰箱？',
            content: scope + '删掉就找不回来了。清完「已吃掉」的统计不会变。',
            editable: true,
            placeholderText: '想清楚了就输入：清空',
            confirmText: '确认清空',
            confirmColor: '#B4503A',
            success: function (res) {
                if (!res.confirm) return;
                if (String(res.content || '').trim() !== '清空') {
                    util.toast('没有输入「清空」，这次不动它');
                    return;
                }
                that.clearFridge();
            },
        });
    },

    clearFridge: async function () {
        wx.showLoading({ title: '正在清空冰箱', mask: true });
        const result = await stores.ingredients.list();
        if (result.error) {
            wx.hideLoading();
            util.toast(util.errorMessage(result.error, '清空失败，请重试'));
            return;
        }
        // 只清冰箱里看得见的那些：已标记「吃掉了」的行本来就不占版面，
        // 顺手删掉会让「已吃掉次数」的账对不上，所以留着。
        const rows = (result.data || []).filter(function (row) { return !row.consumed; });
        const outcome = await stores.removeEach(stores.ingredients, rows);
        wx.hideLoading();
        if (outcome.failed) {
            util.toast('清掉 ' + outcome.removed + ' 样，还有 ' + outcome.failed + ' 样没删掉，再试一次');
        } else {
            util.toast('冰箱空了，' + outcome.removed + ' 样都出去了 🧹');
        }
        await this.loadData();
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
