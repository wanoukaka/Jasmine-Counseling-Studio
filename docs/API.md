# Jasmine Counseling Studio API 文档

> 基于 Fastify 的 RESTful API | 基础路径：`http://localhost:3001/api`

---

## 通用响应格式

```json
{
  "code": 0,
  "message": "success",
  "data": { ... }
}
```

错误响应：
```json
{
  "code": -1,
  "message": "错误描述"
}
```

---

## 一、咨询师

### GET /api/consultants
获取所有咨询师列表

**响应**
```json
{
  "data": [
    {
      "id": "ABC123",
      "name": "王琳",
      "title": "国家二级心理咨询师",
      "bio": "婚恋情感 / 自我成长",
      "specialties": ["婚恋情感", "情绪管理"],
      "fee": 600,
      "avatar_url": "https://..."
    }
  ]
}
```

### POST /api/consultants
新增咨询师

**请求体**
```json
{
  "name": "王琳",
  "title": "国家二级心理咨询师",
  "bio": "...",
  "specialties": ["婚恋", "亲子"],
  "fee": 600
}
```

---

## 二、来访者

### GET /api/clients
获取来访者列表

**查询参数**
| 参数 | 类型 | 说明 |
|------|------|------|
| consultant_id | string | 负责咨询师 ID |
| status | string | active / archived |
| keyword | string | 姓名/电话搜索 |

### POST /api/clients
新增来访者登记

**请求体**
```json
{
  "name": "张三",
  "phone": "13800138000",
  "email": "zhang@example.com",
  "gender": "female",
  "age": 28,
  "source": "小红书",
  "channel_code": "xhs001",
  "tags": ["婚恋情感", "情绪低落"],
  "assigned_consultant_id": "ABC123",
  "emergency_name": "李四",
  "emergency_phone": "13900139000"
}
```

---

## 三、预约

### GET /api/appointments
获取预约列表

**查询参数**
| 参数 | 类型 | 说明 |
|------|------|------|
| consultant_id | string | 咨询师 ID |
| client_id | string | 来访者 ID |
| status | string | 状态 |
| from | date | 开始日期 |
| to | date | 结束日期 |

### POST /api/appointments
创建预约（自动创建腾讯会议 + 发送飞书通知）

**请求体**
```json
{
  "client_id": "CL001",
  "consultant_id": "ABC123",
  "scheduled_at": "2026-03-25 14:00:00",
  "duration": 60,
  "type": "first"
}
```

**响应**
```json
{
  "data": {
    "id": "APT001",
    "meeting_url": "https://meeting.tencent.com/w/meeting/123456"
  }
}
```

### PATCH /api/appointments/:id/status
更新预约状态

```json
{ "status": "completed" }
```

---

## 四、个案记录

### GET /api/cases
获取个案记录列表

**查询参数**
- `client_id` - 来访者 ID
- `type` - initial / progress / supervision / assessment

### POST /api/cases
新增个案记录

**请求体**
```json
{
  "client_id": "CL001",
  "consultant_id": "ABC123",
  "appointment_id": "APT001",
  "type": "progress",
  "cc": "近期感觉压力大，睡眠不好...",
  "ph": "独居，工作繁忙...",
  "hpi": "三个月前开始...",
  "mse": "意识清，定向力完整...",
  "assessment": "中度抑郁情绪...",
  "intervention": "聚焦情绪调节...",
  "content": "（Markdown 格式详细内容）"
}
```

### PATCH /api/cases/:id
更新个案记录（含电子签名确认）

```json
{
  "content": "...",
  "signed": true
}
```

---

## 五、合同

### GET /api/contracts
获取合同列表

### POST /api/contracts
创建合同并发起电子签章流程

```json
{
  "client_id": "CL001",
  "consultant_id": "ABC123",
  "type": "intake",
  "title": "心理咨询服务协议",
  "content": "..."
}
```

---

## 六、付费记录

### GET /api/payments
获取付费记录

### POST /api/payments
新增付费记录

```json
{
  "client_id": "CL001",
  "consultant_id": "ABC123",
  "amount": 600,
  "type": "session",
  "payment_method": "alipay",
  "transaction_id": "..."
}
```

---

## 七、渠道追踪

### GET /api/channels
获取所有渠道数据

### POST /api/channels
创建新渠道

```json
{
  "name": "小红书推广",
  "platform": "xiaohongshu",
  "description": "3月心理健康月活动"
}
```

### GET /api/channels/:code
访问渠道落地页（记录点击）

---

## 八、统计数据

### GET /api/stats/dashboard
获取仪表盘统计数据

```json
{
  "data": {
    "totalClients": 28,
    "todayAppts": 3,
    "weekAppts": 12,
    "monthRevenue": 18600
  }
}
```

---

## 九、WebSocket（实时通知）

连接地址：`ws://localhost:3001/ws`

推送事件：
- `appointment:new` - 新预约
- `appointment:reminder` - 会议提醒
- `case:signed` - 个案记录已签名
