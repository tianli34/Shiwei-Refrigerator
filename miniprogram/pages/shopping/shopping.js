const { createAuthMixin } = require('../../utils/auth');
const stores = require('../../utils/store');
const recipes = require('../../utils/recipes');
const util = require('../../utils/util');

Page(createAuthMixin({
    data: {
        viewState: 'loading',
        pendingItems: [],
        doneItems: [],
        pendingCount: 0,
        newName: '',
    },

    loadData: async function () {
        this.setData({ viewState: 'loading' });
        const result = await stores.shopping.list();
        if (result.error) {
            this.setData({ viewState: 'error' });
            util.toast(util.errorMessage(result.error, '清单加载失败'));
            return;
        }
        const rows = result.data || [];
        this.setData({
            viewState: 'ready',
            pendingItems: rows.filter(function (row) { return !row.done; }),
            doneItems: rows.filter(function (row) { return row.done; }),
            pendingCount: rows.filter(function (row) { return !row.done; }).length,
        });
    },

    onRetryData: function () { this.restore(); },
    goAlchemy: function () { wx.reLaunch({ url: '/pages/alchemy/alchemy' }); },
    onNewName: function (event) { this.setData({ newName: event.detail.value }); },

    onAdd: async function () {
        const name = String(this.data.newName || '').trim();
        if (!name) {
            util.toast('写下想买的东西吧');
            return;
        }
        const result = await stores.shopping.create(stores.scope({
            name: name,
            emoji: recipes.emojiFor(name),
            quantity: '',
            from_recipe: '',
            done: false,
        }));
        if (result.error) {
            util.toast(util.errorMessage(result.error, '没加上，请重试'));
            return;
        }
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

    buildListText: function () {
        const lines = this.data.pendingItems.map(function (item, index) {
            return (index + 1) + '. ' + item.name + (item.from_recipe ? '（' + item.from_recipe + '）' : '');
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

    onShareAppMessage: function () {
        return {
            title: '帮我顺路买 ' + this.data.pendingCount + ' 样食材 🧺｜拾味冰箱',
            path: '/pages/shopping/shopping',
            desc: '买一样划掉一样，全家实时同步',
        };
    },
}));
