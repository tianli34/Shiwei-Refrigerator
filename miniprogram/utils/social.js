// 社交数据层：菜单分享、好友点菜、共享冰箱。
// 单独成文件，是为了让个人版构建能整文件删除（见 scripts/build.js），
// 不必去改公共数据层里的任何一行。所有引用都包在条件编译标记里。
const { cloud } = require('./cloud');
const { createTableAccess } = require('./workbuddy-data-access');
const { pick, safeArray } = require('./util');

const COMMON = ['owner_name', 'household_key'];
const SHARE_FIELDS = COMMON.concat(['title', 'share_code', 'recipe_ids', 'status']);
const HOUSEHOLD_FIELDS = ['owner_name', 'name', 'invite_code'];
const MEMBER_FIELDS = ['owner_name', 'household_key', 'role'];

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
    shares: shares,
    households: households,
    members: members,
    findHouseholdByCode: findHouseholdByCode,
    findShareByCode: findShareByCode,
    listVotes: listVotes,
    addVote: addVote,
};
