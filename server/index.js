/**
 * Jasmine Counseling Studio 后端服务
 * Node.js + Express + sql.js
 */
import express from 'express'
import cors from 'cors'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import initSqlJs from 'sql.js'
import { nanoid } from 'nanoid'
import dayjs from 'dayjs'
import articlesRoutes from './routes/articles.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, 'db', 'jasmine.db')

// ── 数据库初始化 ───────────────────────────────────────
const SQL = await initSqlJs()
let db
if (existsSync(DB_PATH)) {
  db = new SQL.Database(readFileSync(DB_PATH))
  console.log('✅ 数据库加载成功')
} else {
  db = new SQL.Database()
  console.log('✅ 新数据库创建成功')
}

const schema = readFileSync(join(__dirname, 'db', 'schema.sql'), 'utf-8')
db.run(schema)

// 迁移：确保 SOAP 字段存在
const soapCols = [
  ['soap_s', 'TEXT DEFAULT ""'],
  ['soap_o', 'TEXT DEFAULT ""'],
  ['soap_a', 'TEXT DEFAULT ""'],
  ['soap_p', 'TEXT DEFAULT ""'],
  ['session_duration', 'INTEGER DEFAULT 0'],
]
for (const [col, def] of soapCols) {
  try {
    const info = db.exec(`PRAGMA table_info(case_notes)`)
    const cols = info.length ? info[0].values.map(v => v[1]) : []
    if (!cols.includes(col)) {
      db.run(`ALTER TABLE case_notes ADD COLUMN ${col} ${def}`)
      console.log(`✅ 已添加字段: case_notes.${col}`)
    }
  } catch (e) {
    // 列可能已存在，忽略
  }
}

function saveDb() {
  writeFileSync(DB_PATH, Buffer.from(db.export()))
}
setInterval(saveDb, 60000)

// ── db 辅助函数 ───────────────────────────────────────
function dbAll(sql, params = []) {
  const r = db.exec(sql, params)
  if (!r.length) return []
  const { columns, values } = r[0]
  return values.map(v => Object.fromEntries(columns.map((c, i) => [c, v[i]])))
}
function dbGet(sql, params = []) {
  return dbAll(sql, params)[0] || null
}
function dbRun(sql, params = []) {
  db.run(sql, params.length ? params : undefined)
  saveDb()
}

// ── Express ────────────────────────────────────────────
const app = express()
app.use(cors())
app.use(express.json())

// ── API 密钥认证中间件 ────────────────────────────────
const API_SECRET = process.env.API_SECRET_KEY || 'jasmine-secret-2026'
app.use('/api/', (req, res, next) => {
  // 跳过健康检查
  if (req.path === '/health') return next()
  const auth = req.headers.authorization || req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== API_SECRET) {
    return res.status(401).json({ code: -1, message: '未授权访问，请联系管理员' })
  }
  next()
})

const ok = (res, data = null) => res.json({ code: 0, data })
const okMsg = (res, msg) => res.json({ code: 0, message: msg })
const err = (res, msg, status = 400) => res.status(status).json({ code: -1, message: msg })

// ── 咨询师 ─────────────────────────────────────────────
app.get('/api/consultants', (req, res) => {
  const rows = dbAll('SELECT * FROM consultants WHERE status = ? ORDER BY created_at DESC', ['active'])
  rows.forEach(r => { try { r.specialties = JSON.parse(r.specialties || '[]') } catch {} })
  ok(res, rows)
})

app.get('/api/consultants/:id', (req, res) => {
  const row = dbGet('SELECT * FROM consultants WHERE id = ?', [req.params.id])
  if (!row) return err(res, '不存在', 404)
  try { row.specialties = JSON.parse(row.specialties || '[]') } catch {}
  const s = dbGet('SELECT COUNT(*) as c FROM clients WHERE assigned_consultant_id = ?', [req.params.id])
  const a = dbGet('SELECT COUNT(*) as c FROM appointments WHERE consultant_id = ?', [req.params.id])
  const ps = dbGet("SELECT COUNT(*) as c FROM case_notes WHERE consultant_id = ? AND signed = 0", [req.params.id])
  row.stats = { totalClients: s?.c || 0, totalAppointments: a?.c || 0, pendingCases: ps?.c || 0 }
  ok(res, row)
})

app.post('/api/consultants', (req, res) => {
  const { name, title, bio, specialties, fee } = req.body || {}
  if (!name) return err(res, '姓名必填')
  const id = nanoid()
  dbRun('INSERT INTO consultants (id,name,title,bio,specialties,fee) VALUES (?,?,?,?,?,?)',
    [id, name, title || '', bio || '', JSON.stringify(specialties || []), fee || 600])
  ok(res, { id })
})

// ── 更新咨询师 ──────────────────────────────────────────
app.patch('/api/consultants/:id', (req, res) => {
  const { id } = req.params
  const allowed = ['name','title','bio','specialties','fee','status','availability','wechat_id','feishu_webhook']
  const fields = req.body || {}
  const updates = [], values = []
  for (const key of allowed) {
    if (key in fields) {
      updates.push(`${key} = ?`)
      values.push(key === 'specialties' || key === 'availability' ? JSON.stringify(fields[key]) : fields[key])
    }
  }
  if (!updates.length) return err(res, '无有效字段')
  updates.push('updated_at = CURRENT_TIMESTAMP')
  values.push(id)
  dbRun(`UPDATE consultants SET ${updates.join(', ')} WHERE id = ?`, values)
  ok(res)
})

// ── 咨询师的个案列表 ─────────────────────────────────────
app.get('/api/consultants/:id/cases', (req, res) => {
  const { id } = req.params
  const { type, status } = req.query || {}
  let sql = `SELECT cn.*, c.name as client_name FROM case_notes cn LEFT JOIN clients c ON cn.client_id=c.id WHERE cn.consultant_id=?`
  const params = [id]
  if (type) { sql += ' AND cn.type=?'; params.push(type) }
  if (status === 'unsigned') { sql += ' AND cn.signed=0' }
  sql += ' ORDER BY cn.created_at DESC'
  const rows = dbAll(sql, params)
  rows.forEach(r => { try { r.attachments = JSON.parse(r.attachments || '[]') } catch {} })
  ok(res, rows)
})

app.get('/api/consultants/:id/calendar', (req, res) => {
  const y = req.query.year || new Date().getFullYear()
  const m = ((req.query.month || new Date().getMonth() + 1) + '').padStart(2, '0')
  const rows = dbAll(
    `SELECT a.*, c.name as client_name FROM appointments a LEFT JOIN clients c ON a.client_id=c.id WHERE a.consultant_id=? AND a.scheduled_at BETWEEN '${y}-${m}-01' AND '${y}-${m}-31' ORDER BY a.scheduled_at ASC`,
    [req.params.id]
  )
  ok(res, rows)
})

app.get('/api/consultants/:id/supervision-calendar', (req, res) => {
  const y = req.query.year || new Date().getFullYear()
  const m = ((req.query.month || new Date().getMonth() + 1) + '').padStart(2, '0')
  const rows = dbAll(
    `SELECT cn.*, c.name as client_name FROM case_notes cn LEFT JOIN clients c ON cn.client_id=c.id WHERE cn.consultant_id=? AND cn.type='supervision' AND cn.created_at BETWEEN '${y}-${m}-01' AND '${y}-${m}-31' ORDER BY cn.created_at ASC`,
    [req.params.id]
  )
  ok(res, rows)
})

app.post('/api/consultants/:id/sync-wiki', async (req, res) => {
  const consultant = dbGet('SELECT * FROM consultants WHERE id = ?', [req.params.id])
  if (!consultant) return err(res, '不存在', 404)
  const webhook = dbGet('SELECT value FROM settings WHERE key=?', ['feishu_webhook'])?.value
  if (webhook) {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: `📋 ${consultant.name} 咨询师档案已更新` } })
    })
  }
  ok(res, { synced: true })
})

// ── 来访者 ─────────────────────────────────────────────
app.get('/api/clients', (req, res) => {
  const { consultant_id, keyword } = req.query || {}
  let sql = `SELECT c.*, CASE WHEN i.id IS NOT NULL THEN 1 ELSE 0 END as has_intake
    FROM clients c
    LEFT JOIN intake_forms i ON i.client_id = c.id
    WHERE 1=1`
  const params = []
  if (consultant_id) { sql += ' AND c.assigned_consultant_id=?'; params.push(consultant_id) }
  if (keyword) { sql += ' AND (c.name LIKE ? OR c.phone LIKE ?)'
    params.push(`%${keyword}%`, `%${keyword}%`) }
  sql += ' ORDER BY c.created_at DESC'
  ok(res, dbAll(sql, params))
})

app.get('/api/clients/:id', (req, res) => {
  const row = dbGet('SELECT * FROM clients WHERE id = ?', [req.params.id])
  if (!row) return err(res, '不存在', 404)
  const cc = dbGet('SELECT COUNT(*) as c FROM case_notes WHERE client_id = ?', [req.params.id])
  row.case_count = cc?.c || 0
  ok(res, row)
})

app.delete('/api/clients/:id', (req, res) => {
  const { id } = req.params
  const existing = dbGet('SELECT * FROM clients WHERE id = ?', [id])
  if (!existing) return err(res, '来访者不存在', 404)
  // 级联删除关联数据
  ;['case_notes','appointments','payments','intake_forms','assessment_results'].forEach(table => {
    try { dbRun(`DELETE FROM ${table} WHERE client_id = ?`, [id]) } catch {}
  })
  dbRun('DELETE FROM clients WHERE id = ?', [id])
  ok(res, { deleted: id })
})

app.post('/api/clients', (req, res) => {
  const { name, phone, source, channel_code, tags, assigned_consultant_id } = req.body || {}
  if (!name) return err(res, '姓名必填')
  const id = nanoid()
  dbRun('INSERT INTO clients (id,name,phone,source,channel_code,tags,assigned_consultant_id) VALUES (?,?,?,?,?,?,?)',
    [id, name, phone || '', source || '', channel_code || '', JSON.stringify(tags || []), assigned_consultant_id || 'default'])
  ok(res, { id })
})

// ── 预约 ──────────────────────────────────────────────
app.get('/api/appointments', (req, res) => {
  const { consultant_id, from, to } = req.query || {}
  let sql = 'SELECT a.*, c.name as client_name FROM appointments a LEFT JOIN clients c ON a.client_id=c.id WHERE 1=1'
  const params = []
  if (consultant_id) { sql += ' AND a.consultant_id=?'; params.push(consultant_id) }
  if (from) { sql += ' AND a.scheduled_at>=?'; params.push(from) }
  if (to) { sql += ' AND a.scheduled_at<=?'; params.push(to) }
  sql += ' ORDER BY a.scheduled_at ASC'
  ok(res, dbAll(sql, params))
})

app.post('/api/appointments', (req, res) => {
  const { client_id, consultant_id, scheduled_at, duration, type } = req.body || {}
  if (!client_id || !consultant_id || !scheduled_at) return err(res, '参数不完整')
  const id = nanoid()
  const mid = Math.floor(100000000 + Math.random() * 900000000)
  const pwd = Math.floor(1000 + Math.random() * 9000).toString()
  const url = `https://meeting.tencent.com/w/meeting/${mid}`
  dbRun(
    'INSERT INTO appointments (id,client_id,consultant_id,scheduled_at,duration,type,meeting_url,meeting_id,meeting_password) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, client_id, consultant_id, scheduled_at, duration || 60, type || 'first', url, mid.toString(), pwd]
  )
  ok(res, { id, meeting_url: url, meeting_id: mid.toString(), password: pwd })
})

app.patch('/api/appointments/:id/status', (req, res) => {
  const { status } = req.body || {}
  dbRun('UPDATE appointments SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [status, req.params.id])
  okMsg(res, '状态已更新')
})

// ── 个案记录 ────────────────────────────────────────────
app.get('/api/cases', (req, res) => {
  const { client_id, type } = req.query || {}
  let sql = 'SELECT cn.*, c.name as client_name FROM case_notes cn LEFT JOIN clients c ON cn.client_id=c.id WHERE 1=1'
  const params = []
  if (client_id) { sql += ' AND cn.client_id=?'; params.push(client_id) }
  if (type) { sql += ' AND cn.type=?'; params.push(type) }
  sql += ' ORDER BY cn.created_at DESC'
  ok(res, dbAll(sql, params))
})

app.post('/api/cases', (req, res) => {
  const { client_id, consultant_id, type, cc, ph, hpi, mse, assessment, intervention, content } = req.body || {}
  if (!client_id || !consultant_id) return err(res, '参数不完整')
  const id = nanoid()
  dbRun(
    'INSERT INTO case_notes (id,client_id,consultant_id,type,cc,ph,hpi,mse,assessment,intervention,content) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [id, client_id, consultant_id, type || 'progress', cc || '', ph || '', hpi || '', mse || '', assessment || '', intervention || '', content || '']
  )
  ok(res, { id })
})

app.patch('/api/cases/:id', (req, res) => {
  const f = req.body || {}
  if (!f || !Object.keys(f).length) return err(res, '无有效字段')
  const sets = Object.keys(f).filter(k => k !== 'id').map(k => `${k}=?`).join(',')
  if (!sets) return err(res, '无有效字段')
  dbRun(`UPDATE case_notes SET ${sets},updated_at=CURRENT_TIMESTAMP WHERE id=?`, [...Object.values(f), req.params.id])
  okMsg(res, '已更新')
})

// ── 合同 ──────────────────────────────────────────────
app.get('/api/contracts', (req, res) => {
  const { client_id } = req.query || {}
  let sql = 'SELECT * FROM contracts WHERE 1=1'
  const params = []
  if (client_id) { sql += ' AND client_id=?'; params.push(client_id) }
  ok(res, dbAll(sql + ' ORDER BY created_at DESC', params))
})

app.post('/api/contracts', (req, res) => {
  const { client_id, consultant_id, type, title, content } = req.body || {}
  if (!client_id || !consultant_id) return err(res, '参数不完整')
  const id = nanoid()
  dbRun('INSERT INTO contracts (id,client_id,consultant_id,type,title,content) VALUES (?,?,?,?,?,?)',
    [id, client_id, consultant_id, type || 'intake', title || '', content || ''])
  ok(res, { id })
})

// ── 渠道追踪 ───────────────────────────────────────────
app.get('/api/channels', (req, res) => ok(res, dbAll('SELECT * FROM channels WHERE status=? ORDER BY created_at DESC', ['active'])))

app.post('/api/channels', (req, res) => {
  const { name, platform, description } = req.body || {}
  const id = nanoid()
  const code = nanoid(8)
  dbRun('INSERT INTO channels (id,name,code,platform,description) VALUES (?,?,?,?,?)',
    [id, name, code, platform || '', description || ''])
  ok(res, { id, code })
})

app.get('/api/channels/:code', (req, res) => {
  const row = dbGet('SELECT * FROM channels WHERE code=?', [req.params.code])
  if (!row) return err(res, '不存在', 404)
  dbRun('UPDATE channels SET click_count=click_count+1 WHERE code=?', [req.params.code])
  ok(res, row)
})

// ── 统计 ──────────────────────────────────────────────
app.get('/api/stats/dashboard', (req, res) => {
  const cid = req.query.consultant_id || 'default'
  const today = dayjs().format('YYYY-MM-DD')
  const weekStart = dayjs().startOf('week').format('YYYY-MM-DD')
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD')
  const tc = dbGet('SELECT COUNT(*) as c FROM clients WHERE assigned_consultant_id=?', [cid])
  const ta = dbGet('SELECT COUNT(*) as c FROM appointments WHERE consultant_id=? AND DATE(scheduled_at)=?', [cid, today])
  const wa = dbGet('SELECT COUNT(*) as c FROM appointments WHERE consultant_id=? AND DATE(scheduled_at)>=?', [cid, weekStart])
  const mr = dbGet(`SELECT COALESCE(SUM(amount),0) as t FROM payments WHERE consultant_id=? AND status='paid' AND DATE(created_at)>=?`, [cid, monthStart])
  const intake7d = dbGet(`SELECT COUNT(*) as c FROM intake_forms WHERE submitted_at >= datetime('now', '-7 days')`)?.c || 0
  ok(res, { totalClients: tc?.c || 0, todayAppts: ta?.c || 0, weekAppts: wa?.c || 0, monthRevenue: mr?.t || 0, intake7d })
})

// ── 心理资讯 ──────────────────────────────────────────
articlesRoutes(app)

// ── 启动 ──────────────────────────────────────────────
const PORT = process.env.PORT || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎉 Jasmine Counseling Studio 服务已启动: http://0.0.0.0:${PORT}`)
})

// ── 系统设置（读写飞书Webhook等）──────────────────
app.get('/api/settings', (req, res) => {
  const rows = dbAll('SELECT key, value FROM settings')
  const obj = {}
  rows.forEach(r => { obj[r.key] = r.value })
  ok(res, obj)
})

app.post('/api/settings', (req, res) => {
  const { key, value } = req.body || {}
  if (!key) return err(res, 'key必填')
  dbRun('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [key, value || ''])
  ok(res, { ok: true })
})

// ── 初始评估问卷 ────────────────────────────────────
app.post('/api/intake', (req, res) => {
  const d = req.body || {}
  if (!d.client_id) return res.status(400).json({ code: -1, message: 'client_id必填' })
  const id = nanoid()
  const fields = [
    'client_id','consultant_id','serial_no','source_channel',
    'title','gender','age','phone','city','chief_complaint',
    'caregiver','parents_married','siblings','childhood_trauma','physical_abuse',
    'education','education_painful','recent_job','job_duration','job_relationships',
    'suicidal_thoughts','suicidal_detail','self_harm','mental_health_treatment','physical_disease',
    'extra_notes','emergency_contact','emergency_phone'
  ]
  const keys = fields.filter(f => d[f] !== undefined)
  const values = keys.map(k => d[k])
  dbRun('INSERT INTO intake_forms (' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')', values)

  // 飞书通知：有新来访者提交问卷
  const webhook = dbGet('SELECT value FROM settings WHERE key=?', ['feishu_webhook'])?.value
  if (webhook) {
    const clientName = d.name || d.title || '新来访者'
    const complaint = d.chief_complaint ? '\n主诉：' + d.chief_complaint.slice(0, 50) : ''
    const phone = d.phone ? '\n电话：' + d.phone : ''
    fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: '📋 有新来访者提交问卷！\n姓名：' + clientName + phone + complaint + '\n请登录管理后台查看' } })
    }).catch(() => {})
  }

  ok(res, { id })
})

app.get('/api/intake', (req, res) => {
  const { client_id } = req.query || {}
  let sql = 'SELECT i.*, c.name as client_name FROM intake_forms i LEFT JOIN clients c ON i.client_id=c.id WHERE 1=1'
  const params = []
  if (client_id) { sql += ' AND i.client_id=?'; params.push(client_id) }
  ok(res, dbAll(sql + ' ORDER BY i.submitted_at DESC', params))
})

// 测评结果
app.post('/api/assessments', (req, res) => {
  const { client_id, scale, score, level, raw_score, ip } = req.body || {}
  if (!scale) return err(res, '量表名称必填')
  const id = nanoid()
  dbRun(
    'INSERT INTO assessment_results (id,client_id,scale,score,level,raw_score,ip_address) VALUES (?,?,?,?,?,?,?)',
    [id, client_id || null, scale, JSON.stringify(score), level || '', raw_score || 0, ip || '']
  )
  ok(res, { id })
})

app.get('/api/assessments', (req, res) => {
  const { client_id, scale } = req.query || {}
  let sql = 'SELECT a.*, c.name as client_name FROM assessment_results a LEFT JOIN clients c ON a.client_id=c.id WHERE 1=1'
  const params = []
  if (client_id) { sql += ' AND a.client_id=?'; params.push(client_id) }
  if (scale) { sql += ' AND a.scale=?'; params.push(scale) }
  const rows = dbAll(sql + ' ORDER BY a.submitted_at DESC', params)
  // Parse JSON score
  rows.forEach(r => { try { r.score = JSON.parse(r.score) } catch {} })
  ok(res, rows)
})

app.get('/api/assessments/summary', (req, res) => {
  const stats = {}
  const scales = ['scl90','sas','sds','adhd','psqi','mmpi','mbti','ecr','pws','eqi']
  scales.forEach(s => {
    const total = dbGet('SELECT COUNT(*) as c FROM assessment_results WHERE scale=?', [s])?.c || 0
    stats[s] = total
  })
  ok(res, stats)
})

// ── 财务统计 ──────────────────────────────────────────────
app.get('/api/finance/income', (req, res) => {
  const { consultant_id } = req.query || {}
  const cid = consultant_id || 'default'
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')

  const buildRange = (unit) => {
    if (unit === 'day') return { start: new Date(now.setHours(0,0,0,0)).toISOString().slice(0,10), end: new Date().toISOString().slice(0,10) }
    if (unit === 'week') { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); return { start: d.toISOString().slice(0,10), end: new Date().toISOString().slice(0,10) } }
    if (unit === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10), end: new Date().toISOString().slice(0,10) }
    if (unit === 'year') return { start: new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10), end: new Date().toISOString().slice(0,10) }
    return { start: '', end: '' }
  }

  const queryPeriod = (unit) => {
    const { start, end } = buildRange(unit)
    return dbGet(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM payments WHERE consultant_id=? AND status='paid' AND DATE(created_at) >= ? AND DATE(created_at) <= ?`, [cid, start, end]) || { total: 0, count: 0 }
  }

  const queryRows = (unit) => {
    const { start, end } = buildRange(unit)
    return dbAll(`SELECT DATE(created_at) as date, SUM(amount) as total, COUNT(*) as count FROM payments WHERE consultant_id=? AND status='paid' AND DATE(created_at) >= ? AND DATE(created_at) <= ? GROUP BY DATE(created_at) ORDER BY date ASC`, [cid, start, end])
  }

  const totals = {
    daily: queryPeriod('day'),
    weekly: queryPeriod('week'),
    monthly: queryPeriod('month'),
    yearly: queryPeriod('year'),
  }

  // 历史月统计（最近12个月）
  const histStart = new Date(); histStart.setFullYear(histStart.getFullYear() - 1); histStart.setDate(1)
  const historicalMonthly = dbAll(`
    SELECT strftime('%Y-%m', created_at) as month, SUM(amount) as total, COUNT(*) as count
    FROM payments
    WHERE consultant_id=? AND status='paid' AND created_at >= ?
    GROUP BY strftime('%Y-%m', created_at)
    ORDER BY month ASC
  `, [cid, histStart.toISOString().slice(0,10)])

  // 购买记录汇总（新增的purchases表）
  const purchasesTotals = {
    daily: dbGet(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count, COALESCE(SUM(package_sessions),0) as sessions FROM payments WHERE status='paid' AND DATE(created_at)=DATE('now', 'localtime')`) || { total:0, count:0, sessions:0 },
    weekly: dbGet(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count, COALESCE(SUM(package_sessions),0) as sessions FROM payments WHERE status='paid' AND DATE(created_at)>=DATE('now','-7 days')`) || { total:0, count:0, sessions:0 },
    monthly: dbGet(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count, COALESCE(SUM(package_sessions),0) as sessions FROM payments WHERE status='paid' AND DATE(created_at)>=DATE('now','start of month')`) || { total:0, count:0, sessions:0 },
    total: dbGet(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count, COALESCE(SUM(package_sessions),0) as sessions FROM payments WHERE status='paid'`) || { total:0, count:0, sessions:0 }
  }

  // 所有购买记录列表
  const allPurchases = dbAll(`SELECT p.*, c.name as client_name FROM payments p LEFT JOIN clients c ON p.client_id=c.id WHERE p.status='paid' ORDER BY p.created_at DESC LIMIT 200`)

  ok(res, { totals, historicalMonthly, purchasesTotals, allPurchases })
})

// ── 来访者缴费记录 ─────────────────────────────────────────
app.get('/api/finance/client-payments', (req, res) => {
  const { consultant_id } = req.query || {}
  const cid = consultant_id || 'default'
  const rows = dbAll(`SELECT p.*, c.name as client_name FROM payments p LEFT JOIN clients c ON p.client_id=c.id WHERE p.consultant_id=? ORDER BY p.created_at DESC`, [cid])
  ok(res, rows)
})

// ── 新增财务记录 ──────────────────────────────────────────
app.post('/api/finance/payments', (req, res) => {
  const { client_id, amount, type, payment_method, notes, sessions, consultant_id } = req.body || {}
  if (!client_id || !amount) return err(res, '参数不完整')
  const id = nanoid()
  const cid = consultant_id || 'default'
  dbRun(`INSERT INTO payments (id,client_id,consultant_id,amount,type,payment_method,notes,package_sessions,package_remaining,status) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, client_id, cid, amount, type || 'session', payment_method || '', notes || '', sessions || null, sessions || null, 'paid'])
  ok(res, { id })
})

// ── 套餐到期提醒 ───────────────────────────────────────
app.get('/api/finance/expiring-packages', (req, res) => {
  const { consultant_id } = req.query || {}
  const cid = consultant_id || 'default'
  const rows = dbAll(`
    SELECT p.*, c.name as client_name FROM payments p
    LEFT JOIN clients c ON p.client_id=c.id
    WHERE p.consultant_id=? AND p.type='package' AND p.package_remaining>0
    ORDER BY p.created_at DESC
  `, [cid])
  ok(res, rows)
})

// ── 发票管理 ──────────────────────────────────────────
app.get('/api/finance/invoices', (req, res) => {
  const { consultant_id, status } = req.query || {}
  const cid = consultant_id || 'default'
  let sql = 'SELECT * FROM invoices WHERE consultant_id=?'
  const params = [cid]
  if (status) { sql += ' AND status=?'; params.push(status) }
  sql += ' ORDER BY created_at DESC LIMIT 100'
  ok(res, dbAll(sql, params))
})

app.post('/api/finance/invoices', (req, res) => {
  const { client_id, amount, invoice_type, tax_rate, notes, consultant_id } = req.body || {}
  if (!amount) return err(res, '金额必填')
  const cid = consultant_id || 'default'
  const id = nanoid()
  const tax_amount = parseFloat(amount) * (1 + (tax_rate || 0.06))
  const invoice_no = `INV-${dayjs().format('YYYYMM')}-${id.slice(0,6).toUpperCase()}`
  dbRun(`INSERT INTO invoices (id,client_id,consultant_id,amount,tax_amount,invoice_type,tax_rate,invoice_no,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, client_id || '', cid, amount, tax_amount, invoice_type || '普票', tax_rate || 0.06, invoice_no, 'pending', notes || ''])
  ok(res, { id, invoice_no, tax_amount: tax_amount.toFixed(2) })
})

app.patch('/api/finance/invoices/:id', (req, res) => {
  const { status, issued_at } = req.body || {}
  dbRun('UPDATE invoices SET status=?, issued_at=? WHERE id=?', [status, issued_at || dayjs().format('YYYY-MM-DD'), req.params.id])
  ok(res)
})

// ── 来访者购买记录（含周期） ───────────────────────────────
app.get('/api/clients/:id/purchases', (req, res) => {
  const { id } = req.params
  const rows = dbAll(`
    SELECT id, client_id, amount, type, payment_method, notes,
           package_sessions, package_remaining, status, created_at
    FROM payments
    WHERE client_id=? AND status='paid'
    ORDER BY created_at ASC
  `, [id])
  // 计算总购买次数和总剩余次数
  const totalBought = rows.reduce((s, r) => s + (r.package_sessions || 0), 0)
  const totalRemaining = rows.reduce((s, r) => s + (r.package_remaining || 0), 0)
  const cycle = rows.length
  const purchases = rows.map((r, i) => ({
    ...r,
    cycle: i + 1,
    isRenewal: i > 0,
    typeLabel: {
      initial: '初始访谈', single: '单次咨询', growth: '成长陪伴',
      relationship: '关系重建', resolution: '婚恋修复', session: '单次'
    }[r.type] || r.type || '套餐'
  }))
  ok(res, { cycle, totalBought, totalRemaining, purchases })
})

// ── 新增/续费购买记录 ────────────────────────────────────
app.post('/api/clients/:clientId/purchases', (req, res) => {
  const { clientId } = req.params
  const { amount, type, package_sessions, payment_method, notes } = req.body || {}
  if (!amount || !package_sessions) return err(res, '请填写金额和次数')
  const id = nanoid()
  const cid = 'default'
  dbRun(`INSERT INTO payments (id,client_id,consultant_id,amount,type,payment_method,notes,package_sessions,package_remaining,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, clientId, cid, amount, type || 'growth', payment_method || '', notes || '', package_sessions, package_sessions, 'paid', new Date().toISOString()])
  ok(res, { id })
})

// ── 更新来访者剩余次数（消耗一次咨询后调用）────────────
app.post('/api/clients/:id/use-session', (req, res) => {
  const { id } = req.params
  // 找最新的未用完的支付记录
  const row = dbGet(`SELECT id, package_remaining FROM payments WHERE client_id=? AND status='paid' AND package_remaining>0 ORDER BY created_at DESC LIMIT 1`, [id])
  if (!row) return err(res, '无剩余次数')
  const newRemaining = row.package_remaining - 1
  dbRun(`UPDATE payments SET package_remaining=? WHERE id=?`, [newRemaining, row.id])
  ok(res, { remaining: newRemaining })
})

// ══════════════════════════════════════════════════════════════
// 模块①：个案记录系统（SOAP笔记）
// ══════════════════════════════════════════════════════════════

// 获取来访者所有笔记（分页）
app.get('/api/cases/:clientId/notes', (req, res) => {
  const { clientId } = req.params
  const { page = 1, limit = 20, type } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  let sql = `SELECT cn.*, c.name as client_name, co.name as consultant_name
    FROM case_notes cn
    LEFT JOIN clients c ON cn.client_id=c.id
    LEFT JOIN consultants co ON cn.consultant_id=co.id
    WHERE cn.client_id=?`
  const params = [clientId]
  if (type) { sql += ' AND cn.type=?'; params.push(type) }
  const total = dbGet(`SELECT COUNT(*) as c FROM case_notes WHERE client_id=?${type ? ' AND type=?' : ''}`, type ? [clientId, type] : [clientId])
  sql += ` ORDER BY cn.created_at DESC LIMIT ? OFFSET ?`
  const rows = dbAll(sql, [...params, parseInt(limit), offset])
  rows.forEach(r => { try { if (r.attachments) r.attachments = JSON.parse(r.attachments) } catch {} })
  ok(res, { rows, total: total?.c || 0, page: parseInt(page), limit: parseInt(limit) })
})

// 新建SOAP笔记
app.post('/api/cases/:clientId/notes', (req, res) => {
  const { clientId } = req.params
  const { consultant_id, appointment_id, type, soap_s, soap_o, soap_a, soap_p, session_duration, content, cc, ph, hpi, mse, assessment, intervention } = req.body || {}
  if (!consultant_id) return err(res, 'consultant_id必填')
  const id = nanoid()
  dbRun(
    `INSERT INTO case_notes (id,client_id,consultant_id,appointment_id,type,soap_s,soap_o,soap_a,soap_p,session_duration,content,cc,ph,hpi,mse,assessment,intervention)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, clientId, consultant_id, appointment_id || null, type || 'progress',
     soap_s || '', soap_o || '', soap_a || '', soap_p || '',
     session_duration || 0, content || '', cc || '', ph || '', hpi || '', mse || '', assessment || '', intervention || '']
  )
  ok(res, { id })
})

// 关键词搜索笔记（必须注册在 /:noteId 之前，否则 /search 会被当作 noteId）
app.get('/api/cases/notes/search', (req, res) => {
  const { q, client_id, type, page = 1, limit = 20 } = req.query
  if (!q) return err(res, '关键词必填')
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const like = `%${q}%`
  const likeParams = [like, like, like, like, like, like, like]
  let sql = `SELECT cn.*, c.name as client_name
    FROM case_notes cn LEFT JOIN clients c ON cn.client_id=c.id
    WHERE (cn.content LIKE ? OR cn.soap_s LIKE ? OR cn.soap_o LIKE ? OR cn.soap_a LIKE ? OR cn.soap_p LIKE ? OR cn.assessment LIKE ? OR cn.intervention LIKE ?)`
  if (client_id) { sql += ' AND cn.client_id=?'; likeParams.push(client_id) }
  if (type) { sql += ' AND cn.type=?'; likeParams.push(type) }
  const total = dbGet(`SELECT COUNT(*) as c FROM case_notes cn WHERE (cn.content LIKE ? OR cn.soap_s LIKE ? OR cn.soap_o LIKE ? OR cn.soap_a LIKE ? OR cn.soap_p LIKE ? OR cn.assessment LIKE ? OR cn.intervention LIKE ?)${client_id ? ' AND cn.client_id=?' : ''}${type ? ' AND cn.type=?' : ''}`,
    client_id ? [like, like, like, like, like, like, like, client_id, ...(type ? [type] : [])] : [like, like, like, like, like, like, like, ...(type ? [type] : [])])
  sql += ` ORDER BY cn.created_at DESC LIMIT ? OFFSET ?`
  const rows = dbAll(sql, [...likeParams, parseInt(limit), offset])
  ok(res, { rows, total: total?.c || 0, page: parseInt(page), limit: parseInt(limit) })
})

// 单条笔记
app.get('/api/cases/notes/:noteId', (req, res) => {
  const { noteId } = req.params
  const row = dbGet(`SELECT cn.*, c.name as client_name, co.name as consultant_name
    FROM case_notes cn LEFT JOIN clients c ON cn.client_id=c.id LEFT JOIN consultants co ON cn.consultant_id=co.id
    WHERE cn.id=?`, [noteId])
  if (!row) return err(res, '笔记不存在', 404)
  try { if (row.attachments) row.attachments = JSON.parse(row.attachments) } catch {}
  ok(res, row)
})

// 更新笔记
app.put('/api/cases/notes/:noteId', (req, res) => {
  const { noteId } = req.params
  const f = req.body || {}
  const existing = dbGet('SELECT * FROM case_notes WHERE id=?', [noteId])
  if (!existing) return err(res, '笔记不存在', 404)
  if (existing.supervisor_id && existing.supervisor_id !== f.edited_by_supervisor) {
    return err(res, '督导模式下不可修改内容', 403)
  }
  const allowed = ['client_id','consultant_id','appointment_id','type','session_duration','soap_s','soap_o','soap_a','soap_p','content','cc','ph','hpi','mse','assessment','intervention','supervision_content','attachments']
  const sets = Object.keys(f).filter(k => allowed.includes(k)).map(k => `${k}=?`).join(',')
  if (!sets) return err(res, '无有效字段')
  dbRun(`UPDATE case_notes SET ${sets},updated_at=CURRENT_TIMESTAMP WHERE id=?`, [...Object.keys(f).filter(k => allowed.includes(k)).map(k => f[k]), noteId])
  okMsg(res, '已更新')
})

// 签名笔记
app.post('/api/cases/notes/:noteId/sign', (req, res) => {
  const { noteId } = req.params
  const existing = dbGet('SELECT * FROM case_notes WHERE id=?', [noteId])
  if (!existing) return err(res, '笔记不存在', 404)
  if (existing.signed) return err(res, '笔记已签名')
  dbRun(`UPDATE case_notes SET signed=1,signed_at=CURRENT_TIMESTAMP WHERE id=?`, [noteId])
  okMsg(res, '签名成功')
})

// 删除笔记
app.delete('/api/cases/notes/:noteId', (req, res) => {
  const existing = dbGet('SELECT * FROM case_notes WHERE id=?', [req.params.noteId])
  if (!existing) return err(res, '笔记不存在', 404)
  if (existing.signed) return err(res, '已签名笔记不可删除')
  dbRun('DELETE FROM case_notes WHERE id=?', [req.params.noteId])
  okMsg(res, '已删除')
})

// 获取上次笔记（续写参考）
app.get('/api/cases/:clientId/last-note', (req, res) => {
  const { clientId } = req.params
  const row = dbGet(`SELECT * FROM case_notes WHERE client_id=? ORDER BY created_at DESC LIMIT 1`, [clientId])
  ok(res, row || null)
})

// ══════════════════════════════════════════════════════════════
// 模块②：数据报表
// ══════════════════════════════════════════════════════════════

// 收入报表
app.get('/api/reports/income', (req, res) => {
  const { from, to, group = 'month', consultant_id } = req.query
  const cid = consultant_id || 'default'
  const fmt = group === 'year' ? '%Y' : group === 'quarter' ? '%Y-Q' || (q => q) : '%Y-%m'
  let sql = `SELECT `
  let dateExpr, dateGroup
  if (group === 'year') {
    dateExpr = `strftime('%Y', created_at) as period`
    dateGroup = `strftime('%Y', created_at)`
  } else if (group === 'quarter') {
    dateExpr = `strftime('%Y', created_at) || '-Q' || ((cast(strftime('%m', created_at) as integer) + 2) / 3) as period`
    dateGroup = `strftime('%Y', created_at) || '-Q' || ((cast(strftime('%m', created_at) as integer) + 2) / 3)`
  } else {
    dateExpr = `strftime('%Y-%m', created_at) as period`
    dateGroup = `strftime('%Y-%m', created_at)`
  }
  sql += `${dateExpr}, SUM(amount) as total, COUNT(*) as count FROM payments WHERE status='paid' AND consultant_id=?`
  const params = [cid]
  if (from) { sql += ' AND DATE(created_at)>=?'; params.push(from) }
  if (to) { sql += ' AND DATE(created_at)<=?'; params.push(to) }
  sql += ` GROUP BY ${dateGroup} ORDER BY period ASC`
  const rows = dbAll(sql, params)
  const grand = dbGet(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM payments WHERE status='paid' AND consultant_id=?${from ? ' AND DATE(created_at)>=?' : ''}${to ? ' AND DATE(created_at)<=?' : ''}`,
    to ? (from ? [cid, from, to] : [cid, to]) : (from ? [cid, from] : [cid]))
  ok(res, { rows, grand: grand || { total: 0, count: 0 } })
})

// 来访者报表
app.get('/api/reports/clients', (req, res) => {
  const { from, to } = req.query
  const newClients = dbGet(`SELECT COUNT(*) as c FROM clients WHERE 1=1${from ? ` AND DATE(created_at)>=?` : ''}${to ? ` AND DATE(created_at)<=?` : ''}`,
    to ? (from ? [from, to] : [to]) : (from ? [from] : []))
  const totalClients = dbGet('SELECT COUNT(*) as c FROM clients')
  const activeClients = dbGet(`SELECT COUNT(*) as c FROM clients WHERE status='active'`)
  const churned = dbGet(`SELECT COUNT(*) as c FROM clients WHERE status='inactive'`)
  const retention = totalClients?.c > 0 ? (((totalClients?.c - churned?.c) / totalClients?.c) * 100).toFixed(1) : '0.0'
  // 计算来自某时间段的新来访者比例
  const firstVisitClients = newClients?.c || 0
  const repeatRate = totalClients?.c > 0 ? (((totalClients?.c - firstVisitClients) / totalClients?.c) * 100).toFixed(1) : '0.0'
  ok(res, {
    newClients: firstVisitClients,
    totalClients: totalClients?.c || 0,
    activeClients: activeClients?.c || 0,
    churned: churned?.c || 0,
    retentionRate: parseFloat(retention),
    repeatRate: parseFloat(repeatRate)
  })
})

// 咨询工作量
app.get('/api/reports/consultant-workload', (req, res) => {
  const { from, to, consultant_id } = req.query
  const cid = consultant_id || 'default'
  let sql = `SELECT co.id, co.name, co.title,
    COUNT(DISTINCT ap.id) as total_appts,
    COUNT(DISTINCT CASE WHEN ap.status='completed' THEN ap.id END) as completed_appts,
    COUNT(DISTINCT CASE WHEN ap.status='cancelled' THEN ap.id END) as cancelled_appts,
    COUNT(DISTINCT cn.id) as total_notes,
    COUNT(DISTINCT CASE WHEN cn.signed=1 THEN cn.id END) as signed_notes,
    COUNT(DISTINCT cl.id) as total_clients
    FROM consultants co
    LEFT JOIN appointments ap ON ap.consultant_id=co.id${from ? " AND DATE(ap.scheduled_at)>=?" : ""}${to ? " AND DATE(ap.scheduled_at)<=?" : ""}
    LEFT JOIN case_notes cn ON cn.consultant_id=co.id${from ? " AND DATE(cn.created_at)>=?" : ""}${to ? " AND DATE(cn.created_at)<=?" : ""}
    LEFT JOIN clients cl ON cl.assigned_consultant_id=co.id
    WHERE co.status='active'${consultant_id ? ' AND co.id=?' : ''}
    GROUP BY co.id ORDER BY co.name ASC`
  const params = []
  if (consultant_id) params.push(consultant_id)
  if (from) params.push(from, from)
  if (to) params.push(to, to)
  const rows = dbAll(sql, params)
  ok(res, rows)
})

// 预约统计
app.get('/api/reports/appointments', (req, res) => {
  const { from, to } = req.query
  const params = []
  let where = '1=1'
  if (from) { where += ' AND DATE(scheduled_at)>=?'; params.push(from) }
  if (to) { where += ' AND DATE(scheduled_at)<=?'; params.push(to) }
  const total = dbGet(`SELECT COUNT(*) as c FROM appointments WHERE ${where}`, params)
  const completed = dbGet(`SELECT COUNT(*) as c FROM appointments WHERE ${where} AND status='completed'`, params)
  const cancelled = dbGet(`SELECT COUNT(*) as c FROM appointments WHERE ${where} AND status='cancelled'`, params)
  const confirmed = dbGet(`SELECT COUNT(*) as c FROM appointments WHERE ${where} AND status='confirmed'`, params)
  const inProgress = dbGet(`SELECT COUNT(*) as c FROM appointments WHERE ${where} AND status='in_progress'`, params)
  const noShow = dbGet(`SELECT COUNT(*) as c FROM appointments WHERE ${where} AND status='no_show'`, params)
  const t = total?.c || 0
  ok(res, {
    total: t,
    completed: completed?.c || 0,
    cancelled: cancelled?.c || 0,
    confirmed: confirmed?.c || 0,
    inProgress: inProgress?.c || 0,
    noShow: noShow?.c || 0,
    completionRate: t > 0 ? ((completed?.c || 0) / t * 100).toFixed(1) : '0.0',
    cancellationRate: t > 0 ? ((cancelled?.c || 0) / t * 100).toFixed(1) : '0.0',
    noShowRate: t > 0 ? ((noShow?.c || 0) / t * 100).toFixed(1) : '0.0'
  })
})

// 综合仪表盘
app.get('/api/reports/summary', (req, res) => {
  const cid = req.query.consultant_id || 'default'
  const today = dayjs().format('YYYY-MM-DD')
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD')
  const yearStart = dayjs().startOf('year').format('YYYY-MM-DD')
  const monthEnd = dayjs().endOf('month').format('YYYY-MM-DD')
  const todayAppts = dbGet(`SELECT COUNT(*) as c FROM appointments WHERE DATE(scheduled_at)=? AND consultant_id=?`, [today, cid])
  const weekAppts = dbGet(`SELECT COUNT(*) as c FROM appointments WHERE DATE(scheduled_at)>=? AND consultant_id=?`, [dayjs().startOf('week').format('YYYY-MM-DD'), cid])
  const monthAppts = dbGet(`SELECT COUNT(*) as c FROM appointments WHERE DATE(scheduled_at)>=? AND DATE(scheduled_at)<=? AND consultant_id=?`, [monthStart, monthEnd, cid])
  const monthIncome = dbGet(`SELECT COALESCE(SUM(amount),0) as t FROM payments WHERE status='paid' AND consultant_id=? AND DATE(created_at)>=?`, [cid, monthStart])
  const yearIncome = dbGet(`SELECT COALESCE(SUM(amount),0) as t FROM payments WHERE status='paid' AND consultant_id=? AND DATE(created_at)>=?`, [cid, yearStart])
  const totalClients = dbGet(`SELECT COUNT(*) as c FROM clients WHERE assigned_consultant_id=?`, [cid])
  const activeClients = dbGet(`SELECT COUNT(*) as c FROM clients WHERE assigned_consultant_id=? AND status='active'`, [cid])
  const pendingNotes = dbGet(`SELECT COUNT(*) as c FROM case_notes WHERE consultant_id=? AND signed=0`, [cid])
  const completedAppts = dbGet(`SELECT COUNT(*) as c FROM appointments WHERE consultant_id=? AND status='completed' AND DATE(scheduled_at)>=?`, [cid, monthStart])
  ok(res, {
    todayAppts: todayAppts?.c || 0,
    weekAppts: weekAppts?.c || 0,
    monthAppts: monthAppts?.c || 0,
    monthIncome: monthIncome?.t || 0,
    yearIncome: yearIncome?.t || 0,
    totalClients: totalClients?.c || 0,
    activeClients: activeClients?.c || 0,
    pendingNotes: pendingNotes?.c || 0,
    monthCompleted: completedAppts?.c || 0
  })
})

// ══════════════════════════════════════════════════════════════
// 模块③：预约排期系统
// ══════════════════════════════════════════════════════════════

// 获取咨询师可用时间
app.get('/api/consultants/:id/availability', (req, res) => {
  const { id } = req.params
  const rows = dbAll('SELECT * FROM consultant_availability WHERE consultant_id=? ORDER BY day_of_week ASC', [id])
  rows.forEach(r => { try { r.time_slots = JSON.parse(r.time_slots || '[]') } catch { r.time_slots = [] } })
  // 合并为周视图
  const week = {}
  ;[0,1,2,3,4,5,6].forEach(d => { week[d] = [] })
  rows.forEach(r => { week[r.day_of_week] = r.time_slots })
  ok(res, { week, raw: rows })
})

// 设置咨询师可用时间
app.put('/api/consultants/:id/availability', (req, res) => {
  const { id } = req.params
  const { week } = req.body || {} // { 0: [], 1: ["09:00-12:00"], ... }
  if (!week) return err(res, 'week配置必填')
  dbRun('DELETE FROM consultant_availability WHERE consultant_id=?', [id])
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  Object.entries(week).forEach(([dow, slots]) => {
    if (Array.isArray(slots) && slots.length > 0) {
      const availId = nanoid()
      dbRun('INSERT INTO consultant_availability (id,consultant_id,day_of_week,time_slots) VALUES (?,?,?,?)',
        [availId, id, parseInt(dow), JSON.stringify(slots)])
    }
  })
  okMsg(res, '可用时间已保存')
})

// 计算某日可预约时段
app.get('/api/slots', (req, res) => {
  const { date, consultantId, duration = 60 } = req.query
  if (!date || !consultantId) return err(res, 'date和consultantId必填')
  const dur = parseInt(duration)
  // 获取咨询师可用时间
  const dayOfWeek = new Date(date).getDay()
  const availRows = dbAll('SELECT * FROM consultant_availability WHERE consultant_id=? AND day_of_week=?', [consultantId, dayOfWeek])
  let availableSlots = []
  if (availRows.length > 0) {
    availRows.forEach(r => { try { availableSlots = availableSlots.concat(JSON.parse(r.time_slots || '[]')) } catch {} })
  }
  // 获取当日已预约
  const booked = dbAll(`SELECT scheduled_at, duration FROM appointments WHERE consultant_id=? AND DATE(scheduled_at)=? AND status NOT IN ('cancelled')`,
    [consultantId, date])
  // 生成所有可用时段（假设工作日 09:00-21:00 营业）
  const allSlots = []
  const defaultSlots = availableSlots.length > 0 ? availableSlots : ['09:00-12:00','14:00-18:00','19:00-21:00']
  defaultSlots.forEach(range => {
    const [startStr, endStr] = range.split('-')
    if (!startStr || !endStr) return
    const [sh, sm] = startStr.split(':').map(Number)
    const [eh, em] = endStr.split(':').map(Number)
    let cur = sh * 60 + sm
    const end = eh * 60 + em
    while (cur + dur <= end) {
      const slotStart = `${String(Math.floor(cur/60)).padStart(2,'0')}:${String(cur%60).padStart(2,'0')}`
      const slotEnd = `${String(Math.floor((cur+dur)/60)).padStart(2,'0')}:${String((cur+dur)%60).padStart(2,'0')}`
      allSlots.push({ start: slotStart, end: slotEnd })
      cur += 30 // 每30分钟一个时段
    }
  })
  // 过滤已预约时段
  const bookedSlots = booked.map(b => {
    const time = b.scheduled_at.split(' ')[1] || ''
    const [h, m] = time.split(':').map(Number)
    return { start: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`, duration: b.duration || 60 }
  })
  const freeSlots = allSlots.filter(slot => {
    const slotStart = slot.start
    return !bookedSlots.some(b => {
      const bStart = b.start
      const [bh, bm] = bStart.split(':').map(Number)
      const [eh, em] = bEnd = bStart.split(':').map(Number)
      const bEndMin = bh * 60 + bm + b.duration
      const sStart = parseInt(slotStart.split(':')[0])*60 + parseInt(slotStart.split(':')[1])
      const sEnd = parseInt(slot.end.split(':')[0])*60 + parseInt(slot.end.split(':')[1])
      return !(sEnd <= bh*60+bm || sStart >= bEndMin)
    })
  })
  ok(res, { date, availableSlots: defaultSlots, freeSlots })
})

// 创建预约（含冲突检测）
app.post('/api/appointments', (req, res) => {
  const { client_id, consultant_id, scheduled_at, duration, type } = req.body || {}
  if (!client_id || !consultant_id || !scheduled_at) return err(res, '参数不完整')
  const scheduledDate = scheduled_at.split('T')[0] || scheduled_at.split(' ')[0]
  const scheduledTime = scheduled_at.split('T')[1] || scheduled_at.split(' ')[1] || ''
  const [sh, sm] = (scheduledTime.split(':').slice(0,2)).map(Number)
  const startMin = sh * 60 + sm
  const dur = duration || 60
  const endMin = startMin + dur
  // 冲突检测
  const existing = dbAll(`SELECT * FROM appointments WHERE consultant_id=? AND DATE(scheduled_at)=? AND status NOT IN ('cancelled')`,
    [consultant_id, scheduledDate])
  const conflict = existing.find(e => {
    const et = e.scheduled_at.split(' ')[1] || ''
    const [eh, em] = (et.split(':').slice(0,2)).map(Number)
    const eStart = eh * 60 + em
    const eEnd = eStart + (e.duration || 60)
    return !(endMin <= eStart || startMin >= eEnd)
  })
  if (conflict) return err(res, `该时段已被预约（${conflict.scheduled_at}），请选择其他时间`, 409)
  const id = nanoid()
  const mid = Math.floor(100000000 + Math.random() * 900000000)
  const pwd = Math.floor(1000 + Math.random() * 9000).toString()
  const url = `https://meeting.tencent.com/w/meeting/${mid}`
  dbRun(
    `INSERT INTO appointments (id,client_id,consultant_id,scheduled_at,duration,type,meeting_url,meeting_id,meeting_password) VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, client_id, consultant_id, scheduled_at, dur, type || 'first', url, mid.toString(), pwd]
  )
  ok(res, { id, meeting_url: url, meeting_id: mid.toString(), password: pwd })
})

// 更新预约状态
app.put('/api/appointments/:id/status', (req, res) => {
  const { id } = req.params
  const { status } = req.body || {}
  const valid = ['scheduled','confirmed','in_progress','completed','cancelled','no_show']
  if (!valid.includes(status)) return err(res, `无效状态，可选：${valid.join(',')}`)
  const existing = dbGet('SELECT * FROM appointments WHERE id=?', [id])
  if (!existing) return err(res, '预约不存在', 404)
  dbRun('UPDATE appointments SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [status, id])
  okMsg(res, `状态已更新为：${status}`)
})

// 预约详情
app.get('/api/appointments/:id', (req, res) => {
  const { id } = req.params
  const row = dbGet(`SELECT a.*, c.name as client_name, co.name as consultant_name
    FROM appointments a LEFT JOIN clients c ON a.client_id=c.id LEFT JOIN consultants co ON a.consultant_id=co.id
    WHERE a.id=?`, [id])
  if (!row) return err(res, '预约不存在', 404)
  ok(res, row)
})

// ══════════════════════════════════════════════════════════════
// 模块④：评估报告生成
// ══════════════════════════════════════════════════════════════

// 量表名称映射
const SCALE_NAMES = {
  scl90: 'SCL-90症状清单', sas: '焦虑自评量表(SAS)', sds: '抑郁自评量表(SDS)',
  adhd: 'ADHD注意缺陷量表', psqi: '匹兹堡睡眠质量指数', mmpi: '明尼苏达人格测验',
  mbti: 'MBTI性格测试', ecr: '亲密关系经历量表(ECR-R)', pws: '产后抑郁筛查(PWS)',
  ls: '生活满意度量表(LS)', eqi: '情商测评(EQI)'
}

const SCALE_NORMS = {
  scl90: { total: { normal: 160, mild: 200, moderate: 250, severe: 300 }, dimensions: ['躯体化','强迫','人际关系','抑郁','焦虑','敌意','恐怖','偏执','精神病性','其他'] },
  sas: { normal: 50, mild: 60, moderate: 70, severe: 80 },
  sds: { normal: 53, mild: 62, moderate: 72, severe: 79 },
  adhd: { normal: 14, mild: 20, moderate: 26, severe: 31 },
  psqi: { good: 7, mild: 10, poor: 15 },
  ecr: { avoidance_low: 2.0, avoidance_high: 3.5, anxiety_low: 2.5, anxiety_high: 4.0 },
  pws: { normal: 10, mild: 15, moderate: 20, severe: 26 },
  ls: { dissatisfied: 15, neutral: 20, satisfied: 25 },
  eqi: { low: 80, average: 100, high: 120 }
}

// 来访者所有评估历史
app.get('/api/assessments/:clientId/history', (req, res) => {
  const { clientId } = req.params
  const { scale } = req.query
  let sql = `SELECT ar.*, c.name as client_name FROM assessment_results ar LEFT JOIN clients c ON ar.client_id=c.id WHERE ar.client_id=?`
  const params = [clientId]
  if (scale) { sql += ' AND ar.scale=?'; params.push(scale) }
  const rows = dbAll(sql + ' ORDER BY ar.submitted_at DESC', params)
  rows.forEach(r => {
    try { r.score = JSON.parse(r.score) } catch {}
    r.scale_name = SCALE_NAMES[r.scale] || r.scale
  })
  ok(res, rows)
})

// 最新评估报告
app.get('/api/assessments/:clientId/latest', (req, res) => {
  const { clientId } = req.params
  const rows = dbAll(`SELECT ar.*, c.name as client_name FROM assessment_results ar LEFT JOIN clients c ON ar.client_id=c.id WHERE ar.client_id=? ORDER BY ar.submitted_at DESC`, [clientId])
  // 按量表分组取最新
  const latest = {}
  rows.forEach(r => {
    if (!latest[r.scale]) {
      try { r.score = JSON.parse(r.score) } catch {}
      r.scale_name = SCALE_NAMES[r.scale] || r.scale
      latest[r.scale] = r
    }
  })
  ok(res, Object.values(latest))
})

// 单量表历次报告
app.get('/api/assessments/:clientId/report/:scale', (req, res) => {
  const { clientId, scale } = req.params
  const rows = dbAll(`SELECT ar.*, c.name as client_name FROM assessment_results ar LEFT JOIN clients c ON ar.client_id=c.id WHERE ar.client_id=? AND ar.scale=? ORDER BY ar.submitted_at ASC`, [clientId, scale])
  if (!rows.length) return err(res, '无该量表记录', 404)
  rows.forEach(r => { try { r.score = JSON.parse(r.score) } catch {} })
  const scaleName = SCALE_NAMES[scale] || scale
  const norms = SCALE_NORMS[scale] || {}
  // 生成进度曲线
  const curve = rows.map((r, i) => {
    const totalScore = typeof r.score === 'object' ? (r.score.total !== undefined ? r.score.total : Object.values(r.score).reduce((s, v) => s + (parseFloat(v) || 0), 0)) : parseFloat(r.score) || 0
    return { date: r.submitted_at, score: totalScore, level: r.level, index: i }
  })
  ok(res, { rows, scaleName, norms, curve })
})

// 生成可打印HTML评估报告
app.get('/api/assessments/report/:resultId', (req, res) => {
  const { resultId } = req.params
  const row = dbGet(`SELECT ar.*, c.name as client_name, co.name as consultant_name
    FROM assessment_results ar LEFT JOIN clients c ON ar.client_id=c.id LEFT JOIN consultants co ON ar.consultant_id=co.id
    WHERE ar.id=?`, [resultId])
  if (!row) return err(res, '评估记录不存在', 404)
  let score
  try { score = typeof row.score === 'string' ? JSON.parse(row.score) : row.score } catch { score = {} }
  const scaleName = SCALE_NAMES[row.scale] || row.scale
  const submittedAt = dayjs(row.submitted_at).format('YYYY-MM-DD HH:mm')
  const levelLabel = { normal: '正常', mild: '轻度异常', moderate: '中度异常', severe: '重度异常', good: '睡眠良好', poor: '睡眠较差', dissatisfied: '不满意', satisfied: '满意', low: '较低', average: '中等', high: '较高', high_anxiety: '高焦虑', low_anxiety: '低焦虑', high_avoidance: '高回避', low_avoidance: '低回避' }
  const level = row.level || ''
  const levelText = levelLabel[level] || level || ''
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${scaleName}评估报告</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'PingFang SC','Microsoft YaHei',sans-serif; background:#f5f3ff; padding:32px; color:#1a1a2e; }
  .report { max-width:800px; margin:0 auto; background:#fff; border-radius:16px; padding:40px; box-shadow:0 4px 20px rgba(124,106,247,0.15); }
  .header { text-align:center; border-bottom:2px solid #e8e4ff; padding-bottom:24px; margin-bottom:32px; }
  .header h1 { font-size:24px; color:#7c6af7; margin-bottom:8px; }
  .header .meta { font-size:13px; color:#8b8b9e; }
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:28px; }
  .info-item { background:#f5f3ff; border-radius:8px; padding:12px 16px; }
  .info-item label { font-size:11px; color:#8b8b9e; display:block; margin-bottom:4px; }
  .info-item span { font-size:14px; font-weight:600; }
  .score-section { margin-bottom:28px; }
  .score-section h3 { font-size:15px; color:#7c6af7; margin-bottom:16px; border-left:3px solid #7c6af7; padding-left:10px; }
  .score-bar { margin-bottom:12px; }
  .score-bar .label { display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px; }
  .score-bar .bar { height:12px; background:#f5f3ff; border-radius:6px; overflow:hidden; }
  .score-bar .fill { height:100%; border-radius:6px; transition:width 0.5s; }
  .level-badge { display:inline-block; padding:6px 20px; border-radius:20px; font-size:14px; font-weight:700; margin-top:12px; }
  .level-normal { background:#dcfce7; color:#166534; }
  .level-mild { background:#fef9c3; color:#854d0e; }
  .level-moderate { background:#fed7aa; color:#9a3412; }
  .level-severe { background:#fecaca; color:#991b1b; }
  .level-good { background:#dcfce7; color:#166534; }
  .level-poor { background:#fecaca; color:#991b1b; }
  .dimensions { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin-top:16px; }
  .dim-item { background:#f9f8ff; border-radius:8px; padding:10px 14px; font-size:13px; }
  .dim-item .name { color:#8b8b9e; margin-bottom:4px; }
  .dim-item .value { font-weight:600; font-size:15px; color:#1a1a2e; }
  .footer { margin-top:32px; text-align:center; font-size:12px; color:#8b8b9e; border-top:1px solid #e8e4ff; padding-top:20px; }
  @media print { body { background:#fff; padding:0; } .report { box-shadow:none; } }
</style>
</head>
<body>
<div class="report">
  <div class="header">
    <h1>🧠 ${scaleName}评估报告</h1>
    <div class="meta">生成时间：${new Date().toLocaleString('zh-CN')}</div>
  </div>
  <div class="info-grid">
    <div class="info-item"><label>来访者</label><span>${row.client_name || '未记录'}</span></div>
    <div class="info-item"><label>评估师</label><span>${row.consultant_name || '未记录'}</span></div>
    <div class="info-item"><label>评估日期</label><span>${submittedAt}</span></div>
    <div class="info-item"><label>量表</label><span>${scaleName}</span></div>
  </div>
  <div class="score-section">
    <h3>📊 总分与等级</h3>
    ${typeof score === 'object' && score.total !== undefined ? `
    <div class="score-bar">
      <div class="label"><span>总分</span><span>${score.total}分</span></div>
      <div class="bar"><div class="fill" style="width:${Math.min((score.total / 300) * 100, 100)}%;background:#7c6af7;"></div></div>
    </div>` : ''}
    ${Object.entries(score).filter(([k]) => !['total','raw','标准分','原始分'].includes(k)).slice(0,10).map(([k, v]) => `
    <div class="dimensions">
      <div class="dim-item"><div class="name">${k}</div><div class="value">${v}分</div></div>
    </div>`).join('')}
    <div style="margin-top:16px;">
      <span class="level-badge level-${level || 'normal'}">${levelText || '未评定'}等级</span>
    </div>
  </div>
  ${Object.keys(score).length > 1 ? `
  <div class="score-section">
    <h3>📋 各维度得分</h3>
    <div class="dimensions">
      ${Object.entries(score).filter(([k]) => !['total','raw','标准分','原始分'].includes(k)).map(([k, v]) => `
      <div class="dim-item"><div class="name">${k}</div><div class="value">${v}</div></div>`).join('')}
    </div>
  </div>` : ''}
  <div class="footer">
    <p>本报告由茉莉心理咨询工作室生成 · Jasmine Counseling Studio</p>
    <p>仅供临床参考，不作为医学诊断依据</p>
  </div>
</div>
</body>
</html>`
  res.type('html').send(html)
})
