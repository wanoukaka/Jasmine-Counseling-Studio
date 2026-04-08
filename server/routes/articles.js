/**
 * 心理资讯路由
 * routes/articles.js
 * 数据来源：server/db/articles.json（每日由 cron 自动更新）
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { nanoid } from 'nanoid'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ARTICLES_FILE = join(__dirname, '../db/articles.json')

// ── 文件读写 ────────────────────────────────────────────
function readArticles() {
  if (!existsSync(ARTICLES_FILE)) return { last_updated: '', daily_featured_id: null, articles: [] }
  try {
    return JSON.parse(readFileSync(ARTICLES_FILE, 'utf-8'))
  } catch {
    return { last_updated: '', daily_featured_id: null, articles: [] }
  }
}

function writeArticles(data) {
  writeFileSync(ARTICLES_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

export default async function articlesRoutes(app) {

  // GET /api/articles  - 获取全部文章（支持分类筛选）
  app.get('/api/articles', (req, res) => {
    const { cat } = req.query || {}
    const db = readArticles()
    let articles = db.articles || []

    // 按日期倒序
    articles = [...articles].sort((a, b) => b.date.localeCompare(a.date))

    if (cat && cat !== 'all') {
      articles = articles.filter(a => a.cat === cat)
    }

    // 注入今日推荐标记
    const today = new Date().toISOString().slice(0, 10)
    const lastUpdated = db.last_updated

    articles = articles.map(a => ({
      ...a,
      isToday: a.date === today,
      isFeatured: a.id === db.daily_featured_id
    }))

    res.json({
      code: 0,
      data: {
        articles,
        lastUpdated,
        dailyFeaturedId: db.daily_featured_id,
        total: articles.length
      }
    })
  })

  // GET /api/articles/featured - 获取今日推荐
  app.get('/api/articles/featured', (req, res) => {
    const db = readArticles()
    const featured = db.articles.find(a => a.id === db.daily_featured_id)
    if (!featured) return res.status(404).json({ code: 404, message: '今日推荐不存在' })
    res.json({
      code: 0,
      data: {
        ...featured,
        isToday: featured.date === new Date().toISOString().slice(0, 10)
      }
    })
  })

  // GET /api/articles/:id - 获取单篇文章
  app.get('/api/articles/:id', (req, res) => {
    const db = readArticles()
    const article = db.articles.find(a => a.id === parseInt(req.params.id))
    if (!article) return res.status(404).json({ code: 404, message: '文章不存在' })
    res.json({ code: 0, data: article })
  })

  // POST /api/articles - 手动新增文章（管理端）
  app.post('/api/articles', (req, res) => {
    const { title, cat, tag, excerpt, content, author, isFeatured } = req.body || {}
    if (!title || !cat) return res.status(400).json({ code: -1, message: 'title 和 cat 必填' })

    const db = readArticles()
    const today = new Date().toISOString().slice(0, 10)
    const tagMap = { emotion: { label: '情绪管理', class: 'tag-emotion' }, love: { label: '婚恋心理', class: 'tag-love' }, family: { label: '原生家庭', class: 'tag-family' }, growth: { label: '自我成长', class: 'tag-growth' } }
    const tagInfo = tagMap[cat] || { label: tag || cat, class: 'tag-emotion' }

    const newArticle = {
      id: Date.now(),
      cat,
      tag: tag || tagInfo.label,
      tagClass: tagInfo.class,
      title,
      date: today,
      author: author || '王琳老师',
      excerpt: excerpt || '',
      content: content || '',
      isFeatured: !!isFeatured
    }

    db.articles.unshift(newArticle)
    db.last_updated = today
    if (isFeatured) db.daily_featured_id = newArticle.id
    writeArticles(db)

    res.json({ code: 0, data: { id: newArticle.id } })
  })

  // POST /api/articles/daily-update - 每日更新（由 cron 调用）
  // Body: { title, cat, excerpt, content, source }
  app.post('/api/articles/daily-update', (req, res) => {
    const { title, cat, excerpt, content, source } = req.body || {}
    if (!title || !cat) return res.status(400).json({ code: -1, message: 'title 和 cat 必填' })

    const db = readArticles()
    const today = new Date().toISOString().slice(0, 10)

    // 如果今天已有文章，不重复添加（可强制覆盖）
    const existingToday = db.articles.find(a => a.date === today)
    if (existingToday) {
      return res.json({
        code: 0,
        data: { skipped: true, existingId: existingToday.id, message: '今日文章已存在，如需更新请先删除' }
      })
    }

    const tagMap = { emotion: { label: '情绪管理', class: 'tag-emotion' }, love: { label: '婚恋心理', class: 'tag-love' }, family: { label: '原生家庭', class: 'tag-family' }, growth: { label: '自我成长', class: 'tag-growth' } }
    const tagInfo = tagMap[cat] || { label: cat, class: 'tag-emotion' }

    const newArticle = {
      id: Date.now(),
      cat,
      tag: tagInfo.label,
      tagClass: tagInfo.class,
      title,
      date: today,
      author: '王琳老师',
      excerpt: excerpt || '',
      content: content || '',
      isFeatured: true,
      source: source || 'Psychology Today'
    }

    // 取消旧的 featured
    db.articles.forEach(a => { a.isFeatured = false })
    db.articles.unshift(newArticle)
    db.last_updated = today
    db.daily_featured_id = newArticle.id

    // 最多保留 30 篇
    if (db.articles.length > 30) {
      db.articles = db.articles.slice(0, 30)
    }

    writeArticles(db)
    res.json({ code: 0, data: { id: newArticle.id, title: newArticle.title, date: today } })
  })

  // GET /api/articles/status - 获取文章库状态
  app.get('/api/articles/status', (req, res) => {
    const db = readArticles()
    const today = new Date().toISOString().slice(0, 10)
    res.json({
      code: 0,
      data: {
        lastUpdated: db.last_updated,
        totalArticles: db.articles.length,
        todayArticleId: db.articles.find(a => a.date === today)?.id || null,
        dailyFeaturedId: db.daily_featured_id,
        needsUpdate: db.last_updated !== today
      }
    })
  })
}
