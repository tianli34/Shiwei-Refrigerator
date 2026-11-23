// 社交版构建配置（企业主体）。
// appid 等企业主体注册下来再填；占位值不符合真实 AppID 时构建脚本只给 WARN，
// 因为本地联调需要能先跑出 dist/social。
module.exports = {
    version: 'social',
    label: '社交版',
    // 占位：企业主体小程序注册后替换成真实 AppID
    appid: 'wx0000000000000000',
    social: true,
};
