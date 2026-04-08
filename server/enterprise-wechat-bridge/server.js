/**
 * 企业微信桥接服务 - 主服务
 * 
 * 接收企业微信消息，转发给卡卡处理
 */

import express from 'express'
import crypto from 'crypto'
import fs from 'fs'
import config from './config.js'
import MessageQueue from './message-queue.js'
import WeChatAPI from './wechatAPI.js'

// 初始化
const app = express()
const wechatAPI = new WeChatAPI(config.wechat)
const queue = new MessageQueue(config.queue.filePath)

// 日志
function log(level, ...args) {
  const time = new Date().toISOString()
  const msg = `[${time}] [${level}] ${args.join(' ')}`
  console.log(msg)
  try {
    fs.appendFileSync(config.log.file, msg + '\n')
  } catch (e) {
    // 忽略
  }
}

// 中间件
app.use(express.xml({ limit: '1mb' }))

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'wechat-bridge',
    time: new Date().toISOString(),
    queue: queue.getStats()
  })
})

/**
 * 接收企业微信消息
 * 企业微信会 POST 到这个接口
 */
app.post('/api/wechat/receive', async (req, res) => {
  try {
    log('INFO', '收到企业微信消息')

    // 如果是加密模式，需要解密 (这里简化处理，使用明文模式)
    const { xml, encrypt_type, msg_signature, timestamp, nonce } = req.body

    // 解析消息
    const message = wechatAPI.parseMessage(JSON.stringify(xml || req.body))
    
    // 只处理文本消息
    if (message.MsgType !== 'text') {
      log('INFO', `忽略非文本消息: ${message.MsgType}`)
      return res.send('success')
    }

    log('INFO', `用户 ${message.FromUserName}: ${message.Content}`)

    // 存储消息
    const queued = queue.add({
      fromUser: message.FromUserName,
      toUser: message.ToUserName,
      content: message.Content,
      msgId: message.MsgId,
      createTime: message.CreateTime,
      raw: message,
    })

    // 立即返回 "success" 给企业微信 (避免超时)
    res.send('success')

    // 异步处理回复 (模拟)
    setTimeout(() => {
      handleAutoReply(queued.id, message)
    }, 1000)

  } catch (e) {
    log('ERROR', '处理消息失败:', e.message)
    res.send('success')
  }
})

/**
 * 自动回复处理 (这里模拟卡卡的回复)
 * 真实场景下，卡卡会轮询 /api/messages/pending 获取消息
 */
async function handleAutoReply(msgId, message) {
  try {
    // 模拟卡卡生成回复
    const responses = generateResponse(message.Content)
    
    // 提交回复
    queue.addResponse(msgId, {
      message: responses,
      handledBy: 'kaka-v1.0'
    })

    // 尝试发送给用户
    const msg = queue.getById(msgId)
    if (msg && msg.response) {
      await wechatAPI.sendMessage(msg.fromUser, msg.response.message)
      queue.markSent(msgId)
    }
  } catch (e) {
    log('ERROR', '自动回复失败:', e.message)
  }
}

/**
 * 简单的回复生成逻辑
 * 真实场景下，这里应该调用卡卡的AI能力
 */
function generateResponse(content) {
  const text = content.toLowerCase()

  if (text.includes('咨询') || text.includes('预约')) {
    return '您好！欢迎来到茉莉心理工作室。我是卡卡，很高兴为您服务～\n\n请问您想了解哪些服务呢？\n1. 心理咨询预约\n2. 心理测评\n3. 套餐价格\n4. 咨询师介绍\n\n请回复数字或直接描述您的问题 😊'
  }

  if (text.includes('价格') || text.includes('费用') || text.includes('多少钱')) {
    return '您好！茉莉心理工作室的收费标准：\n\n🌸 首次访谈体验价：¥299/50分钟\n🌸 单次正式咨询：¥600/50分钟\n🌸 成长陪伴套餐：¥8550/15次\n🌸 关系重建套餐：¥13500/25次\n🌸 伴侣/家庭咨询：¥900/80分钟\n\n请问您想预约哪种服务呢？'
  }

  if (text.includes('测评') || text.includes('测试')) {
    return '您好！我们提供专业心理测评服务：\n\n📊 SAS焦虑量表\n📊 SDS抑郁量表\n📊 SCL-90症状清单\n📊 MMPI人格测试\n📊 依恋风格测试\n\n测评结果会有专业咨询师为您解读～\n\n请问您想预约哪种服务呢？'
  }

  if (text.includes('咨询师') || text.includes('老师')) {
    return '您好！茉莉心理工作室的王老师是资深心理咨询师，专长：\n\n💕 婚恋情感咨询\n💕 原生家庭疗愈\n💕 自我成长探索\n💕 情绪压力管理\n\n已有多年临床咨询经验～\n\n请问您想预约咨询吗？'
  }

  return '您好！我是茉莉心理的智能助理卡卡 🐻\n\n谢谢您的留言！我们的咨询师看到后会尽快回复您。\n\n如需紧急帮助，请拨打心理援助热线：12356\n\n祝您今天愉快！🌸'
}

/**
 * 获取待处理消息 (供卡卡轮询)
 */
app.get('/api/messages/pending', (req, res) => {
  const pending = queue.getPending()
  res.json({
    code: 0,
    data: pending
  })
})

/**
 * 获取单个消息详情
 */
app.get('/api/messages/:id', (req, res) => {
  const msg = queue.getById(req.params.id)
  if (!msg) {
    return res.status(404).json({ code: -1, message: '消息不存在' })
  }
  res.json({ code: 0, data: msg })
})

/**
 * 提交回复 (卡卡调用这个接口提交回复)
 */
app.post('/api/messages/:id/response', (req, res) => {
  const { message } = req.body
  if (!message) {
    return res.status(400).json({ code: -1, message: '回复内容不能为空' })
  }

  const success = queue.addResponse(req.params.id, {
    message,
    handledBy: 'kaka'
  })

  if (success) {
    const msg = queue.getById(req.params.id)
    if (msg) {
      wechatAPI.sendMessage(msg.fromUser, message).then(result => {
        if (result.success) {
          queue.markSent(req.params.id)
        }
      })
    }
    
    res.json({ code: 0, message: '回复已提交' })
  } else {
    res.status(404).json({ code: -1, message: '消息不存在' })
  }
})

/**
 * 获取统计信息
 */
app.get('/api/stats', (req, res) => {
  res.json({
    code: 0,
    data: queue.getStats()
  })
})

/**
 * 清理过期消息
 */
app.post('/api/cleanup', (req, res) => {
  queue.cleanup()
  res.json({ code: 0, message: '清理完成' })
})

// 启动服务
const PORT = config.server.port
app.listen(PORT, config.server.host, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║     企业微信桥接服务 - 启动成功           ║
╠═══════════════════════════════════════════╣
║  端口: ${PORT}                               ║
║  环境: ${config.server.env}                          ║
║  企业ID: ${config.wechat.corpId}               ║
║  应用ID: ${config.wechat.agentId}                   ║
╚═══════════════════════════════════════════╝

📌 企业微信后台配置:
   回调URL: http://你的域名:${PORT}/api/wechat/receive
   Token: ${config.wechat.token}

🌐 访问 http://localhost:${PORT}/health 检查服务状态
`)
})

// 定时清理过期消息 (每小时)
setInterval(() => {
  queue.cleanup()
}, 60 * 60 * 1000)
