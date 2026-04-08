-- Jasmine Counseling Studio 数据库表结构
-- SQLite 3

-- 咨询师表
CREATE TABLE IF NOT EXISTS consultants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    specialties TEXT DEFAULT '[]',
    fee REAL DEFAULT 600,
    availability TEXT DEFAULT '{}',
    feishu_webhook TEXT DEFAULT '',
    wechat_id TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 来访者表
CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    gender TEXT DEFAULT '',
    age INTEGER,
    occupation TEXT DEFAULT '',
    source TEXT DEFAULT '',
    channel_code TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    emergency_name TEXT DEFAULT '',
    emergency_phone TEXT DEFAULT '',
    assigned_consultant_id TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_consultant_id) REFERENCES consultants(id)
);

-- 预约表
CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    consultant_id TEXT NOT NULL,
    scheduled_at DATETIME NOT NULL,
    duration INTEGER DEFAULT 60,
    type TEXT DEFAULT 'first',  -- first / follow_up / supervision
    meeting_url TEXT DEFAULT '',
    meeting_id TEXT DEFAULT '',
    meeting_password TEXT DEFAULT '',
    status TEXT DEFAULT 'scheduled',  -- scheduled / confirmed / in_progress / completed / cancelled / no_show
    reminder_24h BOOLEAN DEFAULT 0,
    reminder_1h BOOLEAN DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (consultant_id) REFERENCES consultants(id)
);

-- 个案记录表
CREATE TABLE IF NOT EXISTS case_notes (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    consultant_id TEXT NOT NULL,
    appointment_id TEXT,
    type TEXT DEFAULT 'progress',  -- initial / progress / supervision / assessment
    content TEXT DEFAULT '',
    cc TEXT DEFAULT '',    -- 主诉（Chief Complaint）
    ph TEXT DEFAULT '',    -- 个人史（Personal History）
    hpi TEXT DEFAULT '',  -- 现病史（History of Present Illness）
    mse TEXT DEFAULT '',  -- 精神状态检查（Mental Status Examination）
    assessment TEXT DEFAULT '',  -- 评估印象
    intervention TEXT DEFAULT '',  -- 干预计划
    attachments TEXT DEFAULT '[]',  -- JSON: [{name, url, size}]
    supervisor_id TEXT,
    supervision_content TEXT DEFAULT '',
    signed INTEGER DEFAULT 0,
    signed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (consultant_id) REFERENCES consultants(id),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);

-- 督导日程表
CREATE TABLE IF NOT EXISTS supervision_schedules (
    id TEXT PRIMARY KEY,
    consultant_id TEXT NOT NULL,
    supervisor_name TEXT DEFAULT '',
    scheduled_at DATETIME NOT NULL,
    duration INTEGER DEFAULT 90,
    topic TEXT DEFAULT '',
    meeting_url TEXT DEFAULT '',
    feishu_doc_url TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'scheduled',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (consultant_id) REFERENCES consultants(id)
);

-- 合同表
CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    consultant_id TEXT NOT NULL,
    type TEXT DEFAULT 'intake',  -- intake / continuation / confidentiality / other
    title TEXT DEFAULT '',
    content TEXT DEFAULT '',
    sign_flow_id TEXT DEFAULT '',
    sign_url TEXT DEFAULT '',
    signed INTEGER DEFAULT 0,
    signed_at DATETIME,
    expires_at DATETIME,
    status TEXT DEFAULT 'pending',  -- pending / sent / signed / rejected / expired
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (consultant_id) REFERENCES consultants(id)
);

-- 付费记录表
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    consultant_id TEXT NOT NULL,
    appointment_id TEXT,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'CNY',
    type TEXT DEFAULT 'session',  -- session / package / deposit / refund
    package_sessions INTEGER,
    package_remaining INTEGER,
    payment_method TEXT DEFAULT '',  -- alipay / wechat / cash / transfer
    transaction_id TEXT DEFAULT '',
    status TEXT DEFAULT 'paid',  -- pending / paid / refunded / failed
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (consultant_id) REFERENCES consultants(id)
);

-- 渠道追踪表
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    platform TEXT DEFAULT '',  -- xiaohongshu / douyin / zhihu / wechat / other
    description TEXT DEFAULT '',
    qrcode_url TEXT DEFAULT '',
    click_count INTEGER DEFAULT 0,
    register_count INTEGER DEFAULT 0,
    conversion_rate REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 来访者初始评估表（心理咨询登记问卷）
CREATE TABLE IF NOT EXISTS intake_forms (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    consultant_id TEXT NOT NULL,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- 自动追踪
    serial_no TEXT,
    source_channel TEXT NOT NULL,

    -- 基本信息
    title TEXT DEFAULT '',
    gender TEXT DEFAULT '',
    age TEXT DEFAULT '',
    phone TEXT NOT NULL,
    city TEXT DEFAULT '',
    chief_complaint TEXT DEFAULT '',

    -- 家庭背景
    caregiver TEXT DEFAULT '',
    parents_married TEXT DEFAULT '',
    siblings TEXT DEFAULT '',
    childhood_trauma TEXT DEFAULT '',
    physical_abuse TEXT DEFAULT '',

    -- 教育与工作
    education TEXT DEFAULT '',
    education_painful TEXT DEFAULT '',
    recent_job TEXT DEFAULT '',
    job_duration TEXT DEFAULT '',
    job_relationships TEXT DEFAULT '',

    -- 健康与风险
    suicidal_thoughts TEXT DEFAULT '',
    self_harm TEXT DEFAULT '',
    mental_health_treatment TEXT DEFAULT '',
    physical_disease TEXT DEFAULT '',

    -- 其他
    extra_notes TEXT DEFAULT '',

    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (consultant_id) REFERENCES consultants(id)
);

-- 发票表
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    client_id TEXT DEFAULT '',
    consultant_id TEXT NOT NULL,
    invoice_no TEXT UNIQUE NOT NULL,
    amount REAL NOT NULL,
    tax_amount REAL NOT NULL,
    invoice_type TEXT DEFAULT '普票',  -- 普票 / 专票
    tax_rate REAL DEFAULT 0.06,
    status TEXT DEFAULT 'pending',  -- pending / issued / cancelled
    issued_at DATETIME,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (consultant_id) REFERENCES consultants(id)
);

-- 系统设置表
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 初始化种子数据
INSERT OR IGNORE INTO consultants (id, name, title, bio, specialties, fee)
VALUES 
  ('default', '王琳', '国家二级心理咨询师', '婚恋情感 / 自我成长 / 情绪管理', '["婚恋情感","自我成长","情绪管理"]', 600);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('system_name', 'Jasmine Counseling Studio 心理咨询管理系统'),
  ('work_hours', '{"weekday":"09:00-21:00","weekend":"10:00-18:00"}'),
  ('reminder_24h', 'true'),
  ('reminder_1h', 'true');

-- 测评结果表
CREATE TABLE IF NOT EXISTS assessment_results (
    id TEXT PRIMARY KEY,
    client_id TEXT,
    scale TEXT NOT NULL,           -- scl90 / sas / sds / adhd / psqi / mmpi
    score TEXT NOT NULL,           -- JSON: 原始分、标准分、等级等
    level TEXT DEFAULT '',          -- 正常/轻度/中度/重度等
    raw_score INTEGER DEFAULT 0,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT DEFAULT '',
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- SOAP笔记扩展字段（如果不存在则添加）
-- 注意：sql.js 运行 schema.sql 时这些 ALTER TABLE 会执行
-- 实际添加逻辑在 index.js 初始化时处理，这里保留定义作为参考
-- ALTER TABLE case_notes ADD COLUMN soap_s TEXT DEFAULT '';
-- ALTER TABLE case_notes ADD COLUMN soap_o TEXT DEFAULT '';
-- ALTER TABLE case_notes ADD COLUMN soap_a TEXT DEFAULT '';
-- ALTER TABLE case_notes ADD COLUMN soap_p TEXT DEFAULT '';
-- ALTER TABLE case_notes ADD COLUMN session_duration INTEGER DEFAULT 0;

-- 咨询师可用时间配置表
CREATE TABLE IF NOT EXISTS consultant_availability (
    id TEXT PRIMARY KEY,
    consultant_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,
    time_slots TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (consultant_id) REFERENCES consultants(id)
);
