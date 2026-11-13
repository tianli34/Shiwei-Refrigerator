const { cloud } = require('./utils/cloud');
const { members } = require('./utils/store');
const { safeArray } = require('./utils/util');
const foodNames = require('./utils/food-names');

App({
    globalData: {
        appName: '拾味冰箱',
        slogan: '拯救过期食材，专治「今天吃什么」',
    },

    onLaunch: function () {
        this.householdKey = wx.getStorageSync('household_key') || '';
        this.householdName = wx.getStorageSync('household_name') || '';
        this.userName = '';
        this.userId = '';
        this.sessionPromise = null;
        // 先把本机叫法缓存装进内存，避免登录同步完成前闪一下默认主名。
        foodNames.loadLocal();
        this.playDoorSound();
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

    // 家庭共享作用域：只读取自己的成员关系，不需要读取他人私有数据。
    loadHousehold: async function () {
        const result = await members.list();
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

    // 打开冰箱门的轻微反馈：音频能力缺失时静默降级为短振动。
    playDoorSound: function () {
        try {
            if (typeof wx.createInnerAudioContext === 'function') {
                const audio = wx.createInnerAudioContext();
                audio.src = '/assets/sounds/door.wav';
                audio.volume = 0.3;
                audio.onError(function () { audio.destroy(); });
                audio.onEnded(function () { audio.destroy(); });
                audio.play();
                return;
            }
        } catch (error) {
            // 忽略音频能力缺失
        }
        try {
            if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light' });
        } catch (error) {
            // 忽略振动能力缺失
        }
    },
});
