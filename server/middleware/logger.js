/**
 * 请求日志中间件
 * 记录所有API请求，便于调试和监控
 */
import dayjs from 'dayjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_FILE = path.join(__dirname, '..', 'request.log')

// 颜色代码（控制台输出用）
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
}

// 日志级别颜色
const levelColor = {
  INFO: colors.green,
  WARN: colors.yellow,
  ERROR: colors.red,
  DEBUG: colors.gray
}

export function requestLogger(req, res, next) {
  const start = Date.now()
  const requestId = Math.random().toString(36).substring(2, 10)
  
  // 请求开始时的日志
  const logEntry = {
    requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent') || 'unknown',
    time: dayjs().format('YYYY-MM-DD HH:mm:ss')
  }
  
  // 拦截响应
  const originalSend = res.send
  res.send = function(body) {
    const duration = Date.now() - start
    const status = res.statusCode
    
    // 构建日志
    const level = status >= 500 ? 'ERROR' : 
                 status >= 400 ? 'WARN' : 
                 'INFO'
    
    const logLine = {
      ...logEntry,
      status,
      duration: `${duration}ms`,
      responseSize: body ? body.length : 0,
      level
    }
    
    // 输出到控制台
    const color = levelColor[level]
    console.log(
      `${color}[${level}]${colors.reset} ` +
      `${colors.cyan}${requestId}${colors.reset} ` +
      `${req.method} ${req.path} ` +
      `${status >= 400 ? colors.red : colors.green}${status}${colors.reset} ` +
      `${duration}ms ` +
      `${colors.gray}${req.ip}${colors.reset}`
    )
    
    // 写入文件（异步，不阻塞响应）
    try {
      const logLineStr = JSON.stringify(logLine) + '\n'
      fs.appendFileSync(LOG_FILE, logLineStr)
    } catch (e) {
      // 忽略文件写入错误
    }
    
    return originalSend.call(this, body)
  }
  
  next()
}

// 日志查询工具函数
export function queryLogs(options = {}) {
  const { method, path, status, startDate, endDate, limit = 100 } = options
  
  try {
    if (!fs.existsSync(LOG_FILE)) return []
    
    const logs = fs.readFileSync(LOG_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line) } 
        catch { return null }
      })
      .filter(Boolean)
    
    let filtered = logs
    
    if (method) {
      filtered = filtered.filter(l => l.method === method)
    }
    if (path) {
      filtered = filtered.filter(l => l.path.includes(path))
    }
    if (status) {
      filtered = filtered.filter(l => l.status === status)
    }
    if (startDate) {
      filtered = filtered.filter(l => l.time >= startDate)
    }
    if (endDate) {
      filtered = filtered.filter(l => l.time <= endDate)
    }
    
    return filtered.slice(-limit)
  } catch (e) {
    return []
  }
}
