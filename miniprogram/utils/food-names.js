// 叫法偏好层：把「稳定身份」翻译成「这个用户、这个场景下该显示的中文名」。
// 优先级：显式/学习到的个人覆盖 > 家庭统一叫法 > 地域词包 > 通用主名。
// 外部受众强制回退通用主名，避免对方看不懂方言。
const dict = require('./food-dict');
const stores = require('./store');
const foodIcon = require('./food-icon');

const K_PREFS = 'food_name_prefs_cache';
const K_SETTINGS = 'food_name_settings_cache';
const K_USAGE = 'food_name_usage';
const K_ERROR = 'food_name_cloud_error';

const CTX_INTERNAL = {};
// #if social
const CTX_EXTERNAL = { external: true };
// #endif

const state = {
    personal: {},
    household: {},
    region: 'common',
    unified: false,
    cloudOk: false,
    loaded: false,
};
let lastSync = 0;

function app() {
    return typeof getApp === 'function' ? getApp() : null;
}

function currentKey() {
    const instance = app();
    return (instance && instance.householdKey) || '';
}

function myOwnerId() {
    const instance = app();
    return (instance && instance.userId) || '';
}

function storage(key, fallback) {
    try {
        const value = wx.getStorageSync(key);
        return value === '' || value == null ? fallback : value;
    } catch (error) {
        return fallback;
    }
}

function save(key, value) {
    try { wx.setStorageSync(key, value); } catch (error) { /* 存储不可用时仅用内存态 */ }
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function nowIso() {
    return new Date().toISOString();
}

function readLocal() {
    const cache = storage(K_PREFS, {}) || {};
    state.personal = cache.personal || {};
    state.household = cache.household || {};
    const settings = storage(K_SETTINGS, {}) || {};
    state.region = dict.REGION_PACKS[settings.region] ? settings.region : 'common';
    state.unified = !!settings.unified;
}

function writeLocal() {
    save(K_PREFS, { personal: state.personal, household: state.household });
    save(K_SETTINGS, { region: state.region, unified: state.unified });
}

function applyCloudRows(prefRows, settingRows) {
    const key = currentKey();
    const mine = myOwnerId();
    prefRows.forEach(function (row) {
        if (!row || !row.food_id || !row.preferred_name) return;
        const scope = row.pref_scope === 'household' ? 'household' : 'personal';
        if (scope === 'personal' && mine && row.owner_id && row.owner_id !== mine) return;
        if (scope === 'household' && (row.household_key || '') !== key) return;
        const target = scope === 'household' ? state.household : state.personal;
        if (!target[row.food_id]) target[row.food_id] = row.preferred_name;
    });
    const ownSetting = settingRows.filter(function (row) {
        return mine && row.owner_id && row.owner_id === mine;
    })[0];
    if (ownSetting && dict.REGION_PACKS[ownSetting.region]) state.region = ownSetting.region;
    const sharedSetting = settingRows.filter(function (row) {
        return (row.household_key || '') === key;
    })[0];
    if (sharedSetting) state.unified = !!sharedSetting.household_unified;
}

async function init() {
    readLocal();
    try {
        const results = await Promise.all([stores.foodNamePrefs.list(), stores.foodNameSettings.list()]);
        const prefs = results[0] || {};
        const settings = results[1] || {};
        if (prefs.error || settings.error) {
            throw new Error((prefs.error || settings.error).message || '偏好同步失败');
        }
        applyCloudRows(safeArray(prefs.data), safeArray(settings.data));
        state.cloudOk = true;
        save(K_ERROR, '');
    } catch (error) {
        state.cloudOk = false;
        save(K_ERROR, (error && error.message) || '云端偏好暂不可用，已使用本机设置');
    }
    state.loaded = true;
    writeLocal();
    return status();
}

// 页面 onShow 调它：30 秒内不重复打云端，保证 loadData 渲染前偏好已就位。
function sync(force) {
    if (state.loaded && !force && Date.now() - lastSync < 30000) return Promise.resolve(status());
    lastSync = Date.now();
    return init();
}

function displayName(id, ctx) {
    const options = ctx || {};
    if (!id) return options.fallback || '';
    if (dict.isCustom(id)) return dict.customLabel(id);
    if (options.external || options.canonical) return dict.canonicalOf(id);
    const household = state.household[id];
    if (state.unified && household) return household;
    if (state.personal[id]) return state.personal[id];
    if (household) return household;
    const pack = dict.REGION_PACKS[state.region];
    if (pack && pack.names[id]) return pack.names[id];
    return dict.canonicalOf(id);
}

function labelOf(value, ctx) {
    if (!value) return '';
    const raw = String(value);
    let id = null;
    if (dict.BY_ID[raw] || dict.isCustom(raw)) id = raw;
    else id = dict.resolveId(raw);
    return id ? displayName(id, ctx) : raw;
}

function labels(list, ctx) {
    return safeArray(list).map(function (item) { return labelOf(item, ctx); });
}

function joinLabels(list, ctx, sep) {
    return labels(list, ctx).filter(Boolean).join(sep || '、');
}

function decorate(row, ctx) {
    const source = row || {};
    const raw = source.raw_name || source.name || '';
    let id = source.food_id;
    if (!id && raw) id = dict.resolveId(raw) || ('custom:' + dict.clean(raw));
    return Object.assign({}, source, {
        food_id: id || '',
        display: (id ? displayName(id, ctx) : '') || source.name || '',
        canonical: id ? dict.canonicalOf(id) : (source.name || ''),
        icon: foodIcon.iconOf(id),
    });
}

function decorateList(rows, ctx) {
    return safeArray(rows).map(function (row) { return decorate(row, ctx); });
}

function status() {
    return {
        cloudOk: state.cloudOk,
        loaded: state.loaded,
        region: state.region,
        unified: state.unified,
        prefCount: Object.keys(state.personal).length + Object.keys(state.household).length,
        error: storage(K_ERROR, ''),
    };
}

function noteCloudResult(result) {
    state.cloudOk = !(result && result.error);
    save(K_ERROR, state.cloudOk ? '' : ((result && result.error && result.error.message) || '叫法偏好暂未同步'));
    return result;
}

async function upsertPref(payload) {
    const key = currentKey();
    const mine = myOwnerId();
    const list = await stores.foodNamePrefs.list();
    if (!list.error) {
        for (const row of safeArray(list.data)) {
            if (row.food_id !== payload.food_id) continue;
            if ((row.pref_scope || 'personal') !== payload.pref_scope) continue;
            if ((row.household_key || '') !== key) continue;
            if (payload.pref_scope === 'personal' && mine && row.owner_id && row.owner_id !== mine) continue;
            await stores.foodNamePrefs.remove(row.id);
        }
    }
    const result = await stores.foodNamePrefs.create(stores.scope(Object.assign({}, payload, { updated_at: nowIso() })));
    return noteCloudResult(result);
}

async function upsertSettings() {
    writeLocal();
    const key = currentKey();
    const mine = myOwnerId();
    const list = await stores.foodNameSettings.list();
    let mineRow = null;
    if (!list.error) {
        for (const row of safeArray(list.data)) {
            if ((row.household_key || '') !== key) continue;
            if (mine && row.owner_id && row.owner_id === mine) { mineRow = row; break; }
            if (!mine && !mineRow) mineRow = row;
        }
    }
    const payload = stores.scope({ region: state.region, household_unified: state.unified, updated_at: nowIso() });
    const result = mineRow
        ? await stores.foodNameSettings.update(mineRow.id, payload)
        : await stores.foodNameSettings.create(payload);
    return noteCloudResult(result);
}

async function setPreference(id, name, options) {
    const opt = options || {};
    const scope = opt.scope === 'household' ? 'household' : 'personal';
    const label = String(name || '').trim().slice(0, 12);
    if (!id || !label) return { data: null, error: { message: '叫法不能为空' } };
    if (scope === 'household') state.household[id] = label;
    else state.personal[id] = label;
    writeLocal();
    return upsertPref({
        food_id: id,
        preferred_name: label,
        pref_scope: scope,
        pref_source: opt.source || 'explicit',
    });
}

async function clearPreference(id, scope) {
    const bucket = scope === 'household' ? state.household : state.personal;
    delete bucket[id];
    writeLocal();
    const key = currentKey();
    const mine = myOwnerId();
    const list = await stores.foodNamePrefs.list();
    if (!list.error) {
        for (const row of safeArray(list.data)) {
            if (row.food_id !== id) continue;
            if ((row.pref_scope || 'personal') !== (scope || 'personal')) continue;
            if ((row.household_key || '') !== key) continue;
            // 个人偏好只能删自己的；多成员作用域里能看到别人的行，不能顺手清掉。
            if ((scope || 'personal') === 'personal' && mine && row.owner_id && row.owner_id !== mine) continue;
            await stores.foodNamePrefs.remove(row.id);
        }
    }
    state.cloudOk = true;
    save(K_ERROR, '');
    return { data: null, error: null };
}

async function setRegion(region) {
    if (!dict.REGION_PACKS[region]) return status();
    state.region = region;
    await upsertSettings();
    return status();
}

// #if social
async function setHouseholdUnified(value) {
    state.unified = !!value;
    await upsertSettings();
    return status();
}
// #endif

// 隐式学习：用户反复用自己的叫法录入，第 3 次后自动成为展示名。
// 只记录原话词频，跨设备同步的是「最终结论」而不是原始日志。
function learn(raw, id) {
    if (!raw || !id || dict.isCustom(id)) return null;
    const word = String(raw).trim().slice(0, 12);
    if (!word || dict.clean(word) === dict.clean(dict.canonicalOf(id))) return null;
    const usage = storage(K_USAGE, {}) || {};
    const key = id + '|' + word;
    usage[key] = (Number(usage[key]) || 0) + 1;
    save(K_USAGE, usage);
    if (usage[key] < 3) return null;
    if (state.personal[id] || state.household[id]) return null;
    const pack = dict.REGION_PACKS[state.region];
    if (pack && pack.names[id]) return null;
    return setPreference(id, word, { source: 'learned' });
}

// 同物异名冲突（如「番瓜」既可能指南瓜也可能指西葫芦）不自动猜，让用户选一次。
function askAmbiguous(candidates) {
    return new Promise(function (resolve) {
        const list = (candidates || []).slice(0, 5);
        if (!list.length) return resolve(null);
        wx.showActionSheet({
            itemList: list.map(function (item) { return item.canonical; }).concat(['跳过这一样']),
            success: function (res) {
                if (res.tapIndex >= list.length) return resolve(null);
                resolve(list[res.tapIndex].id);
            },
            fail: function () { resolve(null); },
        });
    });
}

module.exports = {
    CTX_INTERNAL: CTX_INTERNAL,
    // #if social
    CTX_EXTERNAL: CTX_EXTERNAL,
    // #endif
    init: init,
    sync: sync,
    loadLocal: readLocal,
    status: status,
    displayName: displayName,
    labelOf: labelOf,
    labels: labels,
    joinLabels: joinLabels,
    decorate: decorate,
    decorateList: decorateList,
    setPreference: setPreference,
    clearPreference: clearPreference,
    setRegion: setRegion,
    // #if social
    setHouseholdUnified: setHouseholdUnified,
    // #endif
    learn: learn,
    availableNames: dict.namesOf,
    askAmbiguous: askAmbiguous,
};
