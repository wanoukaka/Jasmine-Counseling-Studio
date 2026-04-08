# 茉莉心理咨询工作室 - API 文档

> 版本: 1.0.0 | 更新: 2026-04-05 | 共61个端点

---

## 快速开始

### 认证

```bash
# 所有请求需要在 Header 中携带
Authorization: Bearer <API_SECRET>

# 默认测试密钥
API_SECRET=jasmine-secret-2026
```

### Base URL

```
开发环境: http://localhost:3001
生产环境: https://your-domain.com
```

---

## 端点总览

| 模块 | 端点数 | 说明 |
|------|--------|------|
| 咨询师 | 10 | consultants |
| 来访者 | 7 | clients |
| 预约 | 5 | appointments |
| 个案笔记 | 11 | cases |
| 问卷评估 | 3 | assessments |
| 知情同意 | 2 | intake |
| 合同 | 2 | contracts |
| 渠道来源 | 3 | channels |
| 统计 | 1 | stats |
| 财务 | 7 | finance |
| 报表 | 5 | reports |
| 设置 | 2 | settings |
| **总计** | **61** | |

---

## 响应格式

### 成功

```json
{
  "code": 0,
  "data": { ... }
}
```

### 错误

| code | 含义 |
|------|------|
| -1 | 通用错误 |
| 401 | 未授权 |
| 404 | 资源不存在 |
| 500 | 服务器错误 |

---

## 健康检查

```bash
curl http://localhost:3001/api/health
```

---

## 请求日志

日志文件: `./request.log`

启用日志中间件:

```javascript
import { requestLogger } from './middleware/logger.js'
app.use(requestLogger)
```

---

## 咨询师相关

### 获取咨询师列表
```http
GET /api/consultants
```

### 获取咨询师详情
```http
GET /api/consultants/:id
```

### 创建咨询师
```http
POST /api/consultants
Content-Type: application/json

{
  "name": "王咨询师",
  "title": "资深心理咨询师",
  "bio": "专注婚恋情感咨询",
  "specialties": ["婚恋", "情感", "家庭"],
  "fee": 600
}
```

---

## 来访者相关

### 获取来访者列表
```http
GET /api/clients
```

### 创建来访者
```http
POST /api/clients
Content-Type: application/json

{
  "name": "张三",
  "phone": "13800138000",
  "gender": "female",
  "source": "小红书"
}
```

---

## 预约相关

### 创建预约
```http
POST /api/appointments
Content-Type: application/json

{
  "client_id": "xxx",
  "consultant_id": "xxx",
  "start_time": "2026-04-06 10:00:00",
  "end_time": "2026-04-06 11:00:00",
  "type": "initial"  // initial | followup | supervision
}
```

---

## 财务相关

### 收入统计
```http
GET /api/finance/income?period=month
```

### 添加付款
```http
POST /api/finance/payments
Content-Type: application/json

{
  "client_id": "xxx",
  "consultant_id": "xxx",
  "amount": 600,
  "type": "session",
  "status": "paid"
}
```

---

_本文档由玩偶卡卡自动生成 🐻_
