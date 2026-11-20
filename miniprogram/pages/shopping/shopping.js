const { createAuthMixin } = require('../../utils/auth');
const stores = require('../../utils/store');
const recipes = require('../../utils/recipes');
const util = require('../../utils/util');
const dict = require('../../utils/food-dict');
const foodNames = require('../../utils/food-names');

Page(createAuthMixin({
    data: {
        viewState: 'loading',
        pendingItems: [],
        doneItems: [],
        pendingCount: 0,
        newName: '',
        namePicker: null,
    },

    loadData: async function () {
        this.setData({ viewState: 'loading' });
        const result = await stores.shopping.list();
        if (result.error) {
            this.setData({ viewState: 'error' });
            util.toast(util.errorMessage(result.error, '清单加载失败'));
            return;
        }
        const rows = foodNames.decorateList(result.data || []);
        this.setData({
            viewState: 'ready',
            pendingItems: rows.filter(function (row) { return !row.done; }),
            doneItems: rows.filter(function (row) { return row.done; }),
            pendingCount: rows.filter(function (row) { return !row.done; }).length,
        });
    },

    onRetryData: function () { this.restore(); },
    goRecommend: function () { wx.reLaunch({ url: '/pages/alchemy/alchemy' }); },
    onNewName: function (event) { this.setData({ newName: event.detail.value }); },

    onAdd: async function () {
        const name = String(this.data.newName || '').trim();
        if (!name) {
            util.toast('写下想买的东西吧');
            return;
        }
        const resolved = dict.resolve(name);
        let foodId = resolved.id;
        let canonical = resolved.canonical || name;
        if (resolved.status === 'ambiguous') {
            const picked = await foodNames.askAmbiguous(resolved.candidates);
            if (!picked) {
                util.toast('已取消，换个叫法再试一次');
                return;
            }
            foodId = picked;
            canonical = dict.canonicalOf(picked);
        }
        if (!foodId) foodId = 'custom:' + dict.clean(name);
        const result = await stores.shopping.create(stores.scope({
            name: canonical,
            food_id: foodId,
            raw_name: name,
            emoji: dict.meta(foodId).emoji,
            quantity: '',
            from_recipe: '',
            done: false,
        }));
        if (result.error) {
            util.toast(util.errorMessage(result.error, '没加上，请重试'));
            return;
        }
        foodNames.learn(name, foodId);
        this.setData({ newName: '' });
        await this.loadData();
    },

    onToggle: async function (event) {
        const id = event.currentTarget.dataset.id;
        const next = event.currentTarget.dataset.done === '1' ? false : true;
        const result = await stores.shopping.update(id, { done: next });
        if (result.error) {
            util.toast(util.errorMessage(result.error, '没能划掉'));
            return;
        }
        await this.loadData();
    },

    onRemove: async function (event) {
        const id = event.currentTarget.dataset.id;
        const result = await stores.shopping.remove(id);
        if (result.error) {
            util.toast(util.errorMessage(result.error, '移除失败'));
            return;
        }
        await this.loadData();
    },

    onClearDone: function () {
        const list = this.data.doneItems;
        const that = this;
        if (!list.length) return;
        wx.showModal({
            title: '清空已买到',
            content: '把已经买到的 ' + list.length + ' 样从清单里删掉？',
            success: async function (res) {
                if (!res.confirm) return;
                for (const item of list) {
                    await stores.shopping.remove(item.id);
                }
                await that.loadData();
            },
        });
    },

    // 复制给一起做饭的人，用当前冰箱的叫法更亲切；发给外部好友的点菜板走通用名。
    buildListText: function () {
        const lines = this.data.pendingItems.map(function (item, index) {
            return (index + 1) + '. ' + (item.display || item.name) + (item.from_recipe ? '（' + item.from_recipe + '）' : '');
        });
        return '拾味冰箱 · 买菜清单 🧺\n' + (lines.length ? lines.join('\n') : '暂时什么都不缺～');
    },

    onCopyList: function () {
        const text = this.buildListText();
        wx.setClipboardData({
            data: text,
            success: function () { util.toast('清单已复制，发给 TA 吧 💌'); },
            fail: function () { util.toast('复制失败，请重试'); },
        });
    },

    onItemNameTap: function (event) {
        const id = event.currentTarget.dataset.id;
        if (!id || dict.isCustom(id)) {
            util.toast('自定义食材可以直接编辑名字');
            return;
        }
        this.setData({
            namePicker: {
                foodId: id,
                current: foodNames.displayName(id),
                names: foodNames.availableNames(id),
                scopeHint: foodNames.status().unified ? '家庭统一叫法，会同步给同冰箱成员' : '只对你自己生效',
            },
        });
    },

    onNamePickerClose: function () { this.setData({ namePicker: null }); },

    onNamePickerPick: async function (event) {
        const picker = this.data.namePicker;
        if (!picker) return;
        await foodNames.setPreference(picker.foodId, event.detail.name, {
            scope: foodNames.status().unified ? 'household' : 'personal',
        });
        this.setData({ namePicker: null });
        util.toast('以后就叫它「' + event.detail.name + '」啦');
        await this.loadData();
    },

    onNamePickerReset: async function () {
        const picker = this.data.namePicker;
        if (!picker) return;
        await foodNames.clearPreference(picker.foodId, foodNames.status().unified ? 'household' : 'personal');
        this.setData({ namePicker: null });
        await this.loadData();
    },

    onShareAppMessage: function () {
        return {
            title: '帮我顺路买 ' + this.data.pendingCount + ' 样食材 🧺｜拾味冰箱',
            path: '/pages/shopping/shopping',
            desc: '买一样划掉一样，全家实时同步',
        };
    },
}));
