const { createAuthMixin } = require('../../utils/auth');
const stores = require('../../utils/store');
const recipes = require('../../utils/recipes');
const ai = require('../../utils/ai');
const util = require('../../utils/util');
const dict = require('../../utils/food-dict');
const foodNames = require('../../utils/food-names');

// 预选数据可能是新版的 food_id，也可能是改造前留下的中文名，统一转成 ID。
function toId(value) {
    const raw = String(value || '');
    if (!raw) return '';
    if (dict.BY_ID[raw] || dict.isCustom(raw)) return raw;
    return dict.resolveId(raw) || '';
}

Page(createAuthMixin({
    data: {
        viewState: 'loading',
        foodOptions: [],
        selectedCount: 0,
        selectedNames: [],
        selectedIds: [],
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
        const rows = foodNames.decorateList((results[0].data || []).filter(function (row) { return !row.consumed; }));
        rows.sort(function (a, b) {
            return util.diffDays(a.expiry_on) - util.diffDays(b.expiry_on);
        });
        const preselect = wx.getStorageSync('alchemy_preselect');
        let preIds = [];
        let preFrom = '';
        if (Array.isArray(preselect)) {
            preIds = preselect.map(toId).filter(Boolean);
        } else if (preselect && (Array.isArray(preselect.ids) || Array.isArray(preselect.names))) {
            const raw = (preselect.ids && preselect.ids.length) ? preselect.ids : (preselect.names || []);
            preIds = raw.map(toId).filter(Boolean);
            preFrom = preselect.from || '';
        }
        const options = rows.slice(0, 30).map(function (row) {
            return {
                id: row.id,
                name: row.canonical || row.name,
                display: row.display,
                food_id: row.food_id,
                emoji: row.emoji,
                selected: preIds.indexOf(row.food_id) >= 0,
            };
        });
        let hint = '';
        if (preIds.length) {
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
        const picked = this.data.foodOptions.filter(function (item) { return item.selected; });
        this.setData({
            // 匹配、入库、跨页传值一律用身份；selectedNames 只留给 AI 与菜谱快照。
            selectedIds: picked.map(function (item) { return item.food_id; }).filter(Boolean),
            selectedNames: picked.map(function (item) { return item.name; }),
            selectedCount: picked.length,
        });
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
        const result = recipes.match(this.data.selectedIds, this.cloudRows);
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
        const seasonings = recipe.seasonings || [];
        this.setData({
            detail: Object.assign({}, recipe, {
                mainItemsText: foodNames.joinLabels(recipe.mainItems || []) +
                    (seasonings.length ? '（调料：' + foodNames.joinLabels(seasonings) + '）' : ''),
                steps: (recipe.steps || []).length ? recipe.steps : ['把食材处理好，按熟悉的方式做熟，趁热吃。'],
                missing: recipe.missing || [],
                missingText: foodNames.joinLabels(recipe.missing || []),
            }),
        });
    },

    closeDetail: function () { this.setData({ detail: null }); },

    addMissing: async function (names, fromRecipe) {
        // 展示名不能当身份传给买菜篮，这里按 food_id 去重并补上稳定身份。
        const chunks = [];
        (names || []).forEach(function (chunk) {
            String(chunk || '').split('|').forEach(function (part) { chunks.push(part); });
        });
        const seen = {};
        const unique = [];
        chunks.forEach(function (raw) {
            const text = String(raw || '').trim();
            if (!text) return;
            const id = recipes.toFoodId(text);
            if (seen[id]) return;
            seen[id] = true;
            unique.push({ name: dict.canonicalOf(id) || text, foodId: id, raw: text });
        });
        if (!unique.length) {
            util.toast('没有需要补的食材');
            return;
        }
        let success = 0;
        for (const item of unique) {
            const result = await stores.shopping.create(stores.scope({
                name: item.name,
                food_id: item.foodId,
                raw_name: item.raw,
                emoji: dict.meta(item.foodId).emoji,
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
                aiRecipe: Object.assign({}, recipe, { extraText: foodNames.joinLabels(recipe.extra || []) }),
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
        const seen = {};
        mainItems.forEach(function (name) { seen[recipes.toFoodId(name)] = true; });
        (recipe.extra || []).forEach(function (name) {
            const clean = String(name || '').trim();
            if (!clean) return;
            const id = recipes.toFoodId(clean);
            if (seen[id]) return;
            seen[id] = true;
            mainItems.push(dict.canonicalOf(id) || clean);
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
