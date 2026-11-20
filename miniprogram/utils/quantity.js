// 食材数量的统一语义。数据库沿用 ingredients.quantity / shopping_items.quantity
// 这一个描述性字符串，不新增列、不需要迁移历史数据：
//   ''                 → 没记数量
//   '2 盒' / '两斤'    → 精确：数值 + 可选单位
//   '很多' / '少量'    → 模糊：录入时点选档位
//   '一大堆' / '少许'  → 模糊：一句话录入 / 小票识别原样保留的口语说法
// 口语不归一：「一大堆」就存「一大堆」。下面的词表只用来判断「它属于哪一档」，
// 好让列表照常走模糊色、点数量时能改档；它绝不改写存储值。
// 数量只用于展示与录入；菜谱匹配只看食材身份，不比较数量档位。

const FUZZY = ['很多', '少量'];

// 三种写法是同一层级的「三选一」，不是先精确再补充描述。
// 录入表单用这个数组渲染一排等宽的模式按钮，选中哪个就只展示哪个的内容。
// 这里没有「不记」这一档：精确模式下空着数值就是没记，再给一个按钮
// 只是把已经空着的东西重新声明一次为空，等于同一个结果开了两个入口。
const MODES = [
    { key: 'exact', label: '精确', value: '', desc: '填个数字，再点个单位；只填数字也行' },
    { key: 'many', label: '很多', value: '很多', desc: '一大堆，够做好几顿，不用一个个数' },
    { key: 'little', label: '少量', value: '少量', desc: '只剩一点，做一道菜刚好，别按整份算' },
];

// 口语说法 → 两个标准档位。长词优先，避免「一点」抢走「一点点」。
// 故意不收「不多」：它会命中「差不多」这类无关词。
// 注意：这张表只用于「认出它属于哪一档」，不用于把输入改写成标准值。
const ALIASES = [
    ['很多', ['许许多多', '一大堆', '许多', '好多', '不少', '超多', '大量', '挺多', '蛮多', '一堆', '很多']],
    ['少量', ['一点点', '一丢丢', '一丁点', '些许', '少量', '少许', '一点']],
];

const ALIAS_MAP = {};
const ALIAS_WORDS = [];
ALIASES.forEach(function (entry) {
    entry[1].forEach(function (word) {
        ALIAS_MAP[word] = entry[0];
        ALIAS_WORDS.push(word);
    });
});
ALIAS_WORDS.sort(function (a, b) { return b.length - a.length; });

// 是否属于模糊档：既认标准档位「很多/少量」，也认「一大堆/少许」这类口语。
// 只做判定，不改写 —— 库里存的仍然是模型或用户原本给的那个词。
function isFuzzy(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return false;
    return FUZZY.indexOf(raw) >= 0 || !!canonical(raw);
}

function kindOf(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return 'none';
    return isFuzzy(raw) ? 'fuzzy' : 'exact';
}

// 认出「这句话在说哪一档」。只用于判定，不用于改写存储值：
// 「一大堆」会被认成 many，但落库的仍然是「一大堆」。
function canonical(text) {
    const raw = String(text == null ? '' : text).trim().slice(0, 12);
    if (!raw) return '';
    const cleaned = raw.replace(/[的啊吧呢哦呀了~～。！!\s]/g, '');
    return ALIAS_MAP[cleaned] || '';
}

// 在一句话里找口语量词，返回 { value, word }：value 是所属档位（只供判定），
// word 是原词——拆解时把它从食材名里剔掉，并原样写进 quantity。
// 取最靠前的一次出现，同位时取更长的词（「一点点」优先于「一点」）。
function scan(text) {
    const raw = String(text == null ? '' : text);
    let best = { value: '', word: '', index: Infinity, length: 0 };
    for (const word of ALIAS_WORDS) {
        const index = raw.indexOf(word);
        if (index < 0) continue;
        if (index < best.index || (index === best.index && word.length > best.length)) {
            best = { value: ALIAS_MAP[word], word: word, index: index, length: word.length };
        }
    }
    return best.value ? { value: best.value, word: best.word } : { value: '', word: '' };
}

// 精确录入：数值 + 可选单位，拼成「2 盒」这样的描述文本，
// 和 AI 拆解结果写进 quantity 字段的格式保持一致。
function join(qty, unit) {
    const n = String(qty == null ? '' : qty).trim();
    if (!n) return '';
    const u = String(unit || '').trim();
    return u && u !== '无' ? n + ' ' + u : n;
}

// 录入表单统一出口：一个模式只产出一个值，三档互不叠加。
// 也接受「很多 / 少量」这样的字面值，方便 AI 结果与历史行直接回显。
// 'none' 已经不是可选按钮，但这条分支必须留着：改档弹层回显空值、
// 以及旧版传进来的 'none' 都会走到这里，删掉就会退化成走精确分支。
function build(mode, qty, unit) {
    const key = String(mode == null ? '' : mode).trim();
    if (key === 'many' || key === '很多') return '很多';
    if (key === 'little' || key === '少量') return '少量';
    if (key === 'none') return '';
    return join(qty, unit);
}

// 从已存的描述串反推模式，用于历史行回显与识别结果的初始状态。
// 口语值（「一大堆」）回显成对应档位，但不会把库里的原话改成「很多」。
function modeOf(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return 'none';
    const canon = canonical(raw);
    if (canon === '很多') return 'many';
    if (canon === '少量') return 'little';
    return 'exact';
}

function modeMeta(key) {
    return MODES.filter(function (item) { return item.key === key; })[0] || MODES[0];
}

// 从已存的描述串反推「数值 + 单位」，供列表里点数量改档时回显。
// 只做拆分，不改写：拆不出来的（「一大堆」「两斤」）整串留在数值框里，
// 用户保存时原样拼回去，历史数据不会因为点开过一次就被悄悄改掉。
function parse(text) {
    const raw = String(text == null ? '' : text).trim();
    const mode = modeOf(raw);
    if (mode !== 'exact') return { mode: mode, qty: '', unit: '' };
    const parts = raw.split(/\s+/);
    if (parts.length >= 2) {
        return { mode: 'exact', qty: parts[0], unit: parts.slice(1).join(' ') };
    }
    // 「2盒」这种没空格的写法：只在数字打头时才拆，避免把「两斤」撕成「两」+「斤」。
    const packed = raw.match(/^(\d+(?:\.\d+)?)([^\d].*)$/);
    if (packed) return { mode: 'exact', qty: packed[1], unit: packed[2].trim() };
    return { mode: 'exact', qty: raw, unit: '' };
}

module.exports = {
    FUZZY: FUZZY,
    MODES: MODES,
    isFuzzy: isFuzzy,
    kindOf: kindOf,
    canonical: canonical,
    scan: scan,
    join: join,
    build: build,
    modeOf: modeOf,
    modeMeta: modeMeta,
    parse: parse,
};
