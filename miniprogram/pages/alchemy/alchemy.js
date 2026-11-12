const { createAuthMixin } = require('../../utils/auth');
const stores = require('../../utils/store');
const recipes = require('../../utils/recipes');
const ai = require('../../utils/ai');
const util = require('../../utils/util');

Page(createAuthMixin({
    data: {
        viewState: 'loading',
        foodOptions: [],
        selectedCount: 0,
        selectedNames: [],
        preselectHint: '',
        hasResult: false,
        ready: [],
        missingOne: [],
        detail: null,
        aiBusy: false,
        aiText: '',
        aiRecipe: null,
        aiError: '',
        aiSaved: false,
    },

    loadData: async function () {
        this.setData({ viewState: 'loading' });
        const results = await Promise.all([stores.ingredients.list(), stores.recipes.list()]);
        if (results[0].error) {
            this.setData({ viewState: 'error' });
            util.toast(util.errorMessage(results[0].error, '食材加载失败'));
            return;
        }
        this.cloudRows = results[1].error ? [] : (results[1].data || []);
        const rows = (results[0].data || []).filter(function (row) { return !row.consumed; });
        rows.sort(function (a, b) {
            return util.diffDays(a.expiry_on) - util.diffDays(b.expiry_on);
        });
        const preselect = wx.getStorageSync('alchemy_preselect');
        let preNames = [];
        let preFrom = '';
        if (Array.isArray(preselect)) {
            preNames = preselect.slice(0, 4);
        } else if (preselect && Array.isArray(preselect.names)) {
            preNames = preselect.names.slice(0, 4);
            preFrom = preselect.from || '';
        }
        const options = rows.slice(0, 30).map(function (row) {
            return {
                id: row.id,
                name: row.name,
                emoji: row.emoji,
                selected: preNames.indexOf(row.name) >= 0,
            };
        });
        let hint = '';
        if (preNames.length) {
            const hit = options.filter(function (item) { return item.selected; }).length;
            if (hit === 0) {
                hint = '收藏的菜还缺食材，先在冰箱里补上吧 🧺';
            } else {
                hint = preFrom === 'favorites' ? '已按收藏的菜谱勾好食材，再合成一次试试 ✨' : '已帮你勾上快过期的食材，先消灭它们 ♻️';
            }
            wx.removeStorageSync('alchemy_preselect');
        }
        this.setData({ viewState: 'ready', foodOptions: options, preselectHint: hint });
        this.syncSelected();
        if (this.data.selectedCount >= 2) this.synthesize();
    },

    onRetryData: function () { this.restore(); },

    goFridge: function () { wx.reLaunch({ url: '/pages/index/index' }); },

    syncSelected: function () {
        const names = this.data.foodOptions.filter(function (item) { return item.selected; }).map(function (item) { return item.name; });
        this.setData({ selectedNames: names, selectedCount: names.length });
    },

    onFoodTap: function (event) {
        const index = Number(event.currentTarget.dataset.index);
        const options = this.data.foodOptions.slice();
        const item = options[index];
        if (!item.selected && this.data.selectedCount >= 4) {
            util.toast('最多挑 4 样，先取消一样吧');
            return;
        }
        options[index] = Object.assign({}, item, { selected: !item.selected });
        this.setData({ foodOptions: options, hasResult: false, aiRecipe: null, aiText: '', aiError: '' });
        this.syncSelected();
    },

    onSynthesize: function () {
        if (this.data.selectedCount < 2) {
            util.toast('至少挑 2 样食材才能合成哦');
            return;
        }
        this.synthesize();
    },

    synthesize: function () {
        const result = recipes.match(this.data.selectedNames, this.cloudRows);
        this.setData({
            hasResult: true,
            ready: result.ready.slice(0, 8),
            missingOne: result.missingOne.slice(0, 8),
        });
        if (!result.ready.length && !result.missingOne.length) {
            util.toast('这组搭配有点前卫，交给 AI 吧 ✨');
        }
    },

    onRecipeTap: function (event) {
        const group = event.currentTarget.dataset.group;
        const index = Number(event.currentTarget.dataset.index);
        const list = group === 'ready' ? this.data.ready : this.data.missingOne;
        const recipe = list[index];
        if (!recipe) return;
        this.setData({
            detail: Object.assign({}, recipe, {
                mainItemsText: (recipe.mainItems || []).join('、') + ((recipe.seasonings || []).length ? '（调料：' + recipe.seasonings.join('、') + '）' : ''),
                steps: (recipe.steps || []).length ? recipe.steps : ['把食材处理好，按熟悉的方式做熟，趁热吃。'],
                missing: recipe.missing || [],
                missingText: (recipe.missing || []).join('、'),
            }),
        });
    },

    closeDetail: function () { this.setData({ detail: null }); },

    addMissing: async function (names, fromRecipe) {
        const unique = [];
        (names || []).forEach(function (name) {
            const clean = String(name || '').trim();
            if (clean && unique.indexOf(clean) < 0) unique.push(clean);
        });
        if (!unique.length) {
            util.toast('没有需要补的食材');
            return;
        }
        let success = 0;
        for (const name of unique) {
            const result = await stores.shopping.create(stores.scope({
                name: name,
                emoji: recipes.emojiFor(name),
                quantity: '',
                from_recipe: fromRecipe || '',
                done: false,
            }));
            if (!result.error) success += 1;
        }
        util.toast('已加进买菜篮 ' + success + ' 样 🧺');
    },

    onAddOneMissing: function (event) {
        this.addMissing([event.currentTarget.dataset.name], '炼金术 · 只差一样');
    },

    onAddDetailMissing: function () {
        const detail = this.data.detail;
        if (!detail) return;
        this.addMissing(detail.missing, detail.name);
        this.setData({ detail: null });
    },

    onAiCreate: async function () {
        if (this.data.aiBusy) return;
        if (this.data.selectedCount < 2) {
            util.toast('先挑 2 样以上食材，AI 才有得发挥');
            return;
        }
        this.setData({ aiBusy: true, aiText: '', aiRecipe: null, aiError: '', aiSaved: false });
        let buffer = '';
        let ticks = 0;
        const that = this;
        try {
            const recipe = await ai.creativeRecipe(this.data.selectedNames, function (delta) {
                buffer += delta;
                ticks += 1;
                if (ticks % 6 === 0) that.setData({ aiText: buffer.slice(-260) });
            });
            this.setData({
                aiBusy: false,
                aiText: '',
                aiRecipe: Object.assign({}, recipe, { extraText: (recipe.extra || []).join('、') }),
            });
        } catch (error) {
            this.setData({
                aiBusy: false,
                aiText: '',
                aiError: util.errorMessage(error, 'AI 大厨走神了，稍后再试一次'),
            });
        }
    },

    onSaveAi: async function () {
        const recipe = this.data.aiRecipe;
        if (!recipe || this.data.aiSaved) return;
        // extra 是「还需买的食材」而不是调料，并入用料后才能参与缺货判定与反查匹配。
        const mainItems = this.data.selectedNames.slice();
        (recipe.extra || []).forEach(function (name) {
            const clean = String(name || '').trim();
            if (clean && mainItems.indexOf(clean) < 0) mainItems.push(clean);
        });
        const result = await stores.recipes.create(stores.scope({
            name: recipe.name,
            emoji: recipe.emoji,
            main_items: mainItems,
            seasonings: [],
            steps: recipe.steps || [],
            minutes: recipe.minutes,
            difficulty: recipe.difficulty,
            tags: (recipe.tags || []).concat(['AI 创意']),
            source: 'ai',
        }));
        if (result.error) {
            util.toast(util.errorMessage(result.error, '收藏失败，请重试'));
            return;
        }
        this.setData({ aiSaved: true });
        util.toast('已收进「我的收藏」，随时能翻出来做 ✨');
        await this.loadData();
    },

    goFavorites: function () {
        wx.navigateTo({
            url: '/pages/favorites/favorites',
            fail: function () { wx.reLaunch({ url: '/pages/favorites/favorites' }); },
        });
    },

    onAiToShopping: function () {
        const recipe = this.data.aiRecipe;
        if (!recipe) return;
        this.addMissing(recipe.extra || [], recipe.name);
    },
}));
