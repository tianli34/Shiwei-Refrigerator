// 列表里点「数量」弹出的轻量改档层：很多 / 少量 / 精确三选一 + 单位条。
// 只改 ingredients.quantity 这一个描述串：不碰库存、不碰保质期、不参与菜谱匹配。
// 单位条与录入表单共用 utils/units.js，打开时默认带出原来的单位。
const quantity = require('../../utils/quantity');
const units = require('../../utils/units');

Component({
    options: { addGlobalClass: true },

    properties: {
        visible: { type: Boolean, value: false },
        name: { type: String, value: '' },
        value: { type: String, value: '' },
    },

    data: {
        // 改档只给三档：清空数量不是点开这一层想干的事，关掉弹层就是不动它。
        // MODES 里本来就没有「不记」了，这里直接取用，不再额外过滤。
        modes: quantity.MODES,
        mode: 'exact',
        qty: '',
        unit: '',
        unitChips: [],
        activeDesc: '',
        preview: '',
        previewKind: 'none',
    },

    observers: {
        'visible, value': function (visible, value) {
            if (!visible) return;
            this.reset(value);
        },
    },

    methods: {
        reset: function (value) {
            const parsed = quantity.parse(value);
            const chips = units.read().chips;
            // 历史数据里的自建单位 / 已删掉的单位：补一个 chip，别让原单位悄悄丢掉。
            if (parsed.unit && !chips.some(function (chip) { return chip.value === parsed.unit; })) {
                chips.push({
                    id: 'x:' + parsed.unit, value: parsed.unit, label: parsed.unit,
                    none: false, custom: true, recent: false,
                });
            }
            this.setData(Object.assign({
                mode: parsed.mode === 'none' ? 'exact' : parsed.mode,
                qty: parsed.qty,
                unit: parsed.unit,
                unitChips: chips,
            }, this.viewOf(parsed.mode === 'none' ? 'exact' : parsed.mode, parsed.qty, parsed.unit)));
        },

        viewOf: function (mode, qty, unit) {
            const text = quantity.build(mode, qty, unit);
            return {
                activeDesc: quantity.modeMeta(mode).desc,
                preview: text || (mode === 'exact' ? '还没填数字' : '数量没记'),
                previewKind: quantity.kindOf(text),
            };
        },

        apply: function (patch) {
            const mode = patch.mode === undefined ? this.data.mode : patch.mode;
            const qty = patch.qty === undefined ? this.data.qty : patch.qty;
            const unit = patch.unit === undefined ? this.data.unit : patch.unit;
            const data = this.viewOf(mode, qty, unit);
            Object.assign(data, { mode: mode, qty: qty, unit: unit });
            this.setData(data);
        },

        onModeTap: function (event) {
            const mode = event.currentTarget.dataset.mode;
            if (!mode) return;
            this.apply({ mode: mode });
        },

        onQtyInput: function (event) {
            this.apply({ qty: event.detail.value });
        },

        onUnitTap: function (event) {
            const picked = event.currentTarget.dataset.unit || '';
            const value = picked === units.NONE_LABEL ? '' : picked;
            if (value) units.pick(value);
            this.apply({ unit: value });
        },

        onSave: function () {
            const text = quantity.build(this.data.mode, this.data.qty, this.data.unit);
            // 精确模式下空着保存，等于把数量抹掉；这不是用户点开这一层想干的事。
            if (!text) {
                wx.showToast({ title: '填个数字，或点「很多 / 少量」', icon: 'none' });
                return;
            }
            this.triggerEvent('save', {
                quantity: text,
                mode: this.data.mode,
                qty: this.data.qty,
                unit: this.data.unit,
            });
        },

        onClose: function () {
            this.triggerEvent('close');
        },

        noop: function () {},
    },
});
