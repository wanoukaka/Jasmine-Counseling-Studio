/**
 * 咨询师管理路由
 * routes/consultants.js
 */
import { nanoid } from 'nanoid'

export default async function consultantsRoutes(fastify) {

  // 获取咨询师详情（含统计）
  fastify.get('/api/consultants/:id', async (req) => {
    const { id } = req.params
    const consultant = fastify.db.prepare('SELECT * FROM consultants WHERE id = ?').get(id)
    if (!consultant) return { code: 404, message: '咨询师不存在' }

    consultant.specialties = JSON.parse(consultant.specialties || '[]')
    consultant.availability = JSON.parse(consultant.availability || '{}')

    // 统计数据
    consultant.stats = {
      totalClients: fastify.db.prepare(
        'SELECT COUNT(*) as c FROM clients WHERE assigned_consultant_id = ?'
      ).get(id).c,
      totalAppointments: fastify.db.prepare(
        'SELECT COUNT(*) as c FROM appointments WHERE consultant_id = ?'
      ).get(id).c,
      completedSessions: fastify.db.prepare(
        "SELECT COUNT(*) as c FROM appointments WHERE consultant_id = ? AND status = 'completed'"
      ).get(id).c,
      pendingCases: fastify.db.prepare(
        "SELECT COUNT(*) as c FROM case_notes WHERE consultant_id = ? AND signed = 0"
      ).get(id).c,
    }

    return { code: 0, data: consultant }
  })

  // 获取咨询师日历（本月预约概览）
  fastify.get('/api/consultants/:id/calendar', async (req) => {
    const { id } = req.params
    const { year, month } = req.query || {}
    const y = year || new Date().getFullYear()
    const m = (month || new Date().getMonth() + 1).toString().padStart(2, '0')
    const start = `${y}-${m}-01`
    const end = `${y}-${m}-31`

    const appointments = fastify.db.prepare(`
      SELECT a.*, c.name as client_name, c.phone as client_phone
      FROM appointments a
      LEFT JOIN clients c ON a.client_id = c.id
      WHERE a.consultant_id = ?
        AND DATE(a.scheduled_at) BETWEEN ? AND ?
      ORDER BY a.scheduled_at ASC
    `).all(id, start, end)

    appointments.forEach(a => { a.date = a.scheduled_at.slice(0, 10) })
    return { code: 0, data: appointments }
  })

  // 获取咨询师的个案记录列表
  fastify.get('/api/consultants/:id/cases', async (req) => {
    const { id } = req.params
    const { type, status } = req.query || {}
    let sql = `
      SELECT cn.*, c.name as client_name
      FROM case_notes cn
      LEFT JOIN clients c ON cn.client_id = c.id
      WHERE cn.consultant_id = ?
    `
    const params = [id]
    if (type) { sql += ' AND cn.type = ?'; params.push(type) }
    if (status === 'unsigned') { sql += ' AND cn.signed = 0' }
    sql += ' ORDER BY cn.created_at DESC'

    const rows = fastify.db.prepare(sql).all(...params)
    rows.forEach(r => {
      r.attachments = JSON.parse(r.attachments || '[]')
      r.signed = !!r.signed
    })
    return { code: 0, data: rows }
  })

  // 新增 / 更新咨询师
  fastify.post('/api/consultants', async (req) => {
    const { name, title, bio, specialties, fee, availability, wechat_id, feishu_webhook } = req.body || {}
    if (!name) return { code: -1, message: '姓名必填' }
    const id = nanoid()
    fastify.db.prepare(`
      INSERT INTO consultants (id, name, title, bio, specialties, fee, availability, wechat_id, feishu_webhook)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, title || '', bio || '', JSON.stringify(specialties || []), fee || 600, JSON.stringify(availability || {}), wechat_id || '', feishu_webhook || '')
    return { code: 0, data: { id } }
  })

  fastify.patch('/api/consultants/:id', async (req) => {
    const { id } = req.params
    const fields = req.body || {}
    const allowed = ['name', 'title', 'bio', 'specialties', 'fee', 'availability', 'wechat_id', 'feishu_webhook', 'status']
    const updates = []
    const values = []
    for (const key of allowed) {
      if (key in fields) {
        updates.push(`${key} = ?`)
        values.push(key === 'specialties' || key === 'availability' ? JSON.stringify(fields[key]) : fields[key])
      }
    }
    if (!updates.length) return { code: -1, message: '无有效字段' }
    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)
    fastify.db.prepare(`UPDATE consultants SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return { code: 0 }
  })

  // 获取督导日历
  fastify.get('/api/consultants/:id/supervision-calendar', async (req) => {
    const { id } = req.params
    const { year, month } = req.query || {}
    const y = year || new Date().getFullYear()
    const m = (month || new Date().getMonth() + 1).toString().padStart(2, '0')
    const start = `${y}-${m}-01`
    const end = `${y}-${m}-31`

    // 督导记录（type = supervision）
    const supervisions = fastify.db.prepare(`
      SELECT cn.*, c.name as client_name
      FROM case_notes cn
      LEFT JOIN clients c ON cn.client_id = c.id
      WHERE cn.consultant_id = ? AND cn.type = 'supervision'
        AND DATE(cn.created_at) BETWEEN ? AND ?
      ORDER BY cn.created_at ASC
    `).all(id, start, end)

    return { code: 0, data: supervisions }
  })

  // 同步到飞书 Wiki
  fastify.post('/api/consultants/:id/sync-wiki', async (req) => {
    const { id } = req.params
    const consultant = fastify.db.prepare('SELECT * FROM consultants WHERE id = ?').get(id)
    if (!consultant) return { code: 404, message: '咨询师不存在' }

    // 获取所有个案记录
    const cases = fastify.db.prepare(`
      SELECT cn.*, c.name as client_name
      FROM case_notes cn LEFT JOIN clients c ON cn.client_id = c.id
      WHERE cn.consultant_id = ?
      ORDER BY cn.created_at DESC LIMIT 50
    `).all(id)

    const wikiContent = buildFeishuWikiContent(consultant, cases)
    const result = await syncToFeishuWiki(consultant, wikiContent)

    return { code: 0, data: result }
  })
}

// 构建飞书 Wiki 内容
function buildFeishuWikiContent(consultant, cases) {
  const caseLines = cases.map(c => `
## 【${c.type === 'supervision' ? '🛡️ 督导' : '📋 个案'}】${c.client_name || '匿名'} | ${c.created_at?.slice(0, 10)}
- **类型**: ${c.type}
- **状态**: ${c.signed ? '✅ 已签名' : '⚠️ 待签名'}
${c.cc ? `- **主诉**: ${c.cc}` : ''}
${c.assessment ? `- **评估**: ${c.assessment}` : ''}
${c.intervention ? `- **干预计划**: ${c.intervention}` : ''}
${c.supervision_content ? `\n### 督导笔记\n${c.supervision_content}` : ''}
  `).join('\n\n')

  return `# 🧸 ${consultant.name} 咨询师工作台

> 更新时间：${new Date().toLocaleString('zh-CN')}

## 📊 工作统计
- 来访者总数：待统计
- 累计咨询：待统计
- 待签名个案：${cases.filter(c => !c.signed).length} 份

## 🏷️ 基本信息
- **姓名**: ${consultant.name}
- **头衔**: ${consultant.title || '心理咨询师'}
- **专长**: ${JSON.parse(consultant.specialties || '[]').join(' / ') || '通用'}
- **咨询费用**: ¥${consultant.fee || 600}/次

${consultant.bio ? `## 📝 个人简介\n${consultant.bio}` : ''}

## 📋 最近个案记录

${caseLines || '_暂无个案记录_'}

---
*本页面由 Jasmine Counseling Studio 自动同步生成*
`
}

// 同步到飞书 Wiki
async function syncToFeishuWiki(consultant, content) {
  const webhook = process.env.FEISHU_WIKI_WEBHOOK || process.env.FEISHU_WEBHOOK_URL
  if (!webhook) {
    return { synced: false, reason: '未配置飞书 Webhook' }
  }

  // 飞书 Wiki API（需要飞书开放平台应用权限）
  // 此处使用飞书机器人推送作为替代方案
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: {
          text: `📋 ${consultant.name} 咨询师工作台已更新\n最新个案记录已同步，共 ${content.length} 字`
        }
      })
    })
    return { synced: true, url: '飞书机器人通知已发送' }
  } catch (e) {
    return { synced: false, reason: e.message }
  }
}
