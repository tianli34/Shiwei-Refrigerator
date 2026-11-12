// AI 能力：自然语言极速录入、小票识别、奇葩组合创意菜。模型目录运行时获取，不硬编码模型 ID。
const { cloud } = require('./cloud');
const { COMMON_FOODS } = require('./util');

const SYSTEM_CHEF = '你是「拾味冰箱」的创意厨师。用户会给你冰箱里剩下的食材，你要给出一道「黑暗但合理」、真的能下咽的创意菜。只输出一个 JSON 对象，不要 markdown 代码块，字段：name(菜名), emoji(一个表情), minutes(整数分钟), difficulty(简单/中等/挑战), tags(字符串数组), extra(还需要额外买的食材名数组，没有就空数组), steps(字符串数组，3-5 步，每步不超过 40 字), punchline(一句俏皮点评，不超过 30 字)。不要输出 JSON 以外的任何内容。';
const SYSTEM_PARSER = '你是「拾味冰箱」的食材录入助手。把用户描述的一句话拆成食材清单，只输出 JSON 数组，不要 markdown 代码块。每项字段：name(食材名), quantity(数量描述，如 两斤/一盒，没有就空串), shelf_days(整数保质期天数), zone(只能是 cold/freeze/room)。从「保质期N天」「放N天」等描述里提取天数。不要输出 JSON 以外的任何内容。';
const SYSTEM_RECEIPT = '你是「拾味冰箱」的小票识别助手。读取超市小票照片，挑出可食用的生鲜和食品（忽略日用品、购物袋、金额和条码），只输出 JSON 数组，不要 markdown 代码块。每项字段：name(食材名), quantity(数量描述), shelf_days(整数，按常识估计), zone(只能是 cold/freeze/room)。看不清就输出空数组 []。不要输出 JSON 以外的任何内容。';

async function pickModel(preferImage) {
    let models;
    try {
        models = await cloud.llm.models.list();
    } catch (error) {
        return null;
    }
    const list = Array.isArray(models) ? models : [];
    const usable = list.filter(function (item) {
        return item && item.id && item.enabled !== false && item.disabled !== true && !/image|video|tts|audio/i.test(item.id);
    });
    if (usable.length === 0) return null;
    if (preferImage) {
        const withImage = usable.filter(function (item) { return item.supportsImages === true; });
        return withImage.length ? withImage[0] : null;
    }
    const defaultModel = usable.filter(function (item) { return item.isDefault === true; })[0];
    return defaultModel || usable[0];
}

function extractJson(text) {
    const raw = String(text || '').trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fence ? fence[1].trim() : raw;
    const start = body.search(/[\[{]/);
    if (start < 0) return null;
    const open = body.charAt(start);
    const close = open === '[' ? ']' : '}';
    const end = body.lastIndexOf(close);
    if (end <= start) return null;
    try {
        return JSON.parse(body.slice(start, end + 1));
    } catch (error) {
        return null;
    }
}

async function stream(messages, onDelta) {
    const model = await pickModel(false);
    if (!model) throw new Error('暂时没有可用的 AI 模型，请稍后再试');
    let text = '';
    const iterator = await cloud.llm.chat.completions.create({
        model: model.id,
        messages: messages,
        stream: true,
    });
    for await (const chunk of iterator) {
        const choice = chunk && chunk.choices && chunk.choices[0];
        const delta = choice && choice.delta;
        if (delta && delta.content) {
            text += delta.content;
            if (onDelta) onDelta(delta.content);
        }
    }
    return text;
}

// 小票走多模态：content 为 OpenAI 兼容的图文数组。
async function streamWithImage(base64, mime, prompt) {
    const model = await pickModel(true);
    if (!model) throw new Error('当前没有支持图片识别的模型，请手动录入');
    const dataUrl = 'data:' + (mime || 'image/jpeg') + ';base64,' + base64;
    let text = '';
    const iterator = await cloud.llm.chat.completions.create({
        model: model.id,
        messages: [
            { role: 'system', content: SYSTEM_RECEIPT },
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: dataUrl } },
                ],
            },
        ],
        stream: true,
    });
    for await (const chunk of iterator) {
        const choice = chunk && chunk.choices && chunk.choices[0];
        const delta = choice && choice.delta;
        if (delta && delta.content) text += delta.content;
    }
    return text;
}

function normalizeFoods(parsed) {
    const list = Array.isArray(parsed) ? parsed : [];
    return list.filter(function (item) {
        return item && typeof item.name === 'string' && item.name.trim();
    }).slice(0, 12).map(function (item) {
        const known = COMMON_FOODS.filter(function (food) {
            return food.name.indexOf(item.name) >= 0 || String(item.name).indexOf(food.name) >= 0;
        })[0];
        const zone = ['cold', 'freeze', 'room'].indexOf(item.zone) >= 0 ? item.zone : (known ? known.zone : 'cold');
        const days = Number(item.shelf_days) > 0 ? Math.min(365, Math.round(Number(item.shelf_days))) : (known ? known.shelfDays : 3);
        return {
            name: String(item.name).trim().slice(0, 16),
            emoji: known ? known.emoji : '🥣',
            zone: zone,
            quantity: String(item.quantity || '').slice(0, 12),
            shelf_days: days,
        };
    });
}

// 离线兜底：AI 不可用时也能把「买了两斤排骨保质期3天」拆成食材。
function fallbackParse(text) {
    const raw = String(text || '');
    const dayMatch = raw.match(/(?:保质期|放|能放|可放)\s*(\d+)\s*天/);
    const days = dayMatch ? Number(dayMatch[1]) : 0;
    const chunks = raw.split(/[，,、;；\s]+买[了]?/).join('，').split(/[，,、;；。\s]+/);
    const out = [];
    for (const chunk of chunks) {
        const clean = chunk.replace(/^买[了]?/, '').replace(/(保质期|放|能放|可放)\s*\d+\s*天/g, '').trim();
        if (!clean) continue;
        const known = COMMON_FOODS.filter(function (food) {
            return clean.indexOf(food.name) >= 0;
        })[0];
        const name = known ? known.name : clean.replace(/[两一二三四五六七八九十\d]+(斤|个|盒|袋|根|只|把|瓶)/g, '').slice(0, 12);
        if (!name) continue;
        out.push({
            name: name,
            emoji: known ? known.emoji : '🥣',
            zone: known ? known.zone : 'cold',
            quantity: (clean.match(/[两一二三四五六七八九十\d]+(斤|个|盒|袋|根|只|把|瓶)/) || [''])[0],
            shelf_days: days || (known ? known.shelfDays : 3),
        });
    }
    return out.slice(0, 12);
}

async function parseFoodsFromText(text, onDelta) {
    const answer = await stream([
        { role: 'system', content: SYSTEM_PARSER },
        { role: 'user', content: String(text || '').slice(0, 200) },
    ], onDelta);
    const parsed = extractJson(answer);
    const items = normalizeFoods(parsed);
    return items.length ? items : fallbackParse(text);
}

async function parseReceipt(base64, mime) {
    const answer = await streamWithImage(base64, mime, '请识别这张小票上的食材并输出 JSON 数组。');
    return normalizeFoods(extractJson(answer));
}

async function creativeRecipe(names, onDelta) {
    const answer = await stream([
        { role: 'system', content: SYSTEM_CHEF },
        { role: 'user', content: '我冰箱里只剩：' + (names || []).join('、') + '。给我一道能真正做出来、又有点离谱的创意菜，并说明还差什么。' },
    ], onDelta);
    const parsed = extractJson(answer);
    if (!parsed || !parsed.name) throw new Error('AI 这次没给出完整菜谱，再试一次吧');
    return {
        name: String(parsed.name).slice(0, 20),
        emoji: parsed.emoji || '✨',
        minutes: Number(parsed.minutes) > 0 ? Number(parsed.minutes) : 20,
        difficulty: parsed.difficulty || '挑战',
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 3) : ['AI 创意'],
        extra: Array.isArray(parsed.extra) ? parsed.extra.slice(0, 3) : [],
        steps: Array.isArray(parsed.steps) ? parsed.steps.slice(0, 5) : [],
        punchline: parsed.punchline || '冰箱的尽头，是想象力。',
        ai: true,
    };
}

module.exports = {
    pickModel: pickModel,
    parseFoodsFromText: parseFoodsFromText,
    parseReceipt: parseReceipt,
    creativeRecipe: creativeRecipe,
    fallbackParse: fallbackParse,
    extractJson: extractJson,
};
