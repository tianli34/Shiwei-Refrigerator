Component({
    properties: {
        visible: { type: Boolean, value: false },
        foodId: { type: String, value: '' },
        current: { type: String, value: '' },
        names: { type: Array, value: [] },
        scopeHint: { type: String, value: '' },
    },
    data: { custom: '' },
    methods: {
        noop: function () {},
        onClose: function () { this.triggerEvent('close'); },
        onPick: function (event) {
            const name = event.currentTarget.dataset.name;
            if (name) this.triggerEvent('pick', { name: name });
        },
        onCustomInput: function (event) { this.setData({ custom: event.detail.value }); },
        onCustomConfirm: function () {
            const value = String(this.data.custom || '').trim().slice(0, 12);
            if (!value) return;
            this.triggerEvent('pick', { name: value });
            this.setData({ custom: '' });
        },
        onReset: function () { this.triggerEvent('reset'); },
    },
});
