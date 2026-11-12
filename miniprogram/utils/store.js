// 数据层：所有页面只通过这里读写云端，不直接碰 cloud.database。
const { cloud } = require('./cloud');
const { createTableAccess } = require('./workbuddy-data-access');
const { pick, safeArray } = require('./util');

const COMMON = ['owner_name', 'household_key'];
const INGREDIENT_FIELDS = COMMON.concat(['name', 'emoji', 'zone', 'quantity', 'shelf_days', 'added_on', 'expiry_on', 'note', 'consumed']);
const SHOPPING_FIELDS = COMMON.concat(['name', 'emoji', 'quantity', 'from_recipe', 'done']);
const RECIPE_FIELDS = COMMON.concat(['name', 'emoji', 'main_items', 'seasonings', 'steps', 'minutes', 'difficulty', 'tags', 'source']);
const SHARE_FIELDS = COMMON.concat(['title', 'share_code', 'recipe_ids', 'status']);
const HOUSEHOLD_FIELDS = ['owner_name', 'name', 'invite_code'];
const MEMBER_FIELDS = ['owner_name', 'household_key', 'role'];

const ingredients = createTableAccess(cloud, {
    table: 'ingredients',
    columns: ['id', 'owner_id', 'owner_name', 'household_key', 'name', 'emoji', 'zone', 'quantity', 'shelf_days', 'added_on', 'expiry_on', 'note', 'consumed', 'created_at'],
    toRow: function (row) { return pick(row, INGREDIENT_FIELDS); },
    orderBy: { column: 'expiry_on', ascending: true },
});

const shopping = createTableAccess(cloud, {
    table: 'shopping_items',
    columns: ['id', 'owner_id', 'owner_name', 'household_key', 'name', 'emoji', 'quantity', 'from_recipe', 'done', 'created_at'],
    toRow: function (row) { return pick(row, SHOPPING_FIELDS); },
    orderBy: { column: 'created_at', ascending: false },
});

const recipes = createTableAccess(cloud, {
    table: 'recipes',
    columns: ['id', 'owner_id', 'owner_name', 'name', 'emoji', 'main_items', 'seasonings', 'steps', 'minutes', 'difficulty', 'tags', 'source', 'household_key', 'created_at'],
    toRow: function (row) { return pick(row, RECIPE_FIELDS); },
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
    scope: scope,
    householdScope: householdScope,
    ownerName: ownerName,
    findHouseholdByCode: findHouseholdByCode,
    findShareByCode: findShareByCode,
    listVotes: listVotes,
    addVote: addVote,
};
