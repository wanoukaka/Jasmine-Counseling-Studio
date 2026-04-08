# 企业微信消息转发桥接服务

> 玩偶卡卡出品 🐻 | 2026-04-05

---

## 功能说明

连接企业微信和卡卡，实现自动回复

```
客户(企业微信)
    ↓ 发送消息
企业微信服务器
    ↓ HTTP POST
桥接服务 (本项目)
    ↓ 存储消息
消息队列 (JSON文件)
    ↓
卡卡处理 (轮询)
    ↓ 写入回复
消息队列
    ↓
桥接服务
    ↓ HTTP POST
企业微信服务器
    ↓
客户收到回复
```

---

## 文件结构

```
enterprise-wechat-bridge/
├── README.md           # 本文件
├── server.js           # 主服务
├── config.js           # 配置
├── message-queue.js    # 消息队列
├── echoWeChatAPI.js    # 企业微信API工具
└── .env.example        # 环境变量示例
```

---

## 环境要求

- Node.js 18+
- 公网服务器（腾讯云，周二部署）
- 企业微信应用

---

## 配置步骤

### 1. 企业微信后台配置

1. 打开 https://work.weixin.qq.com/
2. 进入「应用管理」
3. 点击自建应用（卡卡客服）
4. 找到「接收消息」部分
5. 点击「设置API接收」
6. 填写：
   - URL: `https://你的域名/api/wechat/receive`
   - Token: `填写config.js里的TOKEN`
   - EncodingAESKey: 可不填（选择明文模式）

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填写配置
```

### 4. 启动服务

```bash
# 开发环境
npm run dev

# 生产环境
npm start
```

### 5. 使用PM2守护进程

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## API接口

### 接收消息
```
POST /api/wechat/receive
```

企业微信服务器会推送消息到这个接口

### 查询待处理消息
```
GET /api/messages/pending
```

卡卡轮询这个接口获取新消息

### 提交回复
```
POST /api/messages/:messageId/response
```

卡卡处理完成后提交回复

### 健康检查
```
GET /health
```

---

## 消息格式

### 传入消息 (企业微信)

```json
{
  "ToUserName": "ww8f33691e51c64b1e",
  "FromUserName": "xxxx",
  "CreateTime": "1234567890",
  "MsgType": "text",
  "Content": "我想咨询",
  "MsgId": "1234567890123456"
}
```

### 回复格式

```json
{
  "code": 0,
  "message": "好的，请问您想了解什么服务？"
}
```

---

## 与卡卡连接

卡卡会每10秒轮询 `/api/messages/pending`

收到新消息后：
1. 卡卡分析消息内容
2. 生成回复
3. 调用 `/api/messages/:messageId/response` 提交回复
4. 桥接服务自动发送给客户

---

## 故障排除

### 企业微信提示"连接失败"

1. 检查服务器是否启动：`curl http://localhost:3003/health`
2. 检查公网是否可达
3. 检查Token配置是否一致
4. 检查防火墙/安全组是否开放3003端口

### 消息发送失败

1. 检查企业微信的AgentId和Secret
2. 检查access_token是否过期
3. 查看日志文件 `wechat-bridge.log`

---

## 安全注意

- [ ] 生产环境使用 HTTPS
- [ ] 使用强 Token
- [ ] 限制 IP 访问（企业微信后台可设置）
- [ ] 定期更新 access_token

---

_由玩偶卡卡生成 🐻_
