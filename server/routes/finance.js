/**
 * 财务与税务管理路由
 * routes/finance.js
 */
import { nanoid } from 'nanoid'
import dayjs from 'dayjs'

export default async function financeRoutes(fastify) {

  // ── 收入统计 ────────────────────────────────────────
  fastify.get('/api/finance/income', async (req) => {
    const { consultant_id, period } = req.query || {}
    const cid = consultant_id || 'default'
    const now = dayjs()

    const buildRange = (unit) => {
      const start = now.startOf(unit).format('YYYY-MM-DD')
      const end = now.endOf(unit).format('YYYY-MM-DD')
      return { start, end }
    }

    const incomeByPeriod = async (unit) => {
      const { start, end } = buildRange(unit)
      const rows = fastify.db.prepare(`
        SELECT DATE(created_at) as date, SUM(amount) as total, COUNT(*) as count
        FROM payments
        WHERE consultant_id = ? AND status = 'paid'
          AND DATE(created_at) BETWEEN ? AND ?
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `).all(cid, start, end)
      return rows
    }

    const query = (unit) => fastify.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
      FROM payments
      WHERE consultant_id = ? AND status = 'paid'
        AND DATE(created_at) BETWEEN ? AND ?
    `).get(cid, buildRange(unit).start, buildRange(unit).end)

    const daily    = await incomeByPeriod('day')
    const weekly   = await incomeByPeriod('week')
    const monthly  = await incomeByPeriod('month')
    const quarter  = await incomeByPeriod('quarter')
    const halfYear = await incomeByPeriod('halfYear')
    const yearly   = await incomeByPeriod('year')

    const totals = {
      daily:   query('day'),
      weekly:  query('week'),
      monthly: query('month'),
      quarter: query('quarter'),
      halfYear,
      yearly:  query('year'),
    }

    // 本周/本月/本季度第一天
    const currentWeekStart = now.startOf('week').format('YYYY-MM-DD')
    const currentMonthStart = now.startOf('month').format('YYYY-MM-DD')
    const currentQuarterStart = now.startOf('quarter').format('YYYY-MM-DD')
    const currentHalfStart = now.subtract(6, 'month').startOf('month').format('YYYY-MM-DD')
    const currentYearStart = now.startOf('year').format('YYYY-MM-DD')

    const historicalMonthly = fastify.db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month,
             SUM(amount) as total,
             COUNT(*) as count
      FROM payments
      WHERE consultant_id = ? AND status = 'paid'
        AND created_at >= DATE('now', '-12 months')
      GROUP BY strftime('%Y-%m', created_at)
      ORDER BY month ASC
    `).all(cid)

    return {
      code: 0,
      data: {
        period,
        totals,
        daily,
        weekly,
        monthly,
        quarter,
        halfYear,
        yearly,
        historicalMonthly,
        currency: 'CNY',
        currencySymbol: '¥',
        updatedAt: now.format('YYYY-MM-DD HH:mm:ss'),
      }
    }
  })

  // ── 来访者付费记录 ─────────────────────────────────
  fastify.get('/api/finance/client-payments', async (req) => {
    const { consultant_id } = req.query || {}
    const cid = consultant_id || 'default'
    const rows = fastify.db.prepare(`
      SELECT p.*, c.name as client_name
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.consultant_id = ?
      ORDER BY p.created_at DESC
      LIMIT 100
    `).all(cid)
    return { code: 0, data: rows }
  })

  // ── 套餐/卡到期提醒 ───────────────────────────────
  fastify.get('/api/finance/expiring-packages', async (req) => {
    const { consultant_id } = req.query || {}
    const cid = consultant_id || 'default'
    const rows = fastify.db.prepare(`
      SELECT p.*, c.name as client_name
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.consultant_id = ?
        AND p.type = 'package'
        AND p.package_remaining > 0
        AND p.created_at >= DATE('now', '-6 months')
      ORDER BY p.created_at DESC
    `).all(cid)
    return { code: 0, data: rows }
  })

  // ── 新增付费记录 ─────────────────────────────────
  fastify.post('/api/finance/payments', async (req) => {
    const { client_id, consultant_id, amount, type, package_sessions, payment_method, notes } = req.body || {}
    if (!client_id || !amount) return { code: -1, message: '参数不完整' }
    const id = nanoid()
    const cid = consultant_id || 'default'
    fastify.db.prepare(`
      INSERT INTO payments (id, client_id, consultant_id, amount, type, package_sessions, package_remaining, payment_method, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, client_id, cid, amount, type || 'session', package_sessions || null, package_sessions || null, payment_method || '', notes || '')

    // 生成电子收据
    const receipt = await generateReceipt(id, client_id, amount, type, payment_method)
    return { code: 0, data: { id, receipt } }
  })

  // ── 电子收据生成 ─────────────────────────────────
  async function generateReceipt(paymentId, clientId, amount, type, method) {
    const payment = fastify.db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId)
    const client = fastify.db.prepare('SELECT name, phone FROM clients WHERE id = ?').get(clientId)
    const consultant = fastify.db.prepare('SELECT name, fee FROM consultants WHERE id = ?').get(payment?.consultant_id || 'default')
    const receiptNo = `RCPT-${dayjs().format('YYYYMMDD')}-${paymentId.slice(0, 6).toUpperCase()}`
    return {
      receiptNo,
      date: dayjs().format('YYYY-MM-DD HH:mm'),
      clientName: client?.name || '',
      clientPhone: client?.phone || '',
      consultantName: consultant?.name || '',
      amount: parseFloat(amount),
      amountCN: `${parseFloat(amount).toFixed(2)} 元`,
      type: type === 'package' ? '套餐' : type === 'deposit' ? '定金' : '单次咨询',
      method: method === 'wechat' ? '微信' : method === 'alipay' ? '支付宝' : method === 'transfer' ? '银行转账' : '现金',
      remark: '',
    }
  }

  // ── 微信兼职会计推送 ─────────────────────────────
  fastify.post('/api/finance/wechat-report', async (req) => {
    const { consultant_id, period } = req.query || {}
    const cid = consultant_id || 'default'
    const periodVal = period || 'weekly'

    const now = dayjs()
    let startDate, endDate, periodName
    if (periodVal === 'daily') {
      startDate = now.startOf('day').format('YYYY-MM-DD')
      endDate = now.endOf('day').format('YYYY-MM-DD')
      periodName = '今日'
    } else if (periodVal === 'weekly') {
      startDate = now.startOf('week').format('YYYY-MM-DD')
      endDate = now.endOf('day').format('YYYY-MM-DD')
      periodName = '本周'
    } else if (periodVal === 'monthly') {
      startDate = now.startOf('month').format('YYYY-MM-DD')
      endDate = now.endOf('month').format('YYYY-MM-DD')
      periodName = '本月'
    } else {
      startDate = now.startOf('year').format('YYYY-MM-DD')
      endDate = now.endOf('year').format('YYYY-MM-DD')
      periodName = '本年'
    }

    const income = fastify.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
      FROM payments WHERE consultant_id = ? AND status = 'paid'
        AND DATE(created_at) BETWEEN ? AND ?
    `).get(cid, startDate, endDate)

    const newClients = fastify.db.prepare(`
      SELECT COUNT(*) as c FROM clients
      WHERE assigned_consultant_id = ?
        AND DATE(created_at) BETWEEN ? AND ?
    `).get(cid, startDate, endDate)

    const newCases = fastify.db.prepare(`
      SELECT COUNT(*) as c FROM case_notes
      WHERE consultant_id = ?
        AND DATE(created_at) BETWEEN ? AND ?
    `).get(cid, startDate, endDate)

    const paymentList = fastify.db.prepare(`
      SELECT p.*, c.name as client_name
      FROM payments p LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.consultant_id = ? AND p.status = 'paid'
        AND DATE(p.created_at) BETWEEN ? AND ?
      ORDER BY p.created_at DESC
    `).all(cid, startDate, endDate)

    // 生成报告
    const report = {
      periodName,
      periodLabel: `${startDate} ~ ${endDate}`,
      totalIncome: parseFloat(income.total).toFixed(2),
      sessionCount: income.count,
      newClients: newClients.c,
      newCaseNotes: newCases.c,
      payments: paymentList.map(p => ({
        date: p.created_at?.slice(0, 10),
        client: p.client_name,
        amount: parseFloat(p.amount).toFixed(2),
        type: p.type === 'package' ? '套餐' : p.type === 'deposit' ? '定金' : '单次',
        method: p.payment_method === 'wechat' ? '微信' : p.payment_method === 'alipay' ? '支付宝' : '其他',
      })),
      generatedAt: now.format('YYYY-MM-DD HH:mm:ss'),
      consultant: fastify.db.prepare('SELECT name FROM consultants WHERE id = ?').get(cid)?.name || '',
    }

    // 推送至微信（通过飞书机器人中转，或直接调用微信推送）
    const wechatResult = await pushWechatReport(report)
    return { code: 0, data: { report, pushed: wechatResult } }
  })

  // ── 微信推送（使用微信测试号 / 公众号模板消息）────────────
  async function pushWechatReport(report) {
    // 方案1：飞书机器人推送（主人已有配置）
    const feishuWebhook = process.env.FEISHU_WEBHOOK_URL
    if (feishuWebhook) {
      const msg = `📊 财务汇报【${report.periodName}】
━━━━━━━━━━━━━━━━━
💰 总收入：¥${report.totalIncome}
🧾 收款笔数：${report.sessionCount} 笔
👤 新来访者：${report.newClients} 人
📝 新个案记录：${report.newCaseNotes} 份
━━━━━━━━━━━━━━━━━
🏦 收款明细：
${report.payments.map(p => `• ${p.date} ${p.client} ¥${p.amount}（${p.method}）`).join('\n')}
━━━━━━━━━━━━━━━━━
⏰ 汇报时间：${report.generatedAt}
由 Jasmine Counseling Studio 自动生成`
      try {
        await fetch(feishuWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msg_type: 'text', content: { text: msg } })
        })
        return { via: 'feishu', success: true }
      } catch (e) {
        return { via: 'feishu', success: false, reason: e.message }
      }
    }
    return { success: false, reason: '未配置飞书 Webhook' }
  }

  // ── 定时任务：自动发送定期报告 ───────────────────────
  // 注意：定时任务由后端 Cron 或外部调度器触发
  fastify.post('/api/finance/auto-report', async (req) => {
    const { consultant_id, period } = req.body || {}
    const cid = consultant_id || 'default'
    // 复用 wechat-report 逻辑
    return fastify.inject({
      method: 'GET',
      url: `/api/finance/wechat-report?consultant_id=${cid}&period=${period || 'weekly'}`
    })
  })

  // ── 发票管理 ───────────────────────────────────────
  fastify.get('/api/finance/invoices', async (req) => {
    const { consultant_id, status } = req.query || {}
    const cid = consultant_id || 'default'
    let sql = 'SELECT * FROM invoices WHERE consultant_id = ?'
    const params = [cid]
    if (status) { sql += ' AND status = ?'; params.push(status) }
    sql += ' ORDER BY created_at DESC LIMIT 100'
    return { code: 0, data: fastify.db.prepare(sql).all(...params) }
  })

  fastify.post('/api/finance/invoices', async (req) => {
    const { client_id, consultant_id, amount, invoice_type, tax_rate, notes } = req.body || {}
    if (!amount) return { code: -1, message: '金额必填' }
    const cid = consultant_id || 'default'
    const id = nanoid()
    const tax_amount = parseFloat(amount) * (1 + (tax_rate || 0.06))
    const invoice_no = `INV-${dayjs().format('YYYYMM')}-${id.slice(0, 6).toUpperCase()}`
    fastify.db.prepare(`
      INSERT INTO invoices (id, client_id, consultant_id, amount, tax_amount, invoice_type, tax_rate, invoice_no, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, client_id || '', cid, amount, tax_amount, invoice_type || '普票', tax_rate || 0.06, invoice_no, notes || '')
    return { code: 0, data: { id, invoice_no, tax_amount: tax_amount.toFixed(2) } }
  })

  fastify.patch('/api/finance/invoices/:id', async (req) => {
    const { id } = req.params
    const { status, issued_at } = req.body || {}
    fastify.db.prepare(
      'UPDATE invoices SET status = ?, issued_at = ? WHERE id = ?'
    ).run(status, issued_at || dayjs().format('YYYY-MM-DD'), id)
    return { code: 0 }
  })
}
