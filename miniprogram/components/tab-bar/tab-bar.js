Component({
    properties: {
        current: { type: String, value: 'index' },
    },
    data: {
        tabs: [
            { key: 'index', emoji: '🧊', label: '冰箱', path: '/pages/index/index' },
            { key: 'alchemy', emoji: '🍽️', label: '推荐', path: '/pages/alchemy/alchemy' },
            { key: 'shopping', emoji: '🧺', label: '买菜', path: '/pages/shopping/shopping' },
            { key: 'family', emoji: '🏡', label: '家人', path: '/pages/family/family' },
            { key: 'profile', emoji: '🐸', label: '我的', path: '/pages/profile/profile' },
        ],
    },
    methods: {
        onTap: function (event) {
            const key = event.currentTarget.dataset.key;
            const path = event.currentTarget.dataset.path;
            if (!path || key === this.data.current) return;
            wx.reLaunch({ url: path });
        },
    },
});
