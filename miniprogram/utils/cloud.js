// 唯一云客户端实例。配置来自云服务开通时返回的 publicConfig，前端只持有公开信息。
const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics');

const publicConfig = {
    endpoint: 'https://mp-api.app.workbuddy.host',
    publishableKey: 'wbpk_BUSZh0lYqyXgKIACRK5Cjo_q7hqhWTvqKERyPq1hf92fZEiImnjya87',
};

const cloud = createMiniProgramWorkBuddyCloud({
    endpoint: publicConfig.endpoint,
    publishableKey: publicConfig.publishableKey,
    wx: createDiagnosticWx(wx),
});

module.exports = { cloud, publicConfig };
