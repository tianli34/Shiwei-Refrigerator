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
        // 全局音频策略只配置一次：遵循系统静音键、允许和别的 App 混播。
        // 这是向系统「请求」，不是跨机型的保证，所以每个播放点都按尽力而为写。
        try {
            if (typeof wx.setInnerAudioOption === 'function') {
                wx.setInnerAudioOption({ obeyMuteSwitch: true, mixWithOther: true });
            }
        } catch (error) {
            // 老基础库没有这个接口，后面自然退化成静音
        }
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

    // 开门音效跟着「开门」这个动作响一声，没有开关：遵循手机静音键（见上面 onLaunch）。
    // 微信里没有用户手势的自动播放本来就大概率被拦，所以按尽力而为写：
    // 音频能力缺失就安静跳过，不退化成振动 —— 打开录入弹层时震一下没有道理。
    playDoorSound: function () {
        try {
            if (typeof wx.createInnerAudioContext === 'function') {
                const audio = wx.createInnerAudioContext();
                audio.src = '/assets/sounds/door.wav';
                audio.volume = 0.3;
                audio.onError(function () { audio.destroy(); });
                audio.onEnded(function () { audio.destroy(); });
                audio.play();
                return true;
            }
        } catch (error) {
            // 忽略音频能力缺失
        }
        return false;
    },
});
