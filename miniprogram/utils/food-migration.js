// 一次性历史数据回填：给改造前只有中文名的库存/买菜篮补上稳定 food_id 与原话留痕。
// 只做加法，不改 name、不删任何行；失败不标记完成，下次启动自动重试。
const dict = require('./food-dict');
const stores = require('./store');

const KEY = 'food_id_backfill_v1';

function isDone() {
    try { return !!wx.getStorageSync(KEY); } catch (error) { return false; }
}

function markDone() {
    try { wx.setStorageSync(KEY, true); } catch (error) { /* 下次启动重试 */ }
}

async function run() {
    if (isDone()) return { count: 0, skipped: true };
    const results = await Promise.all([stores.ingredients.list(), stores.shopping.list()]);
    if (results[0].error || results[1].error) return { count: 0, error: true };
    const groups = [
        [stores.ingredients, results[0].data || []],
        [stores.shopping, results[1].data || []],
    ];
    let count = 0;
    for (const group of groups) {
        for (const row of group[1]) {
            if (row.food_id) continue;
            const raw = String(row.raw_name || row.name || '').trim();
            if (!raw) continue;
            const id = dict.resolveId(raw) || ('custom:' + dict.clean(raw));
            const result = await group[0].update(row.id, {
                food_id: id,
                raw_name: raw.slice(0, 16),
            });
            if (!result.error) count += 1;
        }
    }
    markDone();
    return { count: count, skipped: false };
}

module.exports = { run: run };
