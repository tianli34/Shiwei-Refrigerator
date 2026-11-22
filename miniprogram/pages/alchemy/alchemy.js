// 原「食材炼金术」页，现改为「今日推荐菜」：进页就用冰箱里全部未过期食材算一遍，
// 把「最急的那几样先消灭掉」的菜排成排行榜。
// 旧的「勾 2~4 样食材手动合成 + AI 创意菜」暂时隐藏（需要时从 git 历史里取回）。
const { createAuthMixin } = require('../../utils/auth');
const stores = require('../../utils/store');
const recommend = require('../../utils/recommend');
const recipes = require('../../utils/recipes');
const util = require('../../utils/util');
const dict = require('../../utils/food-dict');
const foodNames = require('../../utils/food-names');

const K_DAYS = 'recommend_urgent_days';
const PAGE_STEP = 5;
// 「已做」防连点：同一道菜 4 秒内只认一次，够看清提示又不会挡住连着记两道菜。
const LOCK_MS = 4000;

function readDays() {
    let stored = '';
    try { stored = wx.getStorageSync(K_DAYS); } catch (error) { stored = ''; }
    return recommend.clampDays(stored || recommend.DAYS_DEFAULT);
}

Page(createAuthMixin({
    data: {
        viewState: 'loading',
        days: recommend.DAYS_DEFAULT,
        daysMin: recommend.DAYS_MIN,
        daysMax: recommend.DAYS_MAX,
        full: false,
        sort: 'urgency',
        sorts: recommend.SORTS,
        items: [],
        listTotal: 0,
        visibleCount: PAGE_STEP,
        showTen: false,
        showAll: false,
        showCollapse: false,
        showingFallback: false,
        statsLine: '',
        expiredCount: 0,
        noIngredient: false,
        detail: null,
        bar: null,
        qtySheet: { visible: false, name: '', value: '' },
    },

    loadData: async function () {
        this.setData({ viewState: 'loading' });
        const results = await Promise.all([
            stores.ingredients.list(),
            stores.recipes.list(),
            stores.cookCountMap(),
        ]);
        if (results[0].error) {
            this.setData({ viewState: 'error' });
            util.toast(util.errorMessage(results[0].error, '食材加载失败'));
            return;
        }
        this.cloudRows = results[1].error ? [] : (results[1].data || []);
        this.cookCounts = results[2] || {};
        const rows = foodNames.decorateList((results[0].data || []).filter(function (row) { return !row.consumed; }));
        const alive = [];
        let expired = 0;
        rows.forEach(function (row) {
            const left = util.diffDays(row.expiry_on);
            row.leftDays = left;
            // 匹配池只要没坏的：过期食材先留在冰箱页提醒，不进推荐。
            if (left < 0) { expired += 1; return; }
            alive.push(row);
        });
        this.allRows = alive;
        this.locked = {};
        this.dirty = false;
        this.setData({
            viewState: 'ready',
            days: readDays(),
            expiredCount: expired,
            noIngredient: rows.length === 0,
        });
        this.recompute(true);
    },

    onRetryData: function () { this.restore(); },

    // N 变了 / 排序变了 / 库存变了都回到这里重算，页面只负责把结果摆出来。
    recompute: function (resetPage) {
        const days = this.data.days;
        const result = recommend.rank(this.allRows, this.cloudRows, {
            days: days,
            full: this.data.full,
            sort: this.data.sort,
            counts: this.cookCounts,
        });
        this.readyAll = result.ready;
        this.missingAll = result.missing;
        const stats = recommend.profile(this.allRows, days);
        this.setData({
            statsLine: stats.total
                ? ('冰箱里 ' + stats.total + ' 样食材 · ' + stats.urgent + ' 样 ' + days + ' 天内到期')
                : '冰箱里还没有能用的食材',
        });
        this.applyView(resetPage ? PAGE_STEP : this.data.visibleCount);
    },

    applyView: function (visible) {
        const ready = this.readyAll || [];
        const fallback = ready.length === 0;
        const list = fallback ? (this.missingAll || []) : ready;
        const page = recommend.pager(list.length, visible);
        this.showingFallback = fallback;
        this.setData({
            showingFallback: fallback,
            listTotal: page.count,
            visibleCount: page.visible,
            items: list.slice(0, page.visible),
            showTen: page.showTen,
            showAll: page.showAll,
            showCollapse: page.showCollapse,
        });
    },

    // ---------- 筛选与排序 ----------
    onDaysMinus: function () { this.changeDays(-1); },
    onDaysPlus: function () { this.changeDays(1); },

    changeDays: function (step) {
        const next = recommend.clampDays(this.data.days + step);
        if (next === this.data.days) return;
        try { wx.setStorageSync(K_DAYS, next); } catch (error) { /* 存储不可用就只在本页生效 */ }
        this.setData({ days: next });
        this.recompute(true);
    },

    onRangeTap: function (event) {
        const full = String(event.currentTarget.dataset.full) === '1';
        if (full === this.data.full) return;
        this.setData({ full: full, showingFallback: false });
        this.recompute(true);
    },

    onSortTap: function (event) {
        const sort = event.currentTarget.dataset.sort;
        if (!sort || sort === this.data.sort) return;
        this.setData({ sort: sort });
        this.recompute(true);
    },

    onShowTen: function () { this.applyView(10); },
    onShowAll: function () { this.applyView(this.listTotal); },
    onCollapse: function () { this.applyView(PAGE_STEP); },

    // ---------- 菜谱详情 ----------
    onRecipeTap: function (event) {
        const key = event.currentTarget.dataset.key;
        const list = this.showingFallback ? (this.missingAll || []) : (this.readyAll || []);
        const item = list.filter(function (row) { return row.key === key; })[0];
        if (!item) return;
        const seasonings = item.seasonings || [];
        this.setData({
            detail: Object.assign({}, item, {
                mainItemsText: foodNames.joinLabels(item.mainItems || []),
                seasoningText: seasonings.length ? foodNames.joinLabels(seasonings) : '',
                steps: (item.steps || []).length ? item.steps : ['把食材处理好，按熟悉的方式做熟，趁热吃。'],
                canCook: !this.showingFallback,
            }),
        });
    },

    closeDetail: function () { this.setData({ detail: null }); },

    // ---------- 已做 +1 ----------
    onMarkCook: async function (event) {
        const key = event.currentTarget.dataset.key;
        if (!key) return;
        const now = Date.now();
        if (this.locked && this.locked[key] && this.locked[key] > now) {
            util.toast('刚记过这道菜，' + Math.ceil((this.locked[key] - now) / 1000) + ' 秒后再点');
            return;
        }
        if (this.cookingKey) return;
        const recipe = (this.readyAll || []).filter(function (row) { return row.key === key; })[0];
        if (!recipe) return;

        this.cookingKey = key;
        const counted = await stores.bumpCookCount(key, 1);
        if (counted.error) {
            this.cookingKey = null;
            util.toast(util.errorMessage(counted.error, '次数没记上，再试一次'));
            return;
        }
        // 消耗次数记到具体批次上：每样主料取最早到期的那行，和确认条里列的是同一批。
        // explain 的 used 已经处理过「五花肉代猪肉」。
        const usedIds = recipe.used || [];
        const barItems = this.barItemsOf(usedIds);
        const countedIds = [];
        for (const item of barItems) {
            const bumped = await stores.bumpBatchConsumed(item.id, 1);
            if (!bumped.error) countedIds.push(item.id);
        }
        this.cookingKey = null;
        this.locked[key] = Date.now() + LOCK_MS;
        this.cookCounts[key] = (Number(this.cookCounts[key]) || 0) + 1;
        this.patchCookCount(key, this.cookCounts[key]);
        this.flashCooked(key);

        this.barBatches = countedIds;
        this.barKey = key;
        this.setData({
            // 详情弹层让位给底部确认条，不然两个浮层会叠在一起。
            detail: null,
            bar: {
                key: key,
                name: recipe.name,
                emoji: recipe.emoji,
                items: barItems,
            },
        });
    },

    // 「已记 ✓」只是按钮上的临时态：4 秒后自己退回「已做 +1」，
    // 和 JS 里的 locked 时间戳同一把尺子，看得见的和拦得住的对得上。
    flashCooked: function (key) {
        const that = this;
        this.patchItems(key, { justCooked: true });
        setTimeout(function () {
            that.patchItems(key, { justCooked: false });
        }, LOCK_MS);
    },

    patchItems: function (key, patch) {
        const items = this.data.items.map(function (item) {
            return item.key === key ? Object.assign({}, item, patch) : item;
        });
        this.setData({ items: items });
    },

    patchCookCount: function (key, n) {
        const items = this.data.items.map(function (item) {
            return item.key === key ? Object.assign({}, item, { cookCount: n }) : item;
        });
        const patch = { items: items };
        if (this.data.detail && this.data.detail.key === key) patch['detail.cookCount'] = n;
        this.setData(patch);
    },

    onUndoCook: async function () {
        const bar = this.data.bar;
        if (!bar) return;
        if (this.undoing) return;
        this.undoing = true;
        await stores.bumpCookCount(bar.key, -1);
        for (const id of (this.barBatches || [])) {
            await stores.bumpBatchConsumed(id, -1);
        }
        this.undoing = false;
        this.cookCounts[bar.key] = Math.max(0, (Number(this.cookCounts[bar.key]) || 1) - 1);
        this.patchCookCount(bar.key, this.cookCounts[bar.key]);
        this.patchItems(bar.key, { justCooked: false });
        if (this.locked) delete this.locked[bar.key];
        this.setData({ bar: null });
        util.toast('已撤销这次的「已做」');
    },

    // 底部确认条：本菜用到的主料 + 三个顺手动作
    barItemsOf: function (ids) {
        const rows = this.allRows || [];
        const seen = {};
        const out = [];
        (ids || []).forEach(function (id) {
            if (!id || seen[id]) return;
            seen[id] = true;
            const row = rows.filter(function (item) { return item.food_id === id; }).sort(function (a, b) {
                if (a.leftDays !== b.leftDays) return a.leftDays - b.leftDays;
                // 临期相同就按「先买先吃」：录入日期早的优先，再比创建时间，最后用 id 兜底。
                const addedA = String(a.added_on || a.created_at || '');
                const addedB = String(b.added_on || b.created_at || '');
                if (addedA !== addedB) return addedA < addedB ? -1 : 1;
                const createdA = String(a.created_at || '');
                const createdB = String(b.created_at || '');
                if (createdA !== createdB) return createdA < createdB ? -1 : 1;
                return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
            })[0];
            if (!row) return;
            out.push({
                key: id,
                id: row.id,
                foodId: id,
                emoji: row.emoji || dict.meta(id).emoji,
                name: row.display || foodNames.labelOf(id),
                text: row.quantity || '数量没记',
                done: false,
            });
        });
        return out;
    },

    patchBarItem: function (index, patch) {
        const bar = this.data.bar;
        if (!bar) return;
        const items = bar.items.map(function (item, i) {
            return i === index ? Object.assign({}, item, patch) : item;
        });
        this.setData({ 'bar.items': items });
    },

    onBarFinish: async function (event) {
        const index = Number(event.currentTarget.dataset.index);
        const bar = this.data.bar;
        const item = bar && bar.items[index];
        if (!item || item.done) return;
        const result = await stores.ingredients.update(item.id, { consumed: true });
        if (result.error) {
            util.toast(util.errorMessage(result.error, '没标记成功，再点一次'));
            return;
        }
        // 已经吃掉的食材从匹配池里拿掉，下次重算不会再推荐靠它的菜。
        this.allRows = (this.allRows || []).filter(function (row) { return row.id !== item.id; });
        this.patchBarItem(index, { done: true, text: '已经用完了' });
        this.dirty = true;
        util.toast('「' + item.name + '」记成吃完了');
    },

    onBarLittle: async function (event) {
        const index = Number(event.currentTarget.dataset.index);
        const bar = this.data.bar;
        const item = bar && bar.items[index];
        if (!item || item.done) return;
        const result = await stores.ingredients.update(item.id, { quantity: '少量' });
        if (result.error) {
            util.toast(util.errorMessage(result.error, '没改成，再点一次'));
            return;
        }
        this.setRowsQuantity(item.id, '少量');
        this.patchBarItem(index, { text: '少量' });
        util.toast('记成只剩少量了');
    },

    onBarEdit: function (event) {
        const index = Number(event.currentTarget.dataset.index);
        const bar = this.data.bar;
        const item = bar && bar.items[index];
        if (!item || item.done) return;
        this.editing = { index: index, id: item.id, name: item.name };
        this.setData({ qtySheet: { visible: true, name: item.name, value: item.text === '数量没记' ? '' : item.text } });
    },

    onQtySave: async function (event) {
        const editing = this.editing;
        if (!editing) return;
        const text = event.detail.quantity || '';
        const result = await stores.ingredients.update(editing.id, { quantity: text });
        if (result.error) {
            util.toast(util.errorMessage(result.error, '没改成，再试一次'));
            return;
        }
        this.setRowsQuantity(editing.id, text);
        this.patchBarItem(editing.index, { text: text || '数量没记' });
        this.setData({ qtySheet: { visible: false, name: '', value: '' } });
        this.editing = null;
        util.toast(text ? '记成「' + text + '」了' : '数量已清空');
    },

    onQtyClose: function () {
        this.editing = null;
        this.setData({ qtySheet: { visible: false, name: '', value: '' } });
    },

    setRowsQuantity: function (id, text) {
        this.allRows = (this.allRows || []).map(function (row) {
            return row.id === id ? Object.assign({}, row, { quantity: text }) : row;
        });
    },

    onBarClose: function () {
        const dirty = this.dirty;
        this.dirty = false;
        this.setData({ bar: null });
        if (dirty) this.loadData();
    },

    // ---------- 只差一样：加进买菜篮 ----------
    addMissing: async function (names, fromRecipe) {
        const chunks = [];
        (names || []).forEach(function (chunk) {
            String(chunk || '').split('|').forEach(function (part) { chunks.push(part); });
        });
        const seen = {};
        const unique = [];
        chunks.forEach(function (raw) {
            const text = String(raw || '').trim();
            if (!text) return;
            const foodId = recipes.toFoodId(text);
            if (seen[foodId]) return;
            seen[foodId] = true;
            unique.push({ name: dict.canonicalOf(foodId) || text, foodId: foodId, raw: text });
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

    onAddMissing: function (event) {
        this.addMissing([event.currentTarget.dataset.name], '今日推荐 · 只差一样');
    },

    onAddDetailMissing: function () {
        const detail = this.data.detail;
        if (!detail) return;
        this.addMissing(detail.missing, detail.name);
        this.setData({ detail: null });
    },

    goFridge: function () { wx.reLaunch({ url: '/pages/index/index' }); },
}));
