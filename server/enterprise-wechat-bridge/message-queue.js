/**
 * 消息队列 - 简单的JSON文件存储
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

class MessageQueue {
  constructor(filePath) {
    this.filePath = path.resolve(__dirname, filePath)
    this.messages = []
    this.load()
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8')
        this.messages = JSON.parse(data)
        console.log(`✅ 消息队列已加载，共 ${this.messages.length} 条消息`)
      } else {
        this.messages = []
        console.log('📝 新建消息队列')
      }
    } catch (e) {
      console.error('❌ 消息队列加载失败:', e.message)
      this.messages = []
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.messages, null, 2))
    } catch (e) {
      console.error('❌ 消息队列保存失败:', e.message)
    }
  }

  add(message) {
    const msg = {
      id: this.generateId(),
      ...message,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      responses: [],
    }
    this.messages.push(msg)
    this.save()
    console.log(`📥 新消息: ${message.content?.substring(0, 50) || '无内容'} (ID: ${msg.id})`)
    return msg
  }

  getPending() {
    return this.messages.filter(m => m.status === 'pending')
  }

  getById(id) {
    return this.messages.find(m => m.id === id)
  }

  markProcessing(id) {
    const msg = this.getById(id)
    if (msg) {
      msg.status = 'processing'
      msg.updatedAt = new Date().toISOString()
      this.save()
    }
    return msg
  }

  addResponse(id, response) {
    const msg = this.getById(id)
    if (msg) {
      msg.response = response
      msg.status = 'completed'
      msg.updatedAt = new Date().toISOString()
      this.save()
      console.log(`✅ 回复已提交 (ID: ${id}): ${response.message?.substring(0, 30) || ''}...`)
      return true
    }
    return false
  }

  getPendingResponses() {
    return this.messages.filter(m => m.status === 'completed' && !m.sent)
  }

  markSent(id) {
    const msg = this.getById(id)
    if (msg) {
      msg.sent = true
      msg.sentAt = new Date().toISOString()
      this.save()
    }
    return msg
  }

  cleanup(maxAge = 24 * 60 * 60 * 1000) {
    const now = Date.now()
    const before = now - maxAge
    const beforeTime = new Date(before).toISOString()
    
    const beforeCount = this.messages.length
    this.messages = this.messages.filter(m => {
      if (m.status === 'completed' && m.sent && m.updatedAt < beforeTime) {
        return false
      }
      return true
    })
    
    if (this.messages.length < beforeCount) {
      this.save()
      console.log(`🧹 清理了 ${beforeCount - this.messages.length} 条过期消息`)
    }
  }

  generateId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  getStats() {
    return {
      total: this.messages.length,
      pending: this.messages.filter(m => m.status === 'pending').length,
      processing: this.messages.filter(m => m.status === 'processing').length,
      completed: this.messages.filter(m => m.status === 'completed').length,
      sent: this.messages.filter(m => m.sent).length,
    }
  }
}

export default MessageQueue
