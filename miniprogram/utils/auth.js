// 页面登录门禁：每个 tab 页 onShow 重新校验会话，登录成功后才允许读写用户数据。
const { cloud } = require('./cloud');
const foodNames = require('./food-names');
const foodMigration = require('./food-migration');

function createAuthMixin(options) {
    const originalOnShow = options.onShow;
    return Object.assign({}, options, {
        data: Object.assign({ authState: 'checking', user: null, authError: '' }, options.data || {}),

        onShow: function () {
            this.restore();
            if (typeof originalOnShow === 'function') originalOnShow.call(this);
        },

        restore: async function () {
            this.setData({ authState: 'checking', authError: '' });
            let result;
            try {
                result = await getApp().ensureSession();
            } catch (error) {
                result = { data: null, error: { message: '网络异常，请检查网络后重试' } };
            }
            const session = result && result.data;
            if ((result && result.error) || !session) {
                getApp().resetSession();
                this.setData({
                    authState: 'signed-out',
                    user: null,
                    authError: result && result.error ? result.error.message : '',
                });
                return;
            }
            const user = session.user || null;
            getApp().userName = user && user.name ? user.name : '';
            getApp().userId = user && user.id ? user.id : '';
            this.setData({ authState: 'signed-in', user: user, authError: '' });
            // #if social
            try {
                await getApp().loadHousehold();
            } catch (error) {
                // 家庭关系读取失败不阻塞个人数据
            }
            // #endif
            try {
                // 展示名偏好必须在页面 loadData 之前就位，否则会闪一下默认叫法。
                await foodNames.sync();
            } catch (error) {
                // 云端失败时 foodNames 已自动回落到本机缓存，不阻塞页面
            }
            // 历史数据回填放后台跑：新页面即使还没回填也能靠 resolveId 兜住。
            try { foodMigration.run(); } catch (error) { /* 下次启动重试 */ }
            if (typeof this.loadData === 'function') {
                try {
                    await this.loadData();
                } catch (error) {
                    this.setData({ viewState: 'error' });
                }
            }
        },

        onSignedIn: async function () {
            getApp().resetSession();
            await this.restore();
        },

        onRetryAuth: function () {
            getApp().resetSession();
            this.restore();
        },

        onSignOut: async function () {
            try {
                await cloud.auth.signOut();
            } catch (error) {
                // 退出失败也重置本地会话缓存，避免停留在已登录界面
            }
            getApp().resetSession();
            await this.restore();
        },
    });
}

module.exports = { createAuthMixin: createAuthMixin };
