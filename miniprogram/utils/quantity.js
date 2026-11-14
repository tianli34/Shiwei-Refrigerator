// 食材数量的统一语义。数据库沿用 ingredients.quantity / shopping_items.quantity
// 这一个描述性字符串，不新增列、不需要迁移历史数据：
//   ''               → 没记数量
//   '2 盒' / '两斤'  → 精确：数值 + 可选单位
//   '很多' / '少量'  → 模糊：录入时直接点选，或由 AI / 本地兜底从口语归一
// 数量只用于展示与录入；菜谱匹配只看食材身份，不比较数量档位。

const FUZZY = ['很多', '少量'];

// 四种写法是同一层级的「四选一」，不是先精确再补充描述。
// 录入表单用这个数组渲染一排等宽的模式按钮，选中哪个就只展示哪个的内容。
const MODES = [
    { key: 'exact', label: '精确', value: '', desc: '填个数字，再点个单位；只填数字也行' },
    { key: 'many', label: '很多', value: '很多', desc: '一大堆，够做好几顿，不用一个个数' },
    { key: 'little', label: '少量', value: '少量', desc: '只剩一点，做一道菜刚好，别按整份算' },
    { key: 'none', label: '不记', value: '', desc: '先空着，冰箱里照样能看到它' },
];

// 口语说法 → 两个标准档位。长词优先，避免「一点」抢走「一点点」。
// 故意不收「不多」：它会命中「差不多」这类无关词。
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

function isFuzzy(text) {
    return FUZZY.indexOf(String(text == null ? '' : text).trim()) >= 0;
}

function kindOf(text) {
    const raw = String(text == null ? '' : text).trim();
    if (isFuzzy(raw)) return 'fuzzy';
    return raw ? 'exact' : 'none';
}

// 把「许多」「一点点」这类口语收敛成标准档位；带数值的描述不当模糊量。
function canonical(text) {
    const raw = String(text == null ? '' : text).trim().slice(0, 12);
    if (!raw) return '';
    const cleaned = raw.replace(/[的啊吧呢哦呀了~～。！!\s]/g, '');
    return ALIAS_MAP[cleaned] || '';
}

// 在一句话里找模糊量，返回 { value, word }：word 供拆解时把口语词从食材名里剔掉。
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

// 录入表单统一出口：一个模式只产出一个值，四种写法互不叠加。
// 也接受「很多 / 少量」这样的字面值，方便 AI 结果与历史行直接回显。
function build(mode, qty, unit) {
    const key = String(mode == null ? '' : mode).trim();
    if (key === 'many' || key === '很多') return '很多';
    if (key === 'little' || key === '少量') return '少量';
    if (key === 'none') return '';
    return join(qty, unit);
}

// 从已存的描述串反推模式，用于历史行回显与识别结果的初始状态。
function modeOf(text) {
    const raw = String(text == null ? '' : text).trim();
    if (raw === '很多') return 'many';
    if (raw === '少量') return 'little';
    if (!raw) return 'none';
    return 'exact';
}

function modeMeta(key) {
    return MODES.filter(function (item) { return item.key === key; })[0] || MODES[0];
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
};
