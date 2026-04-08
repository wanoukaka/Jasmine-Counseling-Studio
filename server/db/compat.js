// db/compat.js
// better-sqlite3 兼容层，让 sql.js 支持 db.prepare().all/get/run API
export function createCompatLayer(db, saveDb) {
  function dbAll(sql, ...params) {
    const result = db.exec(sql)
    if (!result.length) return []
    const { columns, values } = result[0]
    return values.map(row => {
      const obj = {}
      columns.forEach((col, i) => { obj[col] = row[i] })
      return obj
    })
  }

  function dbGet(sql, ...params) {
    const rows = dbAll(sql, ...params)
    return rows[0] || null
  }

  function dbRun(sql, ...params) {
    // sql.js run() takes [params] as array
    db.run(sql, params.length ? params : undefined)
    if (saveDb) saveDb()
  }

  function dbPrepare(sql) {
    return {
      all: (...params) => dbAll(sql, ...params),
      get: (...params) => dbGet(sql, ...params),
      run: (...params) => dbRun(sql, ...params),
    }
  }

  return {
    run: dbRun,
    all: dbAll,
    get: dbGet,
    raw: db,
    exec: (sql) => dbRun(sql),
    prepare: dbPrepare,
  }
}
