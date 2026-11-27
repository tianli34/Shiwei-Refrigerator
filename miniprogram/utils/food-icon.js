// 食材图标：一张图代表一类「模具」，同形态的食材共用同一张图。
// 图标以 data URI 内联在 styles/food-icons.wxss 里，这里只返回样式类名，
// 不依赖任何静态文件部署与路径解析（WorkBuddy 更新链路加载不到新增资源）。
// 未覆盖的食材返回空串，由页面回退到文字 emoji。

// 模具 -> 食材 id（food-dict.data.js 里的稳定身份）
const MOLDS = [
    { icon: '01_donggua', ids: ['f008'] },                                         // 冬瓜
    { icon: '02_kugua', ids: ['f010'] },                                           // 苦瓜
    { icon: '03_foshougua', ids: ['f013'] },                                       // 佛手瓜
    { icon: '04_qiukui', ids: ['f014'] },                                          // 秋葵
    { icon: '05_changgua', ids: ['f009', 'f011', 'f012'] },                        // 丝瓜 / 西葫芦 / 瓠子
    { icon: '06_baocai', ids: ['f019', 'f020'] },                                  // 卷心菜 / 紫甘蓝
    { icon: '07_qincai', ids: ['f029', 'f030'] },                                  // 芹菜 / 西芹
    { icon: '08_jiucai', ids: ['f031', 'f032', 'f034'] },                          // 韭菜 / 韭黄 / 蒜苗
    { icon: '09_huagun', ids: ['f033', 'f035'] },                                  // 韭菜花 / 蒜薹
    { icon: '10_caixin', ids: ['f018', 'f037'] },                                  // 菜心 / 芥蓝
    { icon: '11_juchiye', ids: ['f028', 'f042', 'f044', 'f045'] },                 // 茼蒿 / 荠菜 / 蒲公英 / 苦菊
    { icon: '12_nenshao', ids: ['f023', 'f026', 'f039', 'f040', 'f046', 'f050'] }, // 菠菜 / 空心菜 / 木耳菜 / 红薯叶 / 西洋菜 / 豌豆苗
    { icon: '13_dayeqingcai', ids: ['f015', 'f016', 'f017', 'f024', 'f025', 'f038'] }, // 大白菜 / 小白菜 / 上海青 / 生菜 / 油麦菜 / 芥菜
    { icon: '14_xiancai', ids: ['f027'] },                                         // 苋菜
    { icon: '15_xiangchun', ids: ['f036', 'f041'] },                               // 香椿 / 红菜苔
    { icon: '16_mazhixian', ids: ['f043'] },                                       // 马齿苋
];

const BY_ID = {};
MOLDS.forEach(function (mold) {
    mold.ids.forEach(function (id) { BY_ID[id] = 'icon-' + mold.icon; });
});

function iconOf(foodId) {
    if (!foodId) return '';
    return BY_ID[foodId] || '';
}

module.exports = {
    MOLDS: MOLDS,
    iconOf: iconOf,
};