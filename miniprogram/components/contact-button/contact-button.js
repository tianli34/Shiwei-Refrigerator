// 反馈入口：封装微信原生 button 的 open-type="contact"。
// 点击后由微信唤起小程序客服会话，用户可以在会话里直接给小程序发消息；
// 客服人员需在小程序后台「功能 → 客服 → 客服管理」绑定微信号后接收与回复。
// 形态固定为页脚一行文字：反馈是兜底能力，不该在主界面占一个按钮位。

// 与 login-panel 保持一致的运行环境判断：没有真实 AppID 时无法唤起客服会话。
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
    properties: {
        // 会话来源标识，客服侧可据此区分用户从哪个页面进来
        source: { type: String, value: 'app' },
        // 文案：用产品语气，界面上不出现「客服」这个词
        text: { type: String, value: '用得不顺？跟我们说一声' },
    },

    data: {
        sessionFrom: '',
        messageTitle: '拾味冰箱 · 来聊聊今天吃什么',
        messagePath: '/pages/index/index',
        preview: false,
    },

    lifetimes: {
        attached() {
            const appid = readRuntimeAppId();
            this.setData({
                preview: !appid || appid === 'touristappid',
                sessionFrom: 'shiwei-fridge:' + (this.data.source || 'app'),
            });
        },
    },

    methods: {
        // 预览 / 游客环境拿不到微信客服能力，给一句明确说明，避免点了没反应。
        onTap() {
            if (!this.data.preview) return;
            wx.showModal({
                title: '客服会话',
                content: '客服会话需要在微信客户端里打开已绑定 AppID 的小程序体验版或正式版，当前预览环境无法唤起。上线前还需在小程序后台「功能 → 客服」绑定客服人员微信号。',
                showCancel: false,
                confirmText: '知道了',
            });
        },

        // 用户在客服会话中点击小程序消息卡片返回时触发，detail 包含 path / query。
        // 通过 contact 事件透传给使用方，组件本身不擅自跳转页面。
        onContact(event) {
            this.triggerEvent('contact', event.detail || {});
        },
    },
});
