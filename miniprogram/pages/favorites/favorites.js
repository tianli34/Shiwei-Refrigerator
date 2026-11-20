// 我的收藏：AI 创意菜的落脚点 —— 能翻阅、能复用、能取消。
const { createAuthMixin } = require('../../utils/auth');
const stores = require('../../utils/store');
const recipeLib = require('../../utils/recipes');
const util = require('../../utils/util');
const dict = require('../../utils/food-dict');
const foodNames = require('../../utils/food-names');

// 收藏时间只用来做轻提示，今年不重复显示年份。
function formatSavedOn(value) {
    const parts = String(value || '').slice(0, 10).split('-');
    if (parts.length !== 3 || !parts[0]) return '';
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!month || !day) return '';
    if (Number(parts[0]) === new Date().getFullYear()) return month + '月' + day + '日';
    return parts[0] + '年' + month + '月' + day + '日';
}

// 把云端行整理成渲染直接可用的结构，避免在 WXML 里做计算。
// countMap 的键是合池 id（'c12'），这里拿到的却是云端裸行，必须用 recipeKey 补前缀。
function decorate(row, ownedIds, countMap) {
    const items = recipeLib.cloudRecipeItems(row);
    const n = Number((countMap || {})[recipeLib.recipeKey(row)]);
    const mainItems = items.mainItems;
    const seasonings = items.seasonings;
    const steps = (Array.isArray(row.steps) ? row.steps : []).filter(Boolean);
    // 判定统一走 explain：子类顶父类算命中，父类顶子类不算，并留下提示语。
    const info = recipeLib.explain(ownedIds, mainItems);
    const matched = info.matched;
    const missing = info.missing;
    const savedOn = formatSavedOn(row.created_at);
    let statusText = '随手搭配';
    let statusKind = 'far';
    if (mainItems.length > 0) {
        if (missing.length === 0) {
            statusText = '现在能做';
            statusKind = 'ready';
        } else if (matched.length > 0) {
            statusText = '只差 ' + missing.length + ' 样';
            statusKind = 'half';
        } else {
            statusText = '要先补货';
        }
    }
    return {
        id: String(row.id),
        name: row.name || '无名创意菜',
        emoji: row.emoji || '✨',
        minutes: row.minutes || 20,
        difficulty: row.difficulty || '有趣',
        tags: (Array.isArray(row.tags) ? row.tags : []).filter(function (tag) { return tag !== 'AI 创意'; }).slice(0, 3),
        mainItems: mainItems,
        mainItemsText: foodNames.joinLabels(mainItems),
        seasoningsText: foodNames.joinLabels(seasonings),
        approxText: info.approxText,
        hintText: info.hintText,
        steps: steps.length ? steps : ['这道菜当时没留下步骤，凭手感发挥吧。'],
        savedOn: savedOn,
        savedText: savedOn ? savedOn + '收藏' : '收藏在册',
        matchedNames: matched,
        missing: missing,
        missingText: info.missingText,
        canCook: mainItems.length > 0 && missing.length === 0,
        statusText: statusText,
        statusKind: statusKind,
        cookCount: Number.isFinite(n) && n > 0 ? n : 0,
    };
}

Page(createAuthMixin({
    data: {
        viewState: 'loading',
        filter: 'all',
        counts: { all: 0, ready: 0 },
        visible: [],
        detail: null,
    },

    loadData: async function () {
        this.setData({ viewState: 'loading' });
        const results = await Promise.all([stores.recipes.list(), stores.ingredients.list(), stores.cookCountMap()]);
        if (results[0].error) {
            this.items = [];
            this.setData({ viewState: 'error', visible: [], counts: { all: 0, ready: 0 } });
            util.toast(util.errorMessage(results[0].error, '收藏没取出来'));
            return;
        }
        const rows = (results[0].data || []).filter(function (row) { return row.source === 'ai'; });
        const fridge = results[1].error ? [] : (results[1].data || []);
        const ownedIds = fridge.filter(function (row) { return !row.consumed; }).map(function (row) {
            return row.food_id || recipeLib.toFoodId(row.name);
        }).filter(Boolean);
        const counts = results[2] || {};
        this.items = rows.map(function (row) { return decorate(row, ownedIds, counts); });
        this.setData({
            viewState: 'ready',
            counts: {
                all: this.items.length,
                ready: this.items.filter(function (item) { return item.canCook; }).length,
            },
        });
        this.applyFilter();
    },

    applyFilter: function () {
        const items = this.items || [];
        const filter = this.data.filter;
        this.setData({
            visible: filter === 'ready' ? items.filter(function (item) { return item.canCook; }) : items.slice(),
        });
    },

    onFilterTap: function (event) {
        const filter = event.currentTarget.dataset.filter;
        if (!filter || filter === this.data.filter) return;
        this.setData({ filter: filter });
        this.applyFilter();
    },

    onCardTap: function (event) {
        const id = String(event.currentTarget.dataset.id || '');
        const hit = (this.items || []).filter(function (item) { return item.id === id; })[0];
        if (!hit) return;
        this.setData({ detail: hit });
    },

    closeDetail: function () { this.setData({ detail: null }); },

    onCardLongPress: function (event) {
        const id = String(event.currentTarget.dataset.id || '');
        const hit = (this.items || []).filter(function (item) { return item.id === id; })[0];
        if (!hit) return;
        this.confirmRemove(hit);
    },

    onRemoveTap: function () {
        const detail = this.data.detail;
        if (!detail) return;
        this.confirmRemove(detail);
    },

    confirmRemove: function (item) {
        const that = this;
        wx.showModal({
            title: '取消收藏这道菜？',
            content: '「' + item.name + '」会从收藏里移除，下次合成时也不再自动出现。',
            confirmText: '取消收藏',
            confirmColor: '#D97070',
            cancelText: '再想想',
            success: function (res) {
                if (res.confirm) that.removeRecipe(item);
            },
        });
    },

    removeRecipe: async function (item) {
        if (this.removing) return;
        this.removing = true;
        wx.showLoading({ title: '正在移除', mask: true });
        const result = await stores.recipes.remove(item.id);
        wx.hideLoading();
        this.removing = false;
        if (result.error) {
            util.toast(util.errorMessage(result.error, '取消失败，请重试'));
            return;
        }
        this.items = (this.items || []).filter(function (row) { return row.id !== item.id; });
        this.setData({
            detail: null,
            counts: {
                all: this.items.length,
                ready: this.items.filter(function (row) { return row.canCook; }).length,
            },
        });
        this.applyFilter();
        util.toast('已取消收藏');
    },

    // 推荐页进页就按冰箱现有食材重算，这里只需要把人带过去。
    onCookAgain: function () {
        wx.reLaunch({ url: '/pages/alchemy/alchemy' });
    },

    onAddMissing: async function () {
        const detail = this.data.detail;
        if (!detail) return;
        const missing = (detail.missing || []).filter(Boolean);
        if (!missing.length) {
            util.toast('这道菜不缺食材啦');
            return;
        }
        const seen = {};
        const unique = [];
        missing.forEach(function (name) {
            const id = recipeLib.toFoodId(name);
            if (seen[id]) return;
            seen[id] = true;
            unique.push({ name: dict.canonicalOf(id) || name, id: id, raw: name });
        });
        let success = 0;
        for (const item of unique) {
            const result = await stores.shopping.create(stores.scope({
                name: item.name,
                food_id: item.id,
                raw_name: item.raw,
                emoji: dict.meta(item.id).emoji,
                quantity: '',
                from_recipe: detail.name,
                done: false,
            }));
            if (!result.error) success += 1;
        }
        util.toast(success ? '已加进买菜篮 ' + success + ' 样 🧺' : '加入买菜篮失败，稍后再试');
        this.setData({ detail: null });
    },

    onRetryData: function () { this.restore(); },

    goRecommend: function () { wx.reLaunch({ url: '/pages/alchemy/alchemy' }); },
    goFridge: function () { wx.reLaunch({ url: '/pages/index/index' }); },
}));
