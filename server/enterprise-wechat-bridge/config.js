/**
 * 企业微信桥接服务 - 配置文件
 * 
 * 填写你的企业微信参数
 */

export default {
  // 企业微信参数 (从企业微信后台获取)
  wechat: {
    corpId: 'ww8f33691e51c64b1e',           // 企业ID
    agentId: '1000004',                      // 应用AgentId
    secret: 'OrJHmQBaYaiT_dyps5LWogk5J-i8DA3TNY6FSOSeQk0', // 应用Secret
    token: 'jasmine-wechat-token-2026',      // 回调Token (与后台一致)
    // encodingAesKey: '',                    // 消息加密密钥 (可选)
  },

  // 服务配置
  server: {
    port: 3003,
    host: '0.0.0.0',                        // 监听所有网卡
    env: process.env.NODE_ENV || 'development',
  },

  // 消息队列配置
  queue: {
    filePath: './message-queue.json',        // 消息存储文件
    pollInterval: 5000,                      // 轮询间隔(ms)
    responseTimeout: 60000,                  // 响应超时(ms)
  },

  // 日志配置
  log: {
    file: './wechat-bridge.log',
    level: 'info',
  },

  // 调试模式
  debug: true,
}
