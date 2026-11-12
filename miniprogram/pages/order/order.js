const stores = require('../../utils/store');
const util = require('../../utils/util');

function readMine(code) {
    const all = wx.getStorageSync('my_votes') || {};
    const list = all[code];
    return Array.isArray(list) ? list : [];
}

function saveMine(code, list) {
    const all = wx.getStorageSync('my_votes') || {};
    all[code] = list;
    wx.setStorageSync('my_votes', all);
}

Page({
    data: {
        code: '',
        viewState: 'loading',
        errorMsg: '',
        menu: [],
        guestName: '',
        voteTotal: 0,
        mineVotes: [],
    },

    onLoad: function (options) {
        const code = String((options && options.code) || '').trim().toUpperCase();
        this.setData({ code: code, mineVotes: readMine(code) });
        this.loadMenu(code);
    },

    loadMenu: async function (code) {
        if (!code) {
            this.setData({ viewState: 'error', errorMsg: '缺少菜单码，让主厨重新发一次卡片吧。' });
            return;
        }
        const found = await stores.findShareByCode(code);
        if (found.error || !found.data) {
            this.setData({ viewState: 'error', errorMsg: '这份菜单可能已经撤下了，或者菜单码输错了。' });
            return;
        }
        let menu = [];
        try {
            menu = JSON.parse(found.data.recipe_ids || '[]');
        } catch (error) {
            menu = [];
        }
        if (!Array.isArray(menu) || !menu.length) {
            this.setData({ viewState: 'error', errorMsg: '菜单里还没有菜，等主厨加几道吧。' });
            return;
        }
        this.shareTitle = found.data.title || '今晚的点菜板';
        const votes = await stores.listVotes(code);
        this.applyVotes(menu, votes.error ? [] : votes.data);
    },

    applyVotes: function (menu, votes) {
        const counter = {};
        votes.forEach(function (vote) {
            counter[vote.recipe_name] = (counter[vote.recipe_name] || 0) + 1;
        });
        const mine = this.data.mineVotes;
        const decorated = menu.map(function (item) {
            return Object.assign({}, item, {
                mainItemsText: (item.mainItems || []).join('、'),
                voteCount: counter[item.name] || 0,
                mineVoted: mine.indexOf(item.name) >= 0,
            });
        });
        this.setData({ viewState: 'ready', menu: decorated, voteTotal: votes.length });
    },

    refreshVotes: async function () {
        const result = await stores.listVotes(this.data.code);
        if (result.error) return;
        const decorated = this.data.menu.map(function (item) { return Object.assign({}, item); });
        this.applyVotes(decorated, result.data || []);
    },

    onGuestInput: function (event) {
        this.setData({ guestName: event.detail.value });
    },

    onVote: async function (event) {
        const index = Number(event.currentTarget.dataset.index);
        const dish = this.data.menu[index];
        if (!dish) return;
        if (this.data.mineVotes.indexOf(dish.name) >= 0) {
            util.toast('这道你已经点过啦');
            return;
        }
        const guestName = String(this.data.guestName || '').trim().slice(0, 12) || '神秘食客';
        const result = await stores.addVote({
            share_code: this.data.code,
            recipe_id: Number(String(dish.id).replace(/[^0-9]/g, '')) || index + 1,
            recipe_name: dish.name,
            guest_name: guestName,
        });
        if (result.error) {
            util.toast(util.errorMessage(result.error, '没点上，再试一次'));
            return;
        }
        const mine = this.data.mineVotes.concat([dish.name]);
        saveMine(this.data.code, mine);
        this.setData({ mineVotes: mine });
        util.toast('点到啦！主厨收到 🍽️');
        await this.refreshVotes();
    },

    goHome: function () {
        wx.reLaunch({ url: '/pages/index/index' });
    },

    onShareAppMessage: function () {
        return {
            title: '来点菜！今晚吃什么你说了算 🍽️',
            path: '/pages/order/order?code=' + this.data.code,
        };
    },
});
