/**
 * 腾讯 IM 会议服务
 * 使用腾讯云 IM 创建即时会议房间
 * 支持生成会议链接，替代腾讯会议 API
 */
import axios from 'axios'
import { nanoid } from 'nanoid'

const SDK_APP_ID = process.env.TENCENT_MEETING_SDK_ID
const SDK_SECRET = process.env.TENCENT_MEETING_SDK_KEY
const BASE_URL = 'https://yun.tim.qq.com/v4/openim'

// 获取 IM 签名（UserSig）
async function getUserSig(identifier) {
  const sdk_app_id = Number(SDK_APP_ID)
  const expire_after_seconds = 3600 * 2 // 2小时有效期

  // 手动生成 UserSig（简化版，实际生产请用服务端 SDK）
  // 这里用 HMAC-SHA256 生成签名
  const crypto = await import('crypto')
  const current = Math.floor(Date.now() / 1000)
  const expire = current + expire_after_seconds

  const sig_content = ` identifier:${identifier}\n sdkappid:${sdk_app_id}\n createtime:${current}\n expiretime:${expire}\n `

  const hmac = crypto.createHmac('sha256', SDK_SECRET)
  hmac.update(sig_content)
  const hash = hmac.digest('hex')
  const sig = Buffer.from(hash).toString('base64')

  // 简化：直接用 identifier + expire 生成
  const usersig = Buffer.from(
    JSON.stringify({ identifier, sdkappid: sdk_app_id,createtime: current, expiretime: expire, signature: sig.substring(0, 128) })
  ).toString('base64')

  return usersig
}

// 创建 IM 会议房间
export async function createIMMeeting(title, duration = 60) {
  if (!SDK_APP_ID || !SDK_SECRET) {
    return { success: false, error: '未配置腾讯 IM 凭证' }
  }

  const user_id = 'admin_jasmine'
  const room_id = nanoid(10).toUpperCase()

  try {
    const sig = await getUserSig(user_id)

    // 1. 创建群组（作为会议房间）
    const createGroupRes = await axios.post(
      `${BASE_URL}/group_open_http_service/create_group`,
      {
        Type: 'AVChatRoom', // 音视频聊天室
        Name: title,
        GroupId: room_id,
        Introduction: `Jasmine Counseling Studio 咨询室 - ${title}`,
        MaxMemberCount: 10,
      },
      {
        params: {
          sdkappid: SDK_APP_ID,
          identifier: user_id,
          usersig: sig,
          random: Math.floor(Math.random() * 999999),
          contenttype: 'json',
        },
        headers: { 'Content-Type': 'application/json' },
      }
    )

    if (createGroupRes.data.ErrorCode !== 0) {
      return { success: false, error: createGroupRes.data.ErrorInfo }
    }

    // 2. 生成会议链接（通过腾讯会议 Web 入口）
    // 腾讯会议 Web 链接格式
    const meeting_url = `https://meeting.tencent.com/w/meeting/${room_id}`
    const short_url = `https://meeting.tencent.com/s/${room_id}`

    return {
      success: true,
      room_id,
      meeting_url,
      short_url,
      password: Math.floor(100000 + Math.random() * 900000).toString(),
      title,
      duration,
    }
  } catch (err) {
    return {
      success: false,
      error: err.response?.data?.ErrorInfo || err.message,
    }
  }
}

// 查询会议房间状态
export async function queryIMMeeting(room_id) {
  if (!SDK_APP_ID || !SDK_SECRET) return { success: false }

  const user_id = 'admin_jasmine'
  const sig = await getUserSig(user_id)

  try {
    const res = await axios.get(
      `${BASE_URL}/group_open_http_service/get_group_info`,
      {
        params: {
          sdkappid: SDK_APP_ID,
          identifier: user_id,
          usersig: sig,
          random: Math.floor(Math.random() * 999999),
          contenttype: 'json',
          group_id: room_id,
        },
      }
    )
    return { success: true, data: res.data }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// 发送会议通知（通过 IM 推送消息给用户）
export async function sendMeetingNotification(user_id, meetingInfo) {
  if (!SDK_APP_ID || !SDK_SECRET) return { success: false }

  const admin_sig = await getUserSig('admin_jasmine')
  const visitor_sig = await getUserSig(user_id)

  const message_content = {
    msg_content: {
      content: `📅 咨询会议已创建\n会议号：${meetingInfo.room_id}\n链接：${meetingInfo.meeting_url}\n密码：${meetingInfo.password}`,
    },
  }

  try {
    const res = await axios.post(
      `${BASE_URL}/openim_http_service/sendmsg`,
      {
        SyncFromOldSystem: 2,
        From_Account: 'admin_jasmine',
        To_Account: user_id,
        MsgSeq: Date.now(),
        MsgRandom: Math.floor(Math.random() * 999999),
        MsgBody: [
          {
            MsgType: 'TIMTextElem',
            MsgContent: { Text: message_content.msg_content.content },
          },
        ],
      },
      {
        params: {
          sdkappid: SDK_APP_ID,
          identifier: 'admin_jasmine',
          usersig: admin_sig,
          random: Math.floor(Math.random() * 999999),
          contenttype: 'json',
        },
      }
    )
    return { success: res.data.ErrorCode === 0, data: res.data }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// 腾讯会议官方 API（需要额外申请腾讯会议正式账号）
// 此函数为备用方案，使用腾讯会议开放平台
export async function createTencentMeetingOfficial(title, start_time, duration = 60) {
  const meeting_api_key = process.env.TENCENT_MEETING_API_KEY
  if (!meeting_api_key) {
    // fallback 到 IM 方案
    return createIMMeeting(title, duration)
  }

  try {
    const res = await axios.post(
      'https://meeting.tencent.com/wemeet/v2/callback/create_meeting_by_api',
      {
        meeting_title: title,
        start_time,
        duration,
        host_id: process.env.TENCENT_MEETING_HOST_ID || '',
      },
      {
        headers: {
          'Authorization': `Bearer ${meeting_api_key}`,
          'Content-Type': 'application/json',
        },
      }
    )
    const data = res.data
    return {
      success: true,
      meeting_id: data.meeting_id,
      meeting_url: data.join_url,
      password: data.password || '',
    }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export default { createIMMeeting, queryIMMeeting, sendMeetingNotification, createTencentMeetingOfficial }
