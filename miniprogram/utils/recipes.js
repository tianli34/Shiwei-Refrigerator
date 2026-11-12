// 内置菜谱库：离线即可做食材反向匹配；云端 recipes 表用于保存 AI 生成的创意菜。
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
];

function normalizeName(value) {
    return String(value || '').replace(/[\s（）()【】\[\]]/g, '').toLowerCase();
}

function hasIngredient(ownedNames, needed) {
    const target = normalizeName(needed);
    if (!target) return true;
    return ownedNames.some(function (owned) {
        const name = normalizeName(owned);
        if (!name) return false;
        return name === target || name.indexOf(target) >= 0 || target.indexOf(name) >= 0;
    });
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

// 反向匹配：按用户勾选的食材，分出「立即可做」与「只差 1 样」。
function match(selectedNames, cloudRows) {
    const owned = (selectedNames || []).map(normalizeName).filter(Boolean);
    const ready = [];
    const missingOne = [];
    for (const recipe of allRecipes(cloudRows)) {
        const needed = recipe.mainItems || [];
        if (needed.length === 0) continue;
        const matched = needed.filter(function (item) { return hasIngredient(owned, item); });
        const missing = needed.filter(function (item) { return !hasIngredient(owned, item); });
        const item = Object.assign({}, recipe, {
            matched: matched.length,
            missing: missing,
            missingText: missing.join('、'),
            matchedText: matched.join(' + '),
            totalNeeded: needed.length,
        });
        if (missing.length === 0 && matched.length >= 1) ready.push(item);
        else if (missing.length === 1 && matched.length >= 1) missingOne.push(item);
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
    const hit = require('./util').COMMON_FOODS.find(function (f) {
        return normalizeName(f.name).indexOf(normalizeName(name)) >= 0 || normalizeName(name).indexOf(normalizeName(f.name)) >= 0;
    });
    return hit ? hit.emoji : '🥣';
}

function shelfDaysFor(name, fallback) {
    const hit = require('./util').COMMON_FOODS.find(function (f) {
        return normalizeName(f.name).indexOf(normalizeName(name)) >= 0 || normalizeName(name).indexOf(normalizeName(f.name)) >= 0;
    });
    return hit ? hit.shelfDays : (fallback || 3);
}

module.exports = { BUILTIN: BUILTIN, cloudRecipeItems: cloudRecipeItems, allRecipes: allRecipes, match: match, emojiFor: emojiFor, shelfDaysFor: shelfDaysFor, hasIngredient: hasIngredient };
