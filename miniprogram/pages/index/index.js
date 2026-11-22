const { createAuthMixin } = require('../../utils/auth');
const stores = require('../../utils/store');
const ai = require('../../utils/ai');
const util = require('../../utils/util');
const dict = require('../../utils/food-dict');
const foodNames = require('../../utils/food-names');
const subscribe = require('../../utils/subscribe');
const quantity = require('../../utils/quantity');
const units = require('../../utils/units');

const ZONE_LABEL = { cold: '冷藏', freeze: '冷冻', room: '常温' };
const EMPTY_EMOJI = { cold: '🥛', freeze: '🧊', room: '🧺' };

// 保质天数统一收敛到 1~365 天，录入表单和 AI 拆解结果都用它。
function clampShelfDays(value) {
    return Math.max(1, Math.min(365, Number(value) || 3));
}

const MANUAL_SHELF_TIP = '填的是从今天起还能放几天，按包装上的保质期改更准';

// 把「一个数字」解释成人话：数字从哪来、能不能改、大约哪天到期。
function shelfCopy(days, source) {
    const n = clampShelfDays(days);
    const parts = util.addDays(util.today(), n).split('-');
    const dateText = Number(parts[1]) + ' 月 ' + Number(parts[2]) + ' 日';
    return {
        shelfSource: source || '',
        shelfTip: source ? '「' + source + '」常见能放 ' + n + ' 天，已自动填好，可以改' : MANUAL_SHELF_TIP,
        expiryHint: '大约 ' + dateText + ' 到期',
    };
}

// 数量是并列的「三选一」：精确 / 很多 / 少量。空着就等于没记数量，
// 不再单独给一个「不记」按钮 —— 那和「精确 + 不填数字」是同一个结果。
// 表单只记录模式与数值，最终值统一由 utils/quantity.js 收口成一个字符串。
// 可点选的单位（含自建与最近使用排序）全部由 utils/units.js 提供，只影响录入与展示。

function defaultForm() {
    return { name: '', emoji: '🥬', zone: 'cold', qty: '', unit: '', qtyMode: 'exact', shelfDays: 3, note: '' };
}

// 每次改动数量，都把「这次记的是」预览与当前模式的说明一并算好，
// 让用户随时确认自己选的是哪一档，而不是靠脑补。
// 三档里只有精确可能产出空值，空 = 没记数量，预览照实说「还没填数字」。
function qtyView(form) {
    const text = quantity.build(form.qtyMode, form.qty, form.unit);
    return {
        qtyPreview: text || '还没填数字',
        qtyPreviewKind: quantity.kindOf(text),
        activeQtyMode: quantity.modeMeta(form.qtyMode),
    };
}

Page(createAuthMixin({
    data: {
        viewState: 'loading',
        doorOpen: false,
        heroFoods: ['🥛', '🥚', '🍅', '🥦', '🍗'],
        zones: util.ZONES,
        activeZone: 'cold',
        zoneHint: util.ZONES[0].hint,
        zoneItems: [],
        expiring: [],
        expiringNames: '',
        totalCount: 0,
        urgentCount: 0,
        expiredCount: 0,
        alertTitle: '',
        alertTip: '',
        alertTone: '',
        emptyEmoji: '🥛',
        householdLabel: '一个人的冰箱，也要好好吃饭',
        expandedItem: 0,
        showAdd: false,
        addMode: 'tag',
        addedThisRound: [],
        addedExpanded: false,
        commonFoods: util.COMMON_FOODS.map(function (food) {
            return Object.assign({}, food, { display: food.name });
        }),
        qtyUnits: units.chips([], []),
        qtyModes: quantity.MODES,
        unitEditor: false,
        unitDraft: '',
        unitError: '',
        form: defaultForm(),
        qtyPreview: '还没填数字',
        qtyPreviewKind: 'none',
        activeQtyMode: quantity.MODES[0],
        namePicker: null,
        shelfSource: '',
        shelfTip: MANUAL_SHELF_TIP,
        expiryHint: '',
        quickText: '',
        parsedFoods: [],
        parsing: false,
        parseNote: '',
        receiptBusy: false,
        // 点卡片上的「数量」弹出的改档层：只改 quantity 这一个描述串。
        qtySheet: { visible: false, id: '', name: '', value: '' },
    },

    onReady: function () {
        const that = this;
        setTimeout(function () {
            that.setData({ doorOpen: true });
        }, 950);
    },

    openDoor: function () {
        this.setData({ doorOpen: true });
        getApp().playDoorSound();
    },

    loadData: async function () {
        this.setData({ viewState: 'loading' });
        // 批次消耗次数是纯展示态：并行拉，读失败退化成全 0，绝不阻塞冰箱主流程。
        const results = await Promise.all([stores.ingredients.list(), stores.batchConsumedCountMap()]);
        const result = results[0];
        const batchCounts = results[1] || {};
        if (result.error) {
            this.setData({ viewState: 'error' });
            util.toast(util.errorMessage(result.error, '食材加载失败'));
            return;
        }
        const rows = (result.data || []).filter(function (row) { return !row.consumed; });
        // 历史行没有 food_id 时 decorate 会用名称兜底归一，不影响旧数据展示。
        const decorated = rows.map(function (row) {
            const item = foodNames.decorate(row);
            // 计数键是具体批次（ingredients.id）：同一食材的不同批次各记各的。
            const n = Number(batchCounts[String(item.id)]);
            const count = Number.isFinite(n) && n > 0 ? n : 0;
            return Object.assign(item, {
                fresh: util.freshness(row),
                qtyKind: quantity.kindOf(row.quantity),
                consumedCount: count,
                // 0 次不占版面：刚上线时满屏「0 次」比不显示更像坏了。
                consumedLabel: count > 0 ? ('已消耗 ' + count + ' 次') : '',
            });
        });
        const reminderOn = wx.getStorageSync('reminder_on') !== false;
        // 已过期和快过期分开数：过期的食材不是「快过期」，文案也要认账。
        const buckets = util.expiryBuckets(reminderOn ? decorated : []);
        const alertRows = buckets.expired.concat(buckets.urgent);
        const alert = subscribe.alertCopy(buckets.expired.length, buckets.urgent.length);
        const app = getApp();
        this.allItems = decorated;
        this.setData({
            viewState: 'ready',
            totalCount: decorated.length,
            urgentCount: buckets.urgent.length,
            expiredCount: buckets.expired.length,
            alertTitle: alert.title,
            alertTip: alert.tip,
            alertTone: alert.tone,
            expiring: alertRows.slice(0, 8),
            expiringNames: subscribe.expiringNamesText(alertRows),
            householdLabel: app.householdName ? '🏡 ' + app.householdName + ' · 全家同步中' : '一个人的冰箱，也要好好吃饭',
            commonFoods: util.COMMON_FOODS.map(function (food) {
                return Object.assign({}, food, { display: foodNames.labelOf(food.name) });
            }),
        });
        this.applyZone();
    },

    onRetryData: function () {
        this.restore();
    },

    applyZone: function () {
        const zone = this.data.activeZone;
        const items = (this.allItems || []).filter(function (row) { return row.zone === zone; });
        const zoneInfo = util.ZONES.filter(function (item) { return item.key === zone; })[0] || util.ZONES[0];
        this.setData({
            zoneItems: items,
            zoneHint: zoneInfo.hint,
            emptyEmoji: EMPTY_EMOJI[zone] || '🥛',
        });
    },

    onZoneTap: function (event) {
        this.setData({ activeZone: event.currentTarget.dataset.zone, expandedItem: 0 });
        this.applyZone();
    },

    onFoodTap: function (event) {
        const id = event.currentTarget.dataset.id;
        this.setData({ expandedItem: this.data.expandedItem === id ? 0 : id });
    },

    onConsume: async function (event) {
        const id = event.currentTarget.dataset.id;
        const result = await stores.ingredients.update(id, { consumed: true });
        if (result.error) {
            util.toast(util.errorMessage(result.error, '没能标记，请重试'));
            return;
        }
        util.toast('吃掉啦，好样的 🎉');
        this.setData({ expandedItem: 0 });
        await this.loadData();
    },

    onRemove: function (event) {
        const id = event.currentTarget.dataset.id;
        const that = this;
        wx.showModal({
            title: '移出冰箱',
            content: '确定这样食材已经不在冰箱里了吗？',
            success: async function (res) {
                if (!res.confirm) return;
                const result = await stores.ingredients.remove(id);
                if (result.error) {
                    util.toast(util.errorMessage(result.error, '移除失败'));
                    return;
                }
                that.setData({ expandedItem: 0 });
                await that.loadData();
            },
        });
    },

    // 今日推荐菜进页就自己算全量匹配，不再需要跨页预选；临期卡只负责把人带过去。
    goRecommend: function () {
        wx.reLaunch({ url: '/pages/alchemy/alchemy' });
    },

    // 清空过期食材：「已清掉了」是记账，不是命令 —— 用户扔完真冰箱才回来点，
    // App 只负责把这一笔记上，不该反过来指挥用户去扔东西。
    // 所以弹窗是确认既成事实（「都扔掉了？」），不是「要清掉吗？」。
    // 集合只认「真的过期了」的行，扔了不心疼，所以不设二次输入；
    // 但必须先把名字列出来 —— 「过期一天到底还能不能喝」各家判断不同，
    // 得让人看见自己要划掉的是哪几样，才有机会发现自己其实还留着。
    onClearExpired: function () {
        const expired = (this.allItems || []).filter(function (row) {
            return row && row.fresh && row.fresh.left < 0;
        });
        if (!expired.length) {
            util.toast('现在没有过期的食材');
            return;
        }
        const names = expired.slice(0, 4).map(function (row) {
            return row.display || row.name;
        }).join('、');
        const more = expired.length > 4 ? ' 等 ' + expired.length + ' 样' : '';
        const that = this;
        wx.showModal({
            title: '这 ' + expired.length + ' 样都扔掉了？',
            content: names + more + ' 会从冰箱里划掉，划掉就找不回来了。',
            confirmText: '都扔了',
            success: async function (res) {
                if (!res.confirm) return;
                wx.showLoading({ title: '正在记上', mask: true });
                const outcome = await stores.removeEach(stores.ingredients, expired);
                wx.hideLoading();
                if (outcome.failed) {
                    util.toast('划掉 ' + outcome.removed + ' 样，还有 ' + outcome.failed + ' 样没删掉，再试一次');
                } else {
                    util.toast('记下了，' + outcome.removed + ' 样清出冰箱 🧹');
                }
                that.setData({ expandedItem: 0 });
                await that.loadData();
            },
        });
    },

    // ---------- 点数量改档 ----------
    onFoodQtyTap: function (event) {
        const id = event.currentTarget.dataset.id;
        const row = (this.allItems || []).filter(function (item) { return item.id === id; })[0];
        if (!row) return;
        this.setData({
            qtySheet: { visible: true, id: id, name: row.display || row.name, value: row.quantity || '' },
        });
    },

    onQtySheetSave: async function (event) {
        const id = this.data.qtySheet.id;
        if (!id) return;
        const text = event.detail.quantity || '';
        const result = await stores.ingredients.update(id, { quantity: text });
        if (result.error) {
            util.toast(util.errorMessage(result.error, '没改成，再试一次'));
            return;
        }
        this.setData({ qtySheet: { visible: false, id: '', name: '', value: '' } });
        util.toast(text ? '记成「' + text + '」了' : '数量已清空');
        await this.loadData();
    },

    onQtySheetClose: function () {
        this.setData({ qtySheet: { visible: false, id: '', name: '', value: '' } });
    },

    // ---------- 极速录入 ----------
    openAddSheet: function () {
        // 只在打开弹层时重排一次：点选单位不立刻挪动 chip，避免手一点列表就跳位。
        this.setData(Object.assign({
            showAdd: true, parsedFoods: [], parseNote: '', addMode: 'tag',
            addedThisRound: [], addedExpanded: false,
            qtyUnits: units.read().chips,
            unitEditor: false, unitDraft: '', unitError: '',
        }, shelfCopy(this.data.form.shelfDays, ''), qtyView(this.data.form)));
        getApp().playDoorSound();
    },

    closeAddSheet: function () {
        this.setData({
            showAdd: false,
            addedThisRound: [], addedExpanded: false,
            unitEditor: false, unitDraft: '', unitError: '',
        });
    },

    onModeTap: function (event) {
        this.setData({ addMode: event.currentTarget.dataset.mode, parseNote: '' });
    },

    // 本次连续录入清单的展开 / 收起
    onRoundToggle: function () {
        this.setData({ addedExpanded: !this.data.addedExpanded });
    },

    onTagTap: function (event) {
        const name = event.currentTarget.dataset.name;
        const resolved = dict.resolve(name);
        const info = dict.meta(resolved.id || name);
        const days = info.known ? info.shelfDays : 3;
        const form = {
            name: name,
            emoji: info.emoji,
            zone: info.zone,
            qty: this.data.form.qty,
            unit: this.data.form.unit,
            qtyMode: this.data.form.qtyMode,
            shelfDays: days,
            note: '',
        };
        this.setData(Object.assign({ form: form }, qtyView(form), shelfCopy(days, foodNames.labelOf(name))));
    },

    onNameInput: function (event) {
        const value = event.detail.value;
        const resolved = dict.resolve(value);
        const patch = {
            'form.name': value,
            'form.emoji': value ? dict.meta(resolved.id || value).emoji : '🥬',
        };
        // 手动改名后，「按某某食材自动填」的说明就不再准确了
        if (this.data.shelfSource && value !== this.data.shelfSource) {
            Object.assign(patch, shelfCopy(this.data.form.shelfDays, ''));
        }
        this.setData(patch);
    },

    // 数量相关的所有改动都走同一个出口：只按路径改字段，不覆盖用户刚输入的名字/天数，
    // 同时把预览和模式说明一起刷新。
    setQty: function (patch) {
        const form = Object.assign({}, this.data.form, patch);
        const data = qtyView(form);
        Object.keys(patch).forEach(function (key) {
            data['form.' + key] = patch[key];
        });
        this.setData(data);
    },
    onQtyModeTap: function (event) {
        const mode = event.currentTarget.dataset.mode;
        if (quantity.modeMeta(mode).key !== mode) return;
        this.setQty({ qtyMode: mode });
    },
    onQtyInput: function (event) {
        this.setQty({ qty: event.detail.value });
    },
    onUnitTap: function (event) {
        const picked = event.currentTarget.dataset.unit;
        const value = picked === units.NONE_LABEL ? '' : picked;
        units.pick(value);
        this.setQty({ unit: value });
    },

    // 末尾的 + 号：就近展开一个小输入框，不套第二层弹层、不依赖高版本基础库。
    onUnitAddTap: function () {
        this.setData({ unitEditor: true, unitDraft: '', unitError: '' });
    },
    onUnitCancel: function () {
        this.setData({ unitEditor: false, unitDraft: '', unitError: '' });
    },
    onUnitDraftInput: function (event) {
        this.setData({ unitDraft: event.detail.value, unitError: '' });
    },
    onUnitSave: function () {
        const result = units.add(this.data.unitDraft);
        if (!result.ok) {
            this.setData({ unitError: result.error });
            return;
        }
        this.setData({
            qtyUnits: result.chips,
            unitEditor: false, unitDraft: '', unitError: '',
        });
        this.setQty({ unit: result.value });
        util.toast('「' + result.value + '」加好啦');
    },

    // 只删自建单位；已经入库的食材是数量文本快照，不受影响。
    onUnitLongPress: function (event) {
        const value = event.currentTarget.dataset.unit;
        if (!value || !units.isCustom(value)) return;
        const that = this;
        wx.showModal({
            title: '删掉这个单位？',
            content: '「' + value + '」会从可选列表里移除，已经记进冰箱的食材不受影响。',
            confirmText: '删掉',
            success: function (res) {
                if (!res.confirm) return;
                const result = units.remove(value);
                if (!result.ok) return;
                const wasPicked = that.data.form.unit === value;
                that.setData({
                    qtyUnits: result.chips,
                    unitEditor: false, unitDraft: '', unitError: '',
                });
                if (wasPicked) that.setQty({ unit: '' });
                util.toast('已删掉「' + value + '」');
            },
        });
    },
    onDaysInput: function (event) {
        const value = event.detail.value;
        this.setData(Object.assign({ 'form.shelfDays': value }, shelfCopy(value, '')));
    },
    onFormZoneTap: function (event) { this.setData({ 'form.zone': event.currentTarget.dataset.zone }); },
    onQuickInput: function (event) { this.setData({ quickText: event.detail.value }); },

    decorateParsed: function (list) {
        return (list || []).map(function (item) {
            return Object.assign({}, item, {
                zoneLabel: ZONE_LABEL[item.zone] || '冷藏',
                display: foodNames.displayName(item.food_id) || item.name,
                qtyKind: quantity.kindOf(item.quantity),
            });
        });
    },

    // 连续录入：保存成功后弹层保持打开，只重置表单并累计本次成果
    addSingle: async function () {
        if (this.addingSingle) return;
        const form = this.data.form;
        const name = String(form.name || '').trim();
        if (!name) {
            util.toast('先给食材起个名字吧');
            return;
        }
        const resolved = dict.resolve(name);
        let foodId = resolved.id;
        let canonical = resolved.canonical || name;
        if (resolved.status === 'ambiguous') {
            const picked = await foodNames.askAmbiguous(resolved.candidates);
            if (!picked) {
                util.toast('已取消，换个说法再录一次吧');
                return;
            }
            foodId = picked;
            canonical = dict.canonicalOf(picked);
        }
        if (!foodId) foodId = 'custom:' + dict.clean(name);
        // 等待云端返回期间用户可能又改了表单，先把入库值与回显值全部算成快照
        const days = clampShelfDays(form.shelfDays);
        const emoji = form.emoji || '🥣';
        const zone = form.zone;
        const quantityText = quantity.build(form.qtyMode, form.qty, form.unit);
        this.addingSingle = true;
        let result;
        try {
            result = await stores.ingredients.create(stores.scope({
                name: canonical,
                food_id: foodId,
                raw_name: name,
                emoji: emoji,
                zone: zone,
                quantity: quantityText,
                shelf_days: days,
                added_on: util.today(),
                expiry_on: util.addDays(util.today(), days),
                note: form.note || '',
                consumed: false,
            }));
        } finally {
            this.addingSingle = false;
        }
        if (result.error) {
            util.toast(util.errorMessage(result.error, '没放进去，请重试'));
            return;
        }
        // 用户反复用自己的叫法录入，第三次起自动成为展示名。
        foodNames.learn(name, foodId);
        const display = foodNames.displayName(foodId) || canonical;
        const item = {
            id: (result.data && result.data.id) || ('local-' + this.data.addedThisRound.length),
            name: display,
            display: display,
            emoji: emoji,
            quantity: quantityText,
            qtyKind: quantity.kindOf(quantityText),
            zone: zone,
            zoneLabel: ZONE_LABEL[zone] || '冷藏',
            shelfDays: days,
        };
        // 不再关弹层：重置表单、回到标签模式，追加本次录入清单
        const nextForm = defaultForm();
        this.setData(Object.assign({
            form: nextForm,
            addMode: 'tag',
            addedThisRound: this.data.addedThisRound.concat([item]),
        }, qtyView(nextForm), shelfCopy(3, '')));
        util.toast(display + ' 已住进冰箱 🧊');
        await this.loadData();
    },

    parseQuickText: async function () {
        const text = String(this.data.quickText || '').trim();
        if (!text) {
            util.toast('先写一句，比如「买了两斤排骨保质期3天」');
            return;
        }
        this.setData({ parsing: true, parseNote: 'AI 正在拆食材…', parsedFoods: [] });
        let foods = [];
        let note = 'AI 拆解完成，看看对不对 👇';
        try {
            foods = await ai.parseFoodsFromText(text);
        } catch (error) {
            foods = ai.fallbackParse(text);
            note = 'AI 暂时没连上，已用本地规则拆解 👇';
        }
        if (!foods.length) {
            foods = ai.fallbackParse(text);
            note = foodNote(foods, note);
        }
        this.setData({ parsing: false, parsedFoods: this.decorateParsed(foods), parseNote: note });
    },

    chooseReceipt: function () {
        const that = this;
        if (this.data.receiptBusy) return;
        if (typeof wx.chooseMedia !== 'function') {
            util.toast('当前环境不支持拍照，换个录入方式吧');
            return;
        }
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sourceType: ['album', 'camera'],
            success: async function (res) {
                const file = res.tempFiles && res.tempFiles[0];
                if (!file) return;
                that.setData({ receiptBusy: true, parseNote: '', parsedFoods: [] });
                try {
                    const base64 = await readBase64(file.tempFilePath);
                    const mime = file.fileType === 'image' ? 'image/jpeg' : 'image/jpeg';
                    const foods = await ai.parseReceipt(base64, mime);
                    if (!foods.length) {
                        that.setData({ receiptBusy: false, parseNote: '没认出食材，换张清楚点的小票，或用「点一点」录入。' });
                        return;
                    }
                    that.setData({
                        receiptBusy: false,
                        parsedFoods: that.decorateParsed(foods),
                        parseNote: '识别完成，认错的点 × 删掉，再一起放进冰箱 👇',
                    });
                } catch (error) {
                    that.setData({ receiptBusy: false, parseNote: '小票识别暂时不可用，请用「点一点」或「说一句」录入。' });
                }
            },
            fail: function () {
                that.setData({ receiptBusy: false });
            },
        });
    },

    removeParsed: function (event) {
        const index = Number(event.currentTarget.dataset.index);
        const list = this.data.parsedFoods.slice();
        list.splice(index, 1);
        this.setData({ parsedFoods: list });
    },

    // 「说一句 / 拍小票」的结果里，数量也能直接点选成模糊档位。
    onParsedQtyTap: function (event) {
        const index = Number(event.currentTarget.dataset.index);
        const list = this.data.parsedFoods.slice();
        const current = list[index];
        if (!current) return;
        const that = this;
        const items = quantity.FUZZY.concat(['不记']);
        // 已有精确数值时给一个「保留」选项，避免误点把数值丢掉
        if (current.quantity && !quantity.isFuzzy(current.quantity)) {
            items.unshift('保留「' + current.quantity + '」');
        }
        wx.showActionSheet({
            itemList: items,
            success: function (res) {
                const choice = items[res.tapIndex];
                if (!choice || choice.indexOf('保留') === 0) return;
                const value = quantity.isFuzzy(choice) ? choice : '';
                list[index] = Object.assign({}, current, {
                    quantity: value,
                    qtyKind: quantity.kindOf(value),
                });
                that.setData({ parsedFoods: list });
            },
            fail: function () {},
        });
    },

    addParsed: async function () {
        const list = this.data.parsedFoods;
        if (!list.length) return;
        // 有歧义的叫法先逐个问清楚，再统一入库，避免 showLoading 盖住选择弹层。
        const resolvedList = [];
        for (const food of list) {
            let id = food.food_id;
            let canonical = food.name;
            if (food.ambiguous && food.ambiguous.length) {
                const picked = await foodNames.askAmbiguous(food.ambiguous);
                if (!picked) {
                    util.toast('「' + (food.raw_name || food.name) + '」已跳过');
                    continue;
                }
                id = picked;
                canonical = dict.canonicalOf(picked);
            }
            resolvedList.push({ food: food, id: id, canonical: canonical });
        }
        if (!resolvedList.length) return;
        wx.showLoading({ title: '正在放进冰箱', mask: true });
        let success = 0;
        for (const entry of resolvedList) {
            const food = entry.food;
            const days = clampShelfDays(food.shelf_days);
            const result = await stores.ingredients.create(stores.scope({
                name: entry.canonical,
                food_id: entry.id,
                raw_name: food.raw_name || food.name,
                emoji: food.emoji || '🥣',
                zone: food.zone || 'cold',
                quantity: food.quantity || '',
                shelf_days: days,
                added_on: util.today(),
                expiry_on: util.addDays(util.today(), days),
                note: '',
                consumed: false,
            }));
            if (!result.error) {
                success += 1;
                foodNames.learn(food.raw_name || food.name, entry.id);
            }
        }
        wx.hideLoading();
        this.setData({ showAdd: false, parsedFoods: [], parseNote: '' });
        util.toast('放进去 ' + success + ' 样食材 🧊');
        await this.loadData();
    },

    // ---------- 千人千面：改叫法 ----------
    onFoodNameTap: function (event) {
        const id = event.currentTarget.dataset.id;
        if (!id || dict.isCustom(id)) {
            util.toast('自定义食材可以直接编辑名字');
            return;
        }
        const unified = foodNames.status().unified;
        this.setData({
            namePicker: {
                foodId: id,
                current: foodNames.displayName(id),
                names: foodNames.availableNames(id),
                scopeHint: unified ? '当前为家庭统一叫法，修改会同步给同冰箱成员' : '只对你自己生效，可在「我的」里改为家庭统一',
            },
        });
    },

    onNamePickerClose: function () { this.setData({ namePicker: null }); },

    onNamePickerPick: async function (event) {
        const picker = this.data.namePicker;
        if (!picker) return;
        const scope = foodNames.status().unified ? 'household' : 'personal';
        await foodNames.setPreference(picker.foodId, event.detail.name, { scope: scope });
        this.setData({ namePicker: null });
        util.toast('以后就叫它「' + event.detail.name + '」啦');
        await this.loadData();
    },

    onNamePickerReset: async function () {
        const picker = this.data.namePicker;
        if (!picker) return;
        await foodNames.clearPreference(picker.foodId, foodNames.status().unified ? 'household' : 'personal');
        this.setData({ namePicker: null });
        util.toast('已恢复默认叫法');
        await this.loadData();
    },
}));

function foodNote(foods, original) {
    return foods.length ? original : '没拆出食材，试试写「买了土豆、鸡蛋，保质期3天」';
}

function readBase64(filePath) {
    return new Promise(function (resolve, reject) {
        const fs = wx.getFileSystemManager();
        fs.readFile({
            filePath: filePath,
            encoding: 'base64',
            success: function (res) { resolve(res.data); },
            fail: function (error) { reject(error); },
        });
    });
}
