// 登录组件：微信一键登录为主入口（wx.login + signInWithWechat），邮箱验证码作为预览/游客环境与兜底入口。
// 两种方式都必须拿到真实 WorkBuddy session 后才触发 signedin 事件，不做本地假会话。
// 依赖 utils/cloud.js 导出的 { cloud }（createMiniProgramWorkBuddyCloud 创建的唯一实例）。

const { cloud } = require('../../utils/cloud');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTDOWN_SECONDS = 60;

// 使用当前运行时的 appid，绝不硬编码；体验版与正式版是不同的小程序。
function readRuntimeAppId() {
    try {
        if (typeof wx.getAccountInfoSync !== 'function') return '';
        const info = wx.getAccountInfoSync();
        return info && info.miniProgram ? info.miniProgram.appId : '';
    } catch (error) {
        return '';
    }
}

Component({
    data: {
        email: '',
        code: '',
        sending: false,
        submitting: false,
        wechatLoading: false,
        useEmail: false,
        previewHint: '',
        countdown: 0,
        tip: '',
        error: '',
    },

    lifetimes: {
        attached() {
            this.alive = true;
            // H5 预览 / 游客模式拿不到真实 wx.login code，直接展开可用的邮箱入口并说明原因。
            const appid = readRuntimeAppId();
            const preview = !appid || appid === 'touristappid';
            this.setData({
                useEmail: preview,
                previewHint: preview
                    ? '当前为预览或游客环境，无法获取微信登录凭证。绑定小程序 AppID 后，在微信体验版中即可一键登录；这里请先用邮箱验证码。'
                    : '',
            });
        },
        detached() {
            this.alive = false;
            this.stopCountdown();
        },
    },

    methods: {
        toggleEmail() {
            this.setData({ useEmail: !this.data.useEmail, error: '' });
        },

        // wx.login 只负责取临时凭证，身份交换由云 SDK 完成；app 端不接触 AppSecret / openid。
        fetchWechatCode() {
            return new Promise(function (resolve, reject) {
                if (typeof wx.login !== 'function') {
                    reject(new Error('当前环境不支持微信登录，请使用邮箱验证码'));
                    return;
                }
                wx.login({
                    success: function (res) {
                        if (res && res.code) resolve(res.code);
                        else reject(new Error('未获取到微信登录凭证，请重试'));
                    },
                    fail: function (err) {
                        reject(new Error((err && err.errMsg) || '微信登录未成功，请重试'));
                    },
                });
            });
        },

        async onWechatLogin() {
            if (this.data.wechatLoading) return;
            const appid = readRuntimeAppId();
            if (!appid || appid === 'touristappid') {
                this.setData({
                    useEmail: true,
                    error: '当前是预览或游客环境，微信登录需在已绑定小程序 AppID 的体验版中使用。',
                });
                return;
            }
            this.setData({ wechatLoading: true, error: '', tip: '' });
            try {
                const code = await this.fetchWechatCode();
                const result = await cloud.auth.signInWithWechat(code, appid);
                if (this.alive === false) return;
                this.setData({ wechatLoading: false });
                if (result.error || !result.data) {
                    const message = (result.error && result.error.message) || '微信登录失败，请重试';
                    console.error('[WorkBuddy Cloud] login failed', JSON.stringify({ stage: 'wechat-login-handler', message: message }));
                    this.setData({ error: message, useEmail: true });
                    return;
                }
                this.setData({ email: '', code: '' });
                this.triggerEvent('signedin');
            } catch (error) {
                if (this.alive === false) return;
                const message = (error && error.message) || '微信登录失败，请重试';
                console.error('[WorkBuddy Cloud] login failed', JSON.stringify({ stage: 'wx.login', message: message }));
                this.setData({ wechatLoading: false, error: message, useEmail: true });
            }
        },

        onEmailInput(event) {
            this.setData({ email: event.detail.value, error: '' });
        },

        onCodeInput(event) {
            this.setData({ code: event.detail.value, error: '' });
        },

        async sendCode() {
            if (this.data.sending || this.data.countdown > 0) {
                return;
            }
            const email = (this.data.email || '').trim();
            if (!EMAIL_RE.test(email)) {
                this.setData({ error: '请输入正确的邮箱地址' });
                return;
            }
            this.setData({ sending: true, error: '', tip: '' });
            let sent;
            try {
                sent = await cloud.auth.sendOtp({ email: email });
            } catch (error) {
                sent = { data: null, error: { message: '' } };
            }
            if (this.alive === false) {
                return;
            }
            this.setData({ sending: false });
            if (sent.error) {
                this.setData({ error: sent.error.message || '验证码发送失败，请重试' });
                return;
            }
            this.challenge = {
                email: email,
                verificationId: sent.data.verificationId,
                isExistingUser: sent.data.isExistingUser,
            };
            this.setData({ tip: '验证码已发送，请查收邮件', countdown: COUNTDOWN_SECONDS });
            this.startCountdown();
        },

        async submit() {
            if (this.data.submitting) {
                return;
            }
            const email = (this.data.email || '').trim();
            const code = (this.data.code || '').trim();
            if (!EMAIL_RE.test(email)) {
                this.setData({ error: '请输入正确的邮箱地址' });
                return;
            }
            if (code === '') {
                this.setData({ error: '请输入邮箱收到的验证码' });
                return;
            }
            const pending = this.challenge;
            if (!pending || pending.email !== email) {
                this.setData({ error: '请先获取当前邮箱的验证码' });
                return;
            }
            this.setData({ submitting: true, error: '', tip: '' });
            let completed;
            try {
                completed = await cloud.auth.verifyOtp({
                    email: pending.email,
                    verificationId: pending.verificationId,
                    isExistingUser: pending.isExistingUser,
                    token: code,
                });
            } catch (error) {
                completed = { data: null, error: { message: '' } };
            }
            if (this.alive === false) {
                return;
            }
            this.setData({ submitting: false });
            if (completed.error) {
                this.setData({ error: completed.error.message || '登录失败，请重试' });
                return;
            }
            this.challenge = null;
            this.setData({ code: '', tip: '' });
            this.triggerEvent('signedin');
        },

        startCountdown() {
            this.stopCountdown();
            this.countdownTimer = setInterval(() => {
                const next = this.data.countdown - 1;
                if (next <= 0) {
                    this.stopCountdown();
                    this.setData({ countdown: 0 });
                    return;
                }
                this.setData({ countdown: next });
            }, 1000);
        },

        stopCountdown() {
            if (this.countdownTimer) {
                clearInterval(this.countdownTimer);
                this.countdownTimer = null;
            }
        },
    },
});
