/**
 * 企业微信 API 工具
 */

import crypto from 'crypto'

class WeChatAPI {
  constructor(config) {
    this.corpId = config.corpId
    this.agentId = config.agentId
    this.secret = config.secret
    this.token = config.token
    this.accessToken = null
    this.tokenExpire = 0
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpire) {
      return this.accessToken
    }

    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.secret}`
    
    try {
      const res = await fetch(url)
      const data = await res.json()
      
      if (data.errcode === 0) {
        this.accessToken = data.access_token
        this.tokenExpire = Date.now() + (data.expires_in - 300) * 1000
        console.log('✅ Access Token 获取成功')
        return this.accessToken
      } else {
        throw new Error(`获取Token失败: ${data.errmsg}`)
      }
    } catch (e) {
      console.error('❌ Access Token 获取失败:', e.message)
      throw e
    }
  }

  async sendMessage(toUser, content) {
    const token = await this.getAccessToken()
    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`

    const payload = {
      touser: toUser,
      msgtype: 'text',
      agentid: this.agentId,
      text: {
        content: content
      }
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()

      if (data.errcode === 0) {
        console.log(`✅ 消息发送成功 → ${toUser}`)
        return { success: true, data }
      } else {
        throw new Error(`发送失败: ${data.errmsg}`)
      }
    } catch (e) {
      console.error('❌ 消息发送失败:', e.message)
      return { success: false, error: e.message }
    }
  }

  verifySignature(msgSignature, timestamp, nonce, encrypt) {
    const arr = [this.token, timestamp, nonce, encrypt].sort()
    const str = arr.join('')
    const sha1 = crypto.createHash('sha1').update(str).digest('hex')
    return sha1 === msgSignature
  }

  parseMessage(xmlData) {
    const getValue = (key) => {
      const match = xmlData.match(new RegExp(`<${key}><!\\[CDATA\\[(.*?)\\]\\]></${key}>`)) ||
                    xmlData.match(new RegExp(`<${key}>(.*?)</${key}>`))
      return match ? match[1] : null
    }

    return {
      ToUserName: getValue('ToUserName'),
      FromUserName: getValue('FromUserName'),
      CreateTime: parseInt(getValue('CreateTime')),
      MsgType: getValue('MsgType'),
      Content: getValue('Content'),
      MsgId: getValue('MsgId'),
      AgentID: getValue('AgentID'),
    }
  }

  buildReply(toUser, fromUser, content) {
    const time = Math.floor(Date.now() / 1000)
    return `<xml>
<ToUserName><![CDATA[${toUser}]]></ToUserName>
<FromUserName><![CDATA[${fromUser}]]></FromUserName>
<CreateTime>${time}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${content}]]></Content>
</xml>`
  }
}

export default WeChatAPI
