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
// 食材消耗次数：写入白名单。口径同上，键是归一后的 food_id，不是展示名。
const CONSUMED_COUNT_FIELDS = COMMON.concat(['food_id', 'consumed_count']);

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

// 食材消耗次数：一行 = 一个家庭里的一样食材，按归一后的 food_id 累计（五花肉与猪肉分开计）。
// 结构与 recipe_cook_counts 同构；本轮只读不写，UNIQUE(household_key, food_id) 为后续原子自增铺路。
const ingredientConsumedCounts = createTableAccess(cloud, {
    table: 'ingredient_consumed_counts',
    columns: ['id', 'owner_id', 'owner_name', 'household_key', 'food_id', 'consumed_count', 'created_at'],
    toRow: function (row) { return pick(row, CONSUMED_COUNT_FIELDS); },
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

function scopeKey() {
    const app = typeof getApp === 'function' ? getApp() : null;
    return (app && app.householdKey) || '';
}

// 写入时统一附带当前共享冰箱作用域与昵称快照；owner_id 由服务端 DEFAULT + RLS 决定，绝不从前端传。
function scope(payload) {
    return Object.assign({}, payload, { household_key: scopeKey(), owner_name: ownerName() });
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

// 食材消耗次数一次拉全，键是 food_id：食物名会随叫法偏好变，只有 food_id 是稳定身份。
// 读失败同样返回空字典让卡片照常渲染，warn 用于区分「表没建好」与「确实没消耗过」。
async function consumedCountMap() {
    const result = await ingredientConsumedCounts.list();
    const map = {};
    if (!result || result.error) {
        if (result && result.error) console.warn('[consumedCountMap] 食材消耗次数读取失败：', result.error);
        return map;
    }
    (result.data || []).forEach(function (row) {
        if (!row || !row.food_id) return;
        const n = Number(row.consumed_count);
        map[row.food_id] = Number.isFinite(n) && n > 0 ? n : 0;
    });
    return map;
}

// 计数表统一的自增 / 自减：一行 = 一个作用域（共享冰箱，或本人的独立冰箱）里的一道菜 / 一样食材。
// 没有计数行就先建一行；建的时候撞上唯一键（并发下别的成员刚建过），就重读一次改成加减。
// 前端只能写绝对值，所以「先读后写」：同一家庭的极端并发可能少记一次，
// 但绝不会写成负数 —— 这里 clamp 一次，表上的 CHECK(>=0) 再兜一层。
function applyCount(table, countField, row, step) {
    const current = Number(row[countField]);
    const next = Math.max(0, (Number.isFinite(current) ? current : 0) + step);
    const patch = {};
    patch[countField] = next;
    return table.update(row.id, patch).then(function (result) {
        return { data: next, error: result.error };
    });
}

async function bumpCount(table, keyField, countField, key, delta) {
    const id = String(key == null ? '' : key).trim();
    if (!id) return { data: null, error: { message: '缺少计数键' } };
    const step = Number(delta) < 0 ? -1 : 1;

    const find = async function () {
        const list = await table.list();
        if (list.error) return { row: null, error: list.error };
        const rows = safeArray(list.data).filter(function (row) { return row && row[keyField] === id; });
        if (!rows.length) return { row: null, error: null };
        const key0 = scopeKey();
        const mine = rows.filter(function (row) { return (row.household_key || '') === key0; })[0];
        return { row: mine || rows[0], error: null };
    };

    const first = await find();
    if (first.error) return { data: null, error: first.error };
    if (first.row) return applyCount(table, countField, first.row, step);
    if (step < 0) return { data: 0, error: null };

    const payload = scope({});
    payload[keyField] = id;
    payload[countField] = 1;
    const created = await table.create(payload);
    if (!created.error) return { data: 1, error: null };

    const second = await find();
    if (second.error || !second.row) return { data: null, error: created.error };
    return applyCount(table, countField, second.row, step);
}

// 一道菜被做过一次：recipe_key 统一标识内置 'b1' 与云端 'c12'。
function bumpCookCount(recipeKey, delta) {
    return bumpCount(recipeCookCounts, 'recipe_key', 'cook_count', recipeKey, delta);
}

// 一样食材被消耗一次：键是归一后的 food_id，五花肉与猪肉各记各的。
function bumpConsumedCount(foodId, delta) {
    return bumpCount(ingredientConsumedCounts, 'food_id', 'consumed_count', foodId, delta);
}

// 批量删除：数据访问层与云端都只有「按 id 删一条」，没有批量入口，
// 所以只能一条一条发。串行太慢（50 样要等十几秒），全并发又会把一次清空
// 变成几十个同时到达的请求，所以固定 4 个并发轮流取队列。
// 返回 { removed, failed }：部分失败要如实告诉用户删掉了几样，
// 不能因为最后一条失败就把「已经删了 39 样」说成「清空失败」。
async function removeEach(table, rows) {
    const queue = (rows || []).filter(function (row) { return row && row.id; }).slice();
    let removed = 0;
    let failed = 0;
    const LIMIT = 4;

    async function worker() {
        for (;;) {
            const row = queue.shift();
            if (!row) return;
            const result = await table.remove(row.id);
            if (result && result.error) failed += 1;
            else removed += 1;
        }
    }

    const workers = [];
    const size = Math.min(LIMIT, queue.length);
    for (let i = 0; i < size; i += 1) workers.push(worker());
    await Promise.all(workers);
    return { removed: removed, failed: failed };
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
    ingredientConsumedCounts: ingredientConsumedCounts,
    scope: scope,
    householdScope: householdScope,
    ownerName: ownerName,
    cookCountMap: cookCountMap,
    consumedCountMap: consumedCountMap,
    bumpCookCount: bumpCookCount,
    bumpConsumedCount: bumpConsumedCount,
    removeEach: removeEach,
    findHouseholdByCode: findHouseholdByCode,
    findShareByCode: findShareByCode,
    listVotes: listVotes,
    addVote: addVote,
};
