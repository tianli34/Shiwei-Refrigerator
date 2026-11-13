const { createAuthMixin } = require('../../utils/auth');
const stores = require('../../utils/store');
const recipes = require('../../utils/recipes');
const util = require('../../utils/util');
const dict = require('../../utils/food-dict');
const foodNames = require('../../utils/food-names');

function myShareCodes() {
    const saved = wx.getStorageSync('my_share_codes');
    return Array.isArray(saved) ? saved : [];
}

const MENU_SIZE = 6;
const MAX_MISSING_ONE = 2;
const URGENT_DAYS = 2;

// 按当前冰箱库存反向配菜，最多 6 道，以「立即可做」为主、最多带 2 道「只差 1 样」。
// 排序权重：能消耗几样临期食材 > 现有食材能否直接做 > 命中主料数 > 耗时。
function buildMenuFromStock(stockRows, cloudRows) {
    const stock = (stockRows || []).filter(function (row) { return !row.consumed; });
    if (!stock.length) return { menu: [], reason: 'empty' };

    const stockId = function (row) { return row.food_id || recipes.toFoodId(row.name); };
    const ids = stock.map(stockId).filter(Boolean);
    const urgentIds = stock.filter(function (row) {
        return util.diffDays(row.expiry_on) <= URGENT_DAYS;
    }).map(stockId).filter(Boolean);

    // 菜单要转发给外部好友点菜，食材名一律用通用叫法生成快照。
    const matched = recipes.match(ids, cloudRows || [], foodNames.CTX_EXTERNAL);
    const withUrgency = function (recipe) {
        const hits = (recipe.mainItems || []).filter(function (name) {
            return recipes.hasIngredient(urgentIds, name);
        }).length;
        return Object.assign({}, recipe, { urgentHits: hits });
    };
    const byPriority = function (a, b) {
        if (b.urgentHits !== a.urgentHits) return b.urgentHits - a.urgentHits;
        if (a.isReady !== b.isReady) return a.isReady ? -1 : 1;
        if (b.matched !== a.matched) return b.matched - a.matched;
        return a.minutes - b.minutes;
    };

    const ready = matched.ready.map(withUrgency).map(function (item) {
        return Object.assign({}, item, { isReady: true });
    });
    const missingOne = matched.missingOne.map(withUrgency).map(function (item) {
        return Object.assign({}, item, { isReady: false });
    });
    const picked = [];
    ready.concat(missingOne).sort(byPriority).forEach(function (item) {
        if (picked.length >= MENU_SIZE) return;
        if (!item.isReady) {
            const alreadyMissing = picked.filter(function (one) { return !one.isReady; }).length;
            if (alreadyMissing >= MAX_MISSING_ONE) return;
        }
        picked.push(item);
    });
    const menu = picked.map(function (item) {
        return {
            id: item.id,
            name: item.name,
            emoji: item.emoji,
            minutes: item.minutes,
            mainItems: item.mainItems,
            missing: item.missing || [],
            missingText: foodNames.joinLabels(item.missing || [], foodNames.CTX_EXTERNAL),
        };
    });
    return { menu: menu, reason: menu.length ? '' : 'no-match' };
}

Page(createAuthMixin({
    data: {
        viewState: 'loading',
        householdKey: '',
        householdName: '',
        createName: '',
        joinCode: '',
        shares: [],
        showVotes: false,
        activeCode: '',
        voteGroups: [],
        voteTotal: 0,
        buyList: [],
        haveList: [],
        haveListText: '',
        buyNote: '',
    },

    loadData: async function () {
        const app = getApp();
        const key = app.householdKey || '';
        let name = app.householdName || '共享冰箱';
        if (key) {
            const found = await stores.findHouseholdByCode(key);
            if (!found.error && found.data) name = found.data.name;
        }
        const codes = myShareCodes();
        const shares = [];
        for (const code of codes) {
            const found = await stores.findShareByCode(code);
            if (found.error || !found.data) continue;
            const votes = await stores.listVotes(code);
            shares.push({
                share_code: code,
                title: found.data.title,
                recipe_ids: found.data.recipe_ids,
                voteCount: votes.error ? 0 : votes.data.length,
            });
        }
        this.setData({
            viewState: 'ready',
            householdKey: key,
            householdName: name,
            shares: shares,
        });
    },

    onCreateName: function (event) { this.setData({ createName: event.detail.value }); },
    onJoinCode: function (event) { this.setData({ joinCode: event.detail.value.toUpperCase() }); },

    onCreateHousehold: async function () {
        const name = String(this.data.createName || '').trim() || '我们家的冰箱';
        const code = util.makeCode(6);
        const created = await stores.households.create({
            name: name,
            invite_code: code,
            owner_name: stores.ownerName(),
        });
        if (created.error) {
            util.toast(util.errorMessage(created.error, '创建失败，请重试'));
            return;
        }
        const joined = await stores.members.create({
            household_key: code,
            role: 'owner',
            owner_name: stores.ownerName(),
        });
        if (joined.error) {
            util.toast(util.errorMessage(joined.error, '加入失败，请重试'));
            return;
        }
        getApp().setHousehold(code, name);
        this.setData({ householdKey: code, householdName: name });
        util.toast('共享冰箱建好啦 🏡');
    },

    onJoinHousehold: async function () {
        const code = String(this.data.joinCode || '').trim().toUpperCase();
        if (code.length < 4) {
            util.toast('请输入完整的邀请码');
            return;
        }
        const found = await stores.findHouseholdByCode(code);
        if (found.error || !found.data) {
            util.toast('没找到这个邀请码，检查一下？');
            return;
        }
        if (getApp().householdKey === code) {
            util.toast('你已经在这个冰箱里啦');
            return;
        }
        const joined = await stores.members.create({
            household_key: code,
            role: 'member',
            owner_name: stores.ownerName(),
        });
        if (joined.error) {
            util.toast(util.errorMessage(joined.error, '加入失败，可能已加入过'));
            return;
        }
        getApp().setHousehold(code, found.data.name);
        this.setData({ householdKey: code, householdName: found.data.name, joinCode: '' });
        util.toast('加入成功，库存已同步 🧊');
    },

    onLeaveHousehold: function () {
        const that = this;
        wx.showModal({
            title: '退出共享冰箱',
            content: '退出后将看不到这个冰箱里的共享食材，确定吗？',
            success: async function (res) {
                if (!res.confirm) return;
                const list = await stores.members.list();
                if (!list.error) {
                    const mine = (list.data || []).filter(function (row) { return row.household_key === that.data.householdKey; });
                    for (const row of mine) await stores.members.remove(row.id);
                }
                getApp().setHousehold('', '');
                that.setData({ householdKey: '', householdName: '' });
                util.toast('已退出共享冰箱');
            },
        });
    },

    onCopyInvite: function () {
        wx.setClipboardData({
            data: this.data.householdKey,
            success: function () { util.toast('邀请码已复制 💌'); },
        });
    },

    onCreateShare: async function () {
        if (this.creatingShare) return;
        this.creatingShare = true;
        wx.showLoading({ title: '正在翻冰箱配菜', mask: true });
        let results;
        try {
            results = await Promise.all([stores.ingredients.list(), stores.recipes.list()]);
        } catch (error) {
            wx.hideLoading();
            this.creatingShare = false;
            util.toast(util.errorMessage(error, '食材加载失败，再试一次'));
            return;
        }
        wx.hideLoading();
        this.creatingShare = false;

        if (results[0].error) {
            util.toast(util.errorMessage(results[0].error, '食材加载失败，再试一次'));
            return;
        }
        const cloudRows = results[1].error ? [] : (results[1].data || []);
        const built = buildMenuFromStock(results[0].data, cloudRows);
        if (!built.menu.length) {
            util.toast(built.reason === 'empty'
                ? '冰箱还是空的，先去放几样食材吧 🧊'
                : '这些食材暂时配不出菜，去合成页让 AI 出几道 ✨');
            return;
        }

        const code = util.makeCode(6);
        const created = await stores.shares.create(stores.scope({
            title: '今晚吃什么 · ' + util.today().slice(5),
            share_code: code,
            recipe_ids: JSON.stringify(built.menu),
            status: 'open',
        }));
        if (created.error) {
            util.toast(util.errorMessage(created.error, '菜单生成失败，请重试'));
            return;
        }
        const codes = myShareCodes();
        codes.unshift(code);
        wx.setStorageSync('my_share_codes', codes.slice(0, 12));
        util.toast('按冰箱食材配了 ' + built.menu.length + ' 道，转发给朋友吧 📋');
        await this.loadData();
    },

    onCopyShare: function (event) {
        const code = event.currentTarget.dataset.code;
        wx.setClipboardData({
            data: '来点菜！打开拾味冰箱，输入菜单码 ' + code,
            success: function () { util.toast('菜单码已复制 📋'); },
        });
    },

    onViewVotes: async function (event) {
        const code = event.currentTarget.dataset.code;
        const share = this.data.shares.filter(function (item) { return item.share_code === code; })[0];
        wx.showLoading({ title: '正在核对冰箱', mask: true });
        let results;
        try {
            results = await Promise.all([stores.listVotes(code), stores.ingredients.list()]);
        } finally {
            wx.hideLoading();
        }
        const voteResult = results[0];
        const stockResult = results[1];
        if (voteResult.error) {
            util.toast(util.errorMessage(voteResult.error, '点菜记录加载失败'));
            return;
        }
        const votes = voteResult.data || [];
        const counter = {};
        votes.forEach(function (vote) {
            counter[vote.recipe_name] = (counter[vote.recipe_name] || 0) + 1;
        });
        const groups = Object.keys(counter).map(function (name) {
            return { name: name, count: counter[name] };
        }).sort(function (a, b) { return b.count - a.count; });

        let menu = [];
        try { menu = JSON.parse(share ? share.recipe_ids : '[]'); } catch (error) { menu = []; }
        const wanted = {};
        menu.forEach(function (item) { wanted[item.name] = item; });
        // 被点中的菜所需主料，按 food_id 去重（番茄和西红柿算同一样）
        const needed = [];
        const seen = {};
        votes.forEach(function (vote) {
            const dish = wanted[vote.recipe_name];
            if (!dish) return;
            (dish.mainItems || []).forEach(function (name) {
                const clean = String(name || '').trim();
                if (!clean) return;
                const id = recipes.toFoodId(clean);
                if (seen[id]) return;
                seen[id] = true;
                needed.push({ raw: clean, id: id });
            });
        });

        // 菜单是生成时的快照，是否要买以「当前库存」为准：没吃掉、没过期的才算有。
        // 库存读取失败时退回全部主料，宁可多列也不漏买，并给出提示。
        const stockFailed = !!stockResult.error;
        const stockIds = stockFailed ? [] : (stockResult.data || [])
            .filter(function (row) { return !row.consumed && util.diffDays(row.expiry_on) >= 0; })
            .map(function (row) { return row.food_id || recipes.toFoodId(row.name); })
            .filter(Boolean);
        const buyList = [];
        const haveList = [];
        needed.forEach(function (item) {
            const row = { name: item.raw, display: foodNames.labelOf(item.id), foodId: item.id };
            if (!stockFailed && stockIds.indexOf(item.id) >= 0) haveList.push(row);
            else buyList.push(row);
        });
        this.setData({
            showVotes: true,
            activeCode: code,
            voteGroups: groups,
            voteTotal: votes.length,
            buyList: buyList,
            haveList: haveList,
            haveListText: haveList.map(function (row) { return row.display; }).join('、'),
            buyNote: stockFailed ? '库存没读到，先按全部主料列出，加篮子前可以自己删减' : '',
        });
    },

    closeVotes: function () { this.setData({ showVotes: false }); },

    onBuyListToBasket: async function () {
        const items = this.data.buyList;
        if (!items.length) return;
        // 已在买菜篮里、还没勾完成的，按身份判重，不再重复加
        let basket = { data: [], error: null };
        try { basket = await stores.shopping.list(); } catch (error) { basket = { data: [], error: error }; }
        const existing = (basket.error ? [] : (basket.data || []))
            .filter(function (row) { return !row.done; })
            .map(function (row) { return row.food_id || recipes.toFoodId(row.name); });
        const pending = items.filter(function (item) { return existing.indexOf(item.foodId) < 0; });
        if (!pending.length) {
            util.toast('这些已经在买菜篮里啦 🧺');
            this.setData({ showVotes: false });
            return;
        }
        let success = 0;
        for (const item of pending) {
            const result = await stores.shopping.create(stores.scope({
                name: dict.canonicalOf(item.foodId) || item.name,
                food_id: item.foodId,
                raw_name: item.name,
                emoji: recipes.emojiFor(item.name),
                quantity: '',
                from_recipe: '点菜板汇总',
                done: false,
            }));
            if (!result.error) success += 1;
        }
        const skipped = items.length - pending.length;
        util.toast('新加进买菜篮 ' + success + ' 样' + (skipped ? '（跳过 ' + skipped + ' 样已有的）' : '') + ' 🧺');
        this.setData({ showVotes: false });
    },

    onShareAppMessage: function (res) {
        const code = (res && res.target && res.target.dataset && res.target.dataset.code) || (this.data.shares[0] && this.data.shares[0].share_code) || '';
        return {
            title: '来点菜！今晚吃什么你说了算 🍽️',
            path: '/pages/order/order?code=' + code,
            desc: '拾味冰箱 · 点菜板',
        };
    },
}));
