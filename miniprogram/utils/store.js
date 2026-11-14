// 数据层：所有页面只通过这里读写云端，不直接碰 cloud.database。
const { cloud } = require('./cloud');
const { createTableAccess } = require('./workbuddy-data-access');
const { pick, safeArray } = require('./util');

const COMMON = ['owner_name', 'household_key'];
const INGREDIENT_FIELDS = COMMON.concat(['name', 'food_id', 'raw_name', 'emoji', 'zone', 'quantity', 'shelf_days', 'added_on', 'expiry_on', 'note', 'consumed']);
const SHOPPING_FIELDS = COMMON.concat(['name', 'food_id', 'raw_name', 'emoji', 'quantity', 'from_recipe', 'done']);
const RECIPE_FIELDS = COMMON.concat(['name', 'emoji', 'main_items', 'seasonings', 'steps', 'minutes', 'difficulty', 'tags', 'source']);
const SHARE_FIELDS = COMMON.concat(['title', 'share_code', 'recipe_ids', 'status']);
const HOUSEHOLD_FIELDS = ['owner_name', 'name', 'invite_code'];
const MEMBER_FIELDS = ['owner_name', 'household_key', 'role'];
const PREF_FIELDS = COMMON.concat(['food_id', 'preferred_name', 'pref_scope', 'pref_source', 'updated_at']);
const SETTING_FIELDS = COMMON.concat(['region', 'household_unified', 'updated_at']);
// 做菜次数：写入白名单。owner_id 由服务端 DEFAULT + RLS 决定，绝不进白名单。
const COOK_COUNT_FIELDS = COMMON.concat(['recipe_key', 'cook_count']);

const ingredients = createTableAccess(cloud, {
    table: 'ingredients',
    columns: ['id', 'owner_id', 'owner_name', 'household_key', 'name', 'food_id', 'raw_name', 'emoji', 'zone', 'quantity', 'shelf_days', 'added_on', 'expiry_on', 'note', 'consumed', 'created_at'],
    toRow: function (row) { return pick(row, INGREDIENT_FIELDS); },
    orderBy: { column: 'expiry_on', ascending: true },
});

const shopping = createTableAccess(cloud, {
    table: 'shopping_items',
    columns: ['id', 'owner_id', 'owner_name', 'household_key', 'name', 'food_id', 'raw_name', 'emoji', 'quantity', 'from_recipe', 'done', 'created_at'],
    toRow: function (row) { return pick(row, SHOPPING_FIELDS); },
    orderBy: { column: 'created_at', ascending: false },
});

const recipes = createTableAccess(cloud, {
    table: 'recipes',
    columns: ['id', 'owner_id', 'owner_name', 'name', 'emoji', 'main_items', 'seasonings', 'steps', 'minutes', 'difficulty', 'tags', 'source', 'household_key', 'created_at'],
    toRow: function (row) { return pick(row, RECIPE_FIELDS); },
    orderBy: { column: 'created_at', ascending: false },
});

// 做菜次数：一行 = 一个家庭里的一道菜。recipe_key 统一标识内置 'b1' 与云端 'c12'。
// 本轮只读不写；create/update/remove 通路随 createTableAccess 自动具备，后续接 +1 不用重构。
// FIELDS 与 columns 是双层白名单，少写一处就会写入被丢或读取不返回。
const recipeCookCounts = createTableAccess(cloud, {
    table: 'recipe_cook_counts',
    columns: ['id', 'owner_id', 'owner_name', 'household_key', 'recipe_key', 'cook_count', 'created_at'],
    toRow: function (row) { return pick(row, COOK_COUNT_FIELDS); },
    orderBy: { column: 'created_at', ascending: false },
});

const shares = createTableAccess(cloud, {
    table: 'menu_shares',
    columns: ['id', 'owner_id', 'owner_name', 'household_key', 'title', 'share_code', 'recipe_ids', 'status', 'created_at'],
    toRow: function (row) { return pick(row, SHARE_FIELDS); },
    orderBy: { column: 'created_at', ascending: false },
});

const households = createTableAccess(cloud, {
    table: 'households',
    columns: ['id', 'owner_id', 'owner_name', 'name', 'invite_code', 'created_at'],
    toRow: function (row) { return pick(row, HOUSEHOLD_FIELDS); },
    orderBy: { column: 'created_at', ascending: false },
});

const members = createTableAccess(cloud, {
    table: 'household_members',
    columns: ['id', 'owner_id', 'owner_name', 'household_key', 'role', 'created_at'],
    toRow: function (row) { return pick(row, MEMBER_FIELDS); },
    orderBy: { column: 'created_at', ascending: false },
});

// 叫法偏好：personal 行只对本人生效，household 行对同一个共享冰箱的成员生效。
const foodNamePrefs = createTableAccess(cloud, {
    table: 'food_name_prefs',
    columns: ['id', 'owner_id', 'owner_name', 'household_key', 'food_id', 'preferred_name', 'pref_scope', 'pref_source', 'updated_at', 'created_at'],
    toRow: function (row) { return pick(row, PREF_FIELDS); },
    orderBy: { column: 'updated_at', ascending: false },
});

const foodNameSettings = createTableAccess(cloud, {
    table: 'food_name_settings',
    columns: ['id', 'owner_id', 'owner_name', 'household_key', 'region', 'household_unified', 'updated_at', 'created_at'],
    toRow: function (row) { return pick(row, SETTING_FIELDS); },
    orderBy: { column: 'updated_at', ascending: false },
});

function ownerName() {
    const app = typeof getApp === 'function' ? getApp() : null;
    return (app && app.userName) || null;
}

// 写入时统一附带当前共享冰箱作用域与昵称快照；owner_id 由服务端 DEFAULT + RLS 决定，绝不从前端传。
function scope(payload) {
    const app = typeof getApp === 'function' ? getApp() : null;
    const key = app && app.householdKey ? app.householdKey : '';
    return Object.assign({}, payload, { household_key: key, owner_name: ownerName() });
}

function householdScope(payload) {
    return Object.assign({}, payload, { household_key: (typeof getApp === 'function' && getApp().householdKey) || '' });
}

// 做菜次数一次拉全：RLS 已按 household_key 过滤，无需再 eq；页面本地合并，避免每张卡片一次请求。
// 读取失败返回空字典让页面按「全 0」正常渲染、不阻塞主流程；留一条 warn 是为了区分
// 「云端表还没建好」和「确实一道菜都没做过」——两者在 UI 上长得一模一样。
async function cookCountMap() {
    const result = await recipeCookCounts.list();
    const map = {};
    if (!result || result.error) {
        if (result && result.error) console.warn('[cookCountMap] 做菜次数读取失败：', result.error);
        return map;
    }
    (result.data || []).forEach(function (row) {
        if (!row || !row.recipe_key) return;
        const n = Number(row.cook_count);
        map[row.recipe_key] = Number.isFinite(n) && n > 0 ? n : 0;
    });
    return map;
}

async function findHouseholdByCode(code) {
    const result = await cloud.database.from('households').select('id, name, invite_code, owner_id').eq('invite_code', String(code || '').trim().toUpperCase()).limit(1);
    if (result.error) return { data: null, error: result.error };
    return { data: (safeArray(result.data)[0] || null), error: null };
}

async function findShareByCode(code) {
    const result = await cloud.database.from('menu_shares').select('*').eq('share_code', String(code || '').trim().toUpperCase()).limit(1);
    if (result.error) return { data: null, error: result.error };
    return { data: (safeArray(result.data)[0] || null), error: null };
}

async function listVotes(code) {
    const result = await cloud.database.from('menu_votes').select('id, share_code, recipe_id, recipe_name, guest_name, created_at').eq('share_code', String(code || '').trim().toUpperCase()).order('created_at', { ascending: false });
    return { data: safeArray(result.data), error: result.error || null };
}

async function addVote(payload) {
    const row = pick(payload, ['share_code', 'recipe_id', 'recipe_name', 'guest_name']);
    const result = await cloud.database.from('menu_votes').insert(row).select();
    return { data: safeArray(result.data)[0] || null, error: result.error || null };
}

module.exports = {
    ingredients: ingredients,
    shopping: shopping,
    recipes: recipes,
    shares: shares,
    households: households,
    members: members,
    foodNamePrefs: foodNamePrefs,
    foodNameSettings: foodNameSettings,
    recipeCookCounts: recipeCookCounts,
    scope: scope,
    householdScope: householdScope,
    ownerName: ownerName,
    cookCountMap: cookCountMap,
    findHouseholdByCode: findHouseholdByCode,
    findShareByCode: findShareByCode,
    listVotes: listVotes,
    addVote: addVote,
};
