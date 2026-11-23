const { cloud } = require('./utils/cloud');
// #if social
const social = require('./utils/social');
const { safeArray } = require('./utils/util');
// #endif
const foodNames = require('./utils/food-names');
const build = require('./utils/build-config');

App({
    globalData: {
        appName: '拾味冰箱',
        slogan: '拯救过期食材，专治「今天吃什么」',
        build: build,
    },

    onLaunch: function () {
        // #if social
        this.householdKey = wx.getStorageSync('household_key') || '';
        this.householdName = wx.getStorageSync('household_name') || '';
        // #endif
        // #if !social
        // 个人版恒为个人作用域：本机即使残留旧作用域 key 也要清掉，否则会读到别人的数据。
        this.householdKey = '';
        this.householdName = '';
        // #endif
        this.userName = '';
        this.userId = '';
        this.sessionPromise = null;
        // 先把本机叫法缓存装进内存，避免登录同步完成前闪一下默认主名。
        foodNames.loadLocal();
        // 开门设置已整块撤掉，历史版本可能在本机留下这两个偏好键，顺手清掉。
        wx.removeStorageSync('fridge:motion');
        wx.removeStorageSync('fridge:sound');
    },

    ensureSession: function () {
        if (!this.sessionPromise) {
            this.sessionPromise = cloud.auth.getSession();
        }
        return this.sessionPromise;
    },

    resetSession: function () {
        this.sessionPromise = null;
    },

    // #if social
    // 家庭共享作用域：只读取自己的成员关系，不需要读取他人私有数据。
    loadHousehold: async function () {
        const result = await social.members.list();
        if (result.error) return this.householdKey || '';
        const rows = safeArray(result.data);
        const key = rows.length ? rows[0].household_key : '';
        this.householdKey = key;
        wx.setStorageSync('household_key', key);
        return key;
    },

    setHousehold: function (key, name) {
        this.householdKey = key || '';
        this.householdName = name || '';
        wx.setStorageSync('household_key', this.householdKey);
        wx.setStorageSync('household_name', this.householdName);
    },
    // #endif
    // #if !social
    // 个人版没有共享作用域，保留同名空实现，避免调用点漏改直接抛 undefined。
    loadHousehold: async function () { return ''; },
    // #endif
});
