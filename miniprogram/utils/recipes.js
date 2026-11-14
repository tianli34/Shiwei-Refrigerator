// 内置菜谱库：离线即可做食材反向匹配；云端 recipes 表用于保存 AI 生成的创意菜。
const dict = require('./food-dict');
const foodNames = require('./food-names');
const BUILTIN = [
    { id: 'b1', name: '土豆鸡肉焖饭', emoji: '🍚', mainItems: ['土豆', '鸡胸肉', '米饭'], seasonings: ['生抽', '盐'], minutes: 35, difficulty: '简单', tags: ['一锅端', '剩饭救星'], steps: ['土豆切小块，鸡胸肉切丁用少许生抽抓匀', '米洗净放入电饭煲，加平常水量', '铺上土豆和鸡肉，按下煮饭键', '出锅拌匀，撒一点葱花更香'] },
    { id: 'b2', name: '番茄炒蛋', emoji: '🍅', mainItems: ['番茄', '鸡蛋'], seasonings: ['糖', '盐'], minutes: 10, difficulty: '简单', tags: ['快手', '下饭'], steps: ['鸡蛋打散炒至凝固盛出', '番茄切块炒出汁，加少许糖', '倒回鸡蛋翻匀，加盐出锅'] },
    { id: 'b3', name: '青椒土豆丝', emoji: '🥔', mainItems: ['土豆', '青椒'], seasonings: ['醋', '盐'], minutes: 15, difficulty: '简单', tags: ['快手', '素菜'], steps: ['土豆切细丝泡水去淀粉', '热油下青椒丝爆香', '下土豆丝大火快炒，沿锅边淋醋'] },
    { id: 'b4', name: '蒜蓉西兰花', emoji: '🥦', mainItems: ['西兰花', '大蒜'], seasonings: ['盐', '蚝油'], minutes: 10, difficulty: '简单', tags: ['轻食'], steps: ['西兰花掰小朵焯水 1 分钟', '蒜末爆香后下西兰花', '加蚝油和少许盐翻匀'] },
    { id: 'b5', name: '牛奶燕麦粥', emoji: '🥛', mainItems: ['牛奶', '燕麦'], seasonings: [], minutes: 8, difficulty: '简单', tags: ['早餐', '消灭临期牛奶'], steps: ['牛奶小火加热至微沸', '倒入燕麦搅煮 3 分钟', '喜欢的话加一点香蕉片'] },
    { id: 'b6', name: '香蕉牛奶昔', emoji: '🍌', mainItems: ['香蕉', '牛奶'], seasonings: [], minutes: 5, difficulty: '简单', tags: ['饮品', '消灭临期牛奶'], steps: ['香蕉掰段放入杯中', '倒入牛奶', '用料理棒打匀即可'] },
    { id: 'b7', name: '蛋炒饭', emoji: '🍳', mainItems: ['米饭', '鸡蛋'], seasonings: ['盐', '葱'], minutes: 12, difficulty: '简单', tags: ['剩饭救星'], steps: ['隔夜饭抓散', '蛋液炒散后下米饭压散', '大火翻炒到粒粒分明，加盐和葱花'] },
    { id: 'b8', name: '红烧排骨', emoji: '🍖', mainItems: ['排骨', '姜'], seasonings: ['生抽', '冰糖'], minutes: 45, difficulty: '中等', tags: ['硬菜'], steps: ['排骨冷水下锅焯去血沫', '冰糖炒糖色后下排骨裹匀', '加生抽、姜片和热水，小火炖 35 分钟收汁'] },
    { id: 'b9', name: '冬瓜排骨汤', emoji: '🍲', mainItems: ['冬瓜', '排骨'], seasonings: ['盐', '姜'], minutes: 50, difficulty: '简单', tags: ['汤'], steps: ['排骨焯水后加姜片炖 30 分钟', '下冬瓜块再煮 15 分钟', '加盐调味，撒葱花'] },
    { id: 'b10', name: '香菇滑鸡饭', emoji: '🍄', mainItems: ['香菇', '鸡胸肉', '米饭'], seasonings: ['生抽', '淀粉'], minutes: 30, difficulty: '中等', tags: ['一锅端'], steps: ['鸡肉用生抽淀粉腌 10 分钟', '香菇切片铺在米上', '一起蒸熟后淋少许生抽拌匀'] },
    { id: 'b11', name: '洋葱炒牛肉', emoji: '🧅', mainItems: ['洋葱', '牛肉'], seasonings: ['生抽', '黑胡椒'], minutes: 18, difficulty: '简单', tags: ['下饭'], steps: ['牛肉逆纹切片用生抽抓匀', '大火快炒牛肉至变色盛出', '洋葱炒软后回锅，撒黑胡椒'] },
    { id: 'b12', name: '胡萝卜炒鸡蛋', emoji: '🥕', mainItems: ['胡萝卜', '鸡蛋'], seasonings: ['盐'], minutes: 12, difficulty: '简单', tags: ['快手'], steps: ['胡萝卜切细丝', '鸡蛋炒散盛出', '胡萝卜炒软后合炒，加盐'] },
    { id: 'b13', name: '元气三明治', emoji: '🥪', mainItems: ['面包', '鸡蛋', '青菜'], seasonings: ['沙拉酱'], minutes: 10, difficulty: '简单', tags: ['早餐'], steps: ['煎一个溏心蛋', '面包夹层铺青菜和鸡蛋', '对角切开，配一杯牛奶'] },
    { id: 'b14', name: '酸奶水果杯', emoji: '🍓', mainItems: ['酸奶', '香蕉'], seasonings: [], minutes: 5, difficulty: '简单', tags: ['甜品'], steps: ['香蕉切片', '杯中一层酸奶一层香蕉', '撒点燕麦或坚果碎'] },
    { id: 'b15', name: '咖喱土豆鸡', emoji: '🍛', mainItems: ['土豆', '鸡胸肉', '胡萝卜'], seasonings: ['咖喱块'], minutes: 30, difficulty: '中等', tags: ['一锅端', '下饭'], steps: ['鸡肉和蔬菜切块', '全部下锅翻炒后加水没过食材', '煮 15 分钟后下咖喱块化开，收浓'] },
    { id: 'b16', name: '蒜香意面', emoji: '🍝', mainItems: ['意面', '大蒜', '洋葱'], seasonings: ['橄榄油', '黑胡椒'], minutes: 20, difficulty: '简单', tags: ['快手'], steps: ['意面煮到弹牙，留半碗面汤', '蒜末洋葱小火炒香', '下面条和面汤翻匀，撒黑胡椒'] },
    { id: 'b17', name: '鸡蛋番茄汤', emoji: '🥣', mainItems: ['鸡蛋', '番茄'], seasonings: ['盐', '香油'], minutes: 10, difficulty: '简单', tags: ['汤', '快手'], steps: ['番茄炒出汁后加两碗水', '水开后淋入蛋液', '关火加盐和几滴香油'] },
    { id: 'b18', name: '清炒时蔬', emoji: '🥬', mainItems: ['青菜', '大蒜'], seasonings: ['盐'], minutes: 8, difficulty: '简单', tags: ['快手', '素菜'], steps: ['蒜片爆香', '下青菜大火翻炒', '变软后加盐立刻出锅'] },
    { id: 'b19', name: '豆腐味噌汤', emoji: '🍜', mainItems: ['豆腐', '海带'], seasonings: ['味噌'], minutes: 15, difficulty: '简单', tags: ['汤'], steps: ['海带煮出鲜味', '下豆腐块小火煮 5 分钟', '关火后化开味噌，别煮沸'] },
    { id: 'b20', name: '蜂蜜柠檬水', emoji: '🍋', mainItems: ['柠檬', '蜂蜜'], seasonings: [], minutes: 5, difficulty: '简单', tags: ['饮品'], steps: ['柠檬切片去籽', '温水冲泡后加蜂蜜', '搅匀，别用滚水'] },
    { id: 'b21', name: '芝士烤吐司', emoji: '🧀', mainItems: ['面包', '奶酪'], seasonings: [], minutes: 12, difficulty: '简单', tags: ['早餐'], steps: ['面包上铺奶酪片', '空气炸锅 180℃ 烤 6 分钟', '表面微焦最香'] },
    { id: 'b22', name: '酸辣白菜', emoji: '🌶️', mainItems: ['白菜', '辣椒'], seasonings: ['醋', '糖'], minutes: 12, difficulty: '简单', tags: ['下饭'], steps: ['白菜帮斜切片', '干辣椒爆香后下白菜大火炒', '沿锅边淋醋，加少许糖'] },
    { id: 'b23', name: '紫菜蛋花汤', emoji: '🍥', mainItems: ['紫菜', '鸡蛋'], seasonings: ['盐', '香油'], minutes: 8, difficulty: '简单', tags: ['汤', '快手'], steps: ['水开后放紫菜', '淋蛋液画圈', '加盐和香油关火'] },
    { id: 'b24', name: '土豆炖牛肉', emoji: '🥩', mainItems: ['土豆', '牛肉'], seasonings: ['生抽', '姜'], minutes: 55, difficulty: '中等', tags: ['硬菜'], steps: ['牛肉焯水后加姜炖 35 分钟', '下土豆块再炖 15 分钟', '加生抽调味收汁'] },
    // 这两道是父子级食材的样板：回锅肉只要「猪肉」，五花肉/里脊肉都能上；
    // 红烧肉点名「五花肉」，只有里脊肉时不能算能做，要提示部位不对。
    { id: 'b25', name: '回锅肉', emoji: '🥓', mainItems: ['猪肉', '青椒'], seasonings: ['豆瓣酱', '生抽'], minutes: 25, difficulty: '中等', tags: ['下饭', '硬菜'], steps: ['猪肉整块煮到七分熟，晾凉切薄片', '下锅煸到微微卷边出油', '加豆瓣酱炒出红油，下青椒断生'] },
    { id: 'b26', name: '红烧肉', emoji: '🍖', mainItems: ['五花肉', '姜'], seasonings: ['冰糖', '生抽', '料酒'], minutes: 70, difficulty: '中等', tags: ['硬菜', '解馋'], steps: ['五花肉切麻将块，冷水下锅焯水', '冰糖炒出糖色，下肉块裹匀', '加姜、生抽、料酒和热水，小火炖 50 分钟收汁'] },
];

function normalizeName(value) {
    return String(value || '').replace(/[\s（）()【】\[\]]/g, '').toLowerCase();
}

// 食材身份一律用 food_id 比较；中文名只负责显示，不再参与相等判断。
// 兼容三种入参：已有 food_id、词表里的任意叫法、历史数据里的自由文本。
function toFoodId(value) {
    if (!value) return '';
    const raw = String(value);
    if (dict.BY_ID[raw]) return raw;
    if (dict.isCustom(raw)) {
        // 词表补了新实体后（例如「豆腐」），历史行还停在 custom:豆腐。
        // 只认精确主名升级，不做模糊猜测，免得把自定义食材硬塞进别的身份。
        return dict.BY_CANONICAL[dict.customLabel(raw)] || raw;
    }
    return dict.resolveId(raw) || ('custom:' + dict.clean(raw));
}

// 库存对单一样用料的命中程度：exact / subtype / sibling / supertype / none。
// 一样菜最多被一样库存代表，取其中最精确的那条关系（五花肉优先于猪肉）。
const RELATION_RANK = { exact: 3, subtype: 2, supertype: 1, sibling: 1, none: 0 };

function relationOf(ownedIds, neededId) {
    let best = 'none';
    (ownedIds || []).forEach(function (owned) {
        const kind = dict.relation(owned, neededId);
        if (RELATION_RANK[kind] > RELATION_RANK[best]) best = kind;
    });
    return best;
}

// 真正顶上去的那样子类库存：菜谱要猪肉、冰箱里是五花肉，就返回五花肉。
function standInFor(ownedIds, neededId) {
    return (ownedIds || []).filter(function (owned) {
        return dict.relation(owned, neededId) === 'subtype';
    })[0] || '';
}

// 用料 vs 库存的解释层：谁命中、谁缺、谁在「拿别的东西顶」、谁「够不上」。
// 所有页面（炼金术 / 收藏 / 点菜板）都从这里拿结论，避免各写一套判定。
function explain(ownedIds, neededNames, ctx) {
    const labelCtx = ctx || foodNames.CTX_INTERNAL;
    const owned = (ownedIds || []).map(toFoodId).filter(Boolean);
    const matched = [];
    const used = [];
    const missing = [];
    const substitutes = [];
    const hints = [];

    (neededNames || []).forEach(function (item) {
        if (!item) return;
        const neededId = toFoodId(item);
        const kind = relationOf(owned, neededId);
        if (kind === 'exact') {
            matched.push(item);
            used.push(neededId);
            return;
        }
        if (kind === 'subtype') {
            const stand = standInFor(owned, neededId);
            matched.push(item);
            used.push(stand || neededId);
            substitutes.push({
                needed: item,
                neededId: neededId,
                used: stand || neededId,
                neededText: foodNames.labelOf(neededId, labelCtx),
                usedText: foodNames.labelOf(stand || neededId, labelCtx),
            });
            return;
        }
        missing.push(item);
        // 顶不上但说得清原因：要么库存更宽泛（只有猪肉），要么是别的部位（只有里脊肉）。
        // 两种情况都值得提示一句「这道菜到底要什么」。
        if (kind === 'supertype' || kind === 'sibling') {
            const broad = owned.filter(function (one) {
                const oneKind = dict.relation(one, neededId);
                return oneKind === 'supertype' || oneKind === 'sibling';
            })[0] || '';
            hints.push({
                needed: item,
                neededId: neededId,
                have: broad,
                neededText: foodNames.labelOf(neededId, labelCtx),
                haveText: foodNames.labelOf(broad, labelCtx),
            });
        }
    });

    // 「用到」只报实际下锅的东西：菜谱要猪肉、冰箱里是五花肉，就写五花肉。
    const seen = {};
    const usedUnique = used.filter(function (id) {
        if (seen[id]) return false;
        seen[id] = true;
        return true;
    });

    return {
        matched: matched,
        missing: missing,
        used: usedUnique,
        substitutes: substitutes,
        hints: hints,
        matchedText: foodNames.joinLabels(usedUnique, labelCtx, ' + '),
        missingText: foodNames.joinLabels(missing, labelCtx),
        // 「五花肉 代 猪肉」：能直接做，但得让人知道是拿别的部位顶的。
        approxText: substitutes.map(function (item) {
            return item.usedText + ' 代 ' + item.neededText;
        }).join('；'),
        // 「只有猪里脊，这道菜要五花肉」：做不成，且原因不是「没买肉」而是「部位不对」。
        hintText: hints.map(function (item) {
            return '只有' + item.haveText + '，这道菜要' + item.neededText;
        }).join('；'),
    };
}

function hasIngredient(ownedNames, needed) {
    const target = toFoodId(needed);
    if (!target) return true;
    const kind = relationOf((ownedNames || []).map(toFoodId).filter(Boolean), target);
    return kind === 'exact' || kind === 'subtype';
}

// 云端 recipes 行的用料归一化。早期 AI 菜谱曾把「还需买的食材」(extra) 写进
// seasonings，这里统一纠正为「用料 = 主料 + 需补货」，调料留空，兼容历史数据。
function cloudRecipeItems(row) {
    const source = row || {};
    const mainItems = (Array.isArray(source.main_items) ? source.main_items : []).filter(Boolean);
    const seasonings = (Array.isArray(source.seasonings) ? source.seasonings : []).filter(Boolean);
    if (source.source !== 'ai' || !seasonings.length) {
        return { mainItems: mainItems, seasonings: seasonings };
    }
    const merged = mainItems.slice();
    seasonings.forEach(function (name) {
        if (merged.indexOf(name) < 0) merged.push(name);
    });
    return { mainItems: merged, seasonings: [] };
}

// 把云端 recipes 行融合进匹配池（AI 生成的菜谱也能被再次匹配到）。
function allRecipes(cloudRows) {
    const extra = (cloudRows || []).map(function (row) {
        const items = cloudRecipeItems(row);
        return {
            id: 'c' + row.id,
            name: row.name,
            emoji: row.emoji || '✨',
            mainItems: items.mainItems,
            seasonings: items.seasonings,
            minutes: row.minutes || 20,
            difficulty: row.difficulty || '有趣',
            tags: Array.isArray(row.tags) ? row.tags : ['AI 创意'],
            steps: Array.isArray(row.steps) ? row.steps : [],
            ai: true,
        };
    });
    return BUILTIN.concat(extra);
}

// 统一菜谱身份：合池里的 'b1'/'c12' 原样返回；收藏页和云端裸行的数字 id 补 'c' 前缀，
// 与 allRecipes() 以及 menu_shares 快照里的键对齐。两条路径只在这里分叉。
function recipeKey(item) {
    const id = String((item && item.id) || '');
    if (/^\d+$/.test(id)) return 'c' + id;
    return id;
}

// 把次数贴到一批菜谱上：返回新对象，绝不改动 BUILTIN 常量；缺失/NaN/负数一律兜底为 0。
// 计数是渲染前才装配的展示态，不进匹配池、不进点菜板快照。
function attachCookCounts(list, countMap) {
    const map = countMap || {};
    return (list || []).map(function (item) {
        const n = Number(map[recipeKey(item)]);
        return Object.assign({}, item, { cookCount: Number.isFinite(n) && n > 0 ? n : 0 });
    });
}

// 反向匹配：按用户勾选的食材，分出「立即可做」与「只差 1 样」。
// ctx 决定食材名用谁的叫法展示；分享给外部好友时传 external，强制通用主名。
function match(selectedNames, cloudRows, ctx) {
    const labelCtx = ctx || foodNames.CTX_INTERNAL;
    const owned = (selectedNames || []).map(toFoodId).filter(Boolean);
    const ready = [];
    const missingOne = [];
    for (const recipe of allRecipes(cloudRows)) {
        const needed = recipe.mainItems || [];
        if (needed.length === 0) continue;
        const info = explain(owned, needed, labelCtx);
        const item = Object.assign({}, recipe, {
            matched: info.matched.length,
            missing: info.missing,
            // 展示名不能直接当身份传给买菜篮，另存原始名供 data-* 传参。
            missingRaw: info.missing.join('|'),
            missingIds: info.missing.map(toFoodId),
            missingText: info.missingText,
            matchedText: info.matchedText,
            substitutes: info.substitutes,
            approxText: info.approxText,
            hints: info.hints,
            hintText: info.hintText,
            totalNeeded: needed.length,
        });
        if (info.missing.length === 0 && info.matched.length >= 1) {
            ready.push(item);
        } else if (info.missing.length === 1 && (info.matched.length >= 1 || info.hints.length > 0)) {
            // 只差一样就够得着。就算一样都没命中，只要是「部位不对」这种能解释清楚的
            // 缺口，也放进来提示一句 —— 比默默不出现更有用。
            missingOne.push(item);
        }
    }
    const byScore = function (a, b) {
        if (b.matched !== a.matched) return b.matched - a.matched;
        return a.minutes - b.minutes;
    };
    ready.sort(byScore);
    missingOne.sort(byScore);
    return { ready: ready, missingOne: missingOne };
}

function emojiFor(name) {
    return dict.meta(toFoodId(name)).emoji;
}

function shelfDaysFor(name, fallback) {
    const info = dict.meta(toFoodId(name));
    return info.known ? info.shelfDays : (fallback || 3);
}

module.exports = {
    BUILTIN: BUILTIN,
    cloudRecipeItems: cloudRecipeItems,
    allRecipes: allRecipes,
    match: match,
    explain: explain,
    relationOf: relationOf,
    emojiFor: emojiFor,
    shelfDaysFor: shelfDaysFor,
    hasIngredient: hasIngredient,
    toFoodId: toFoodId,
    recipeKey: recipeKey,
    attachCookCounts: attachCookCounts,
};
