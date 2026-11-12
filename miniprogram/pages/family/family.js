const { createAuthMixin } = require('../../utils/auth');
const stores = require('../../utils/store');
const recipes = require('../../utils/recipes');
const util = require('../../utils/util');

function myShareCodes() {
    const saved = wx.getStorageSync('my_share_codes');
    return Array.isArray(saved) ? saved : [];
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
        const menu = recipes.BUILTIN.slice(0, 6).map(function (item) {
            return {
                id: item.id,
                name: item.name,
                emoji: item.emoji,
                minutes: item.minutes,
                mainItems: item.mainItems,
            };
        });
        const code = util.makeCode(6);
        const created = await stores.shares.create(stores.scope({
            title: '今晚吃什么 · ' + util.today().slice(5),
            share_code: code,
            recipe_ids: JSON.stringify(menu),
            status: 'open',
        }));
        if (created.error) {
            util.toast(util.errorMessage(created.error, '菜单生成失败，请重试'));
            return;
        }
        const codes = myShareCodes();
        codes.unshift(code);
        wx.setStorageSync('my_share_codes', codes.slice(0, 12));
        util.toast('菜单生成啦，转发给朋友点菜吧 📋');
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
        const result = await stores.listVotes(code);
        if (result.error) {
            util.toast(util.errorMessage(result.error, '点菜记录加载失败'));
            return;
        }
        const votes = result.data || [];
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
        const buySet = {};
        votes.forEach(function (vote) {
            const dish = wanted[vote.recipe_name];
            if (!dish) return;
            (dish.mainItems || []).forEach(function (name) { buySet[name] = true; });
        });
        this.setData({
            showVotes: true,
            activeCode: code,
            voteGroups: groups,
            voteTotal: votes.length,
            buyList: Object.keys(buySet),
        });
    },

    closeVotes: function () { this.setData({ showVotes: false }); },

    onBuyListToBasket: async function () {
        const names = this.data.buyList;
        if (!names.length) return;
        let success = 0;
        for (const name of names) {
            const result = await stores.shopping.create(stores.scope({
                name: name,
                emoji: recipes.emojiFor(name),
                quantity: '',
                from_recipe: '点菜板汇总',
                done: false,
            }));
            if (!result.error) success += 1;
        }
        util.toast('已加进买菜篮 ' + success + ' 样 🧺');
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
