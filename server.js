const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const saltRounds = 10;
// 导入数据库配置
const DB_CONFIG = require('./config/database');
// nanoid v5.x 是 ES Module，使用动态导入
let nanoid;

const app = express();
const PORT = 3000;

// 中间件
// 日志中间件，用于记录请求体大小和内容
app.use(cors());
// 增加请求体大小限制，解决PayloadTooLargeError
app.use(express.json({ limit: '50mb' }));

// 根路由重定向到我的关系图页面
app.get('/', (req, res) => {
    res.redirect('/my');
});

// 登录页面路由
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 我的关系图页面路由
app.get('/my', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'my.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'graph-editor-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// 数据库配置已从 config/database.js 导入

// 初始化 nanoid（ES Module）
async function initNanoid() {
    const nanoidModule = await import('nanoid');
    nanoid = nanoidModule.nanoid;
}

// ==================== 数据库初始化 ====================
let pool;

async function initDatabase() {
    // 先初始化 nanoid
    await initNanoid();

    try {
        console.log('正在初始化 MySQL 数据库...');
        console.log('数据库配置:', {
            host: DB_CONFIG.host,
            user: DB_CONFIG.user,
            database: DB_CONFIG.database,
            port: DB_CONFIG.port
        });

        // 创建连接池
        pool = mysql.createPool(DB_CONFIG);

        // 测试连接
        const connection = await pool.getConnection();
        console.log('MySQL 数据库连接成功');
        connection.release();

        // 初始化表
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT PRIMARY KEY AUTO_INCREMENT,
                provider VARCHAR(50), -- wechat / mock / local
                providerUserId VARCHAR(255), -- openid 等
                username VARCHAR(50), -- 账号密码登录时的用户名
                password VARCHAR(255), -- 账号密码登录时的密码
                nickname VARCHAR(255),
                avatarUrl TEXT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        
        // 检查并添加缺失的字段（兼容所有MySQL版本）
        try {
            // 检查username字段是否存在
            const [usernameExists] = await pool.execute(
                `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'username'`
            );
            if (usernameExists.length === 0) {
                await pool.execute(`ALTER TABLE users ADD COLUMN username VARCHAR(50) AFTER providerUserId`);
            }
            
            // 检查password字段是否存在
            const [passwordExists] = await pool.execute(
                `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password'`
            );
            if (passwordExists.length === 0) {
                await pool.execute(`ALTER TABLE users ADD COLUMN password VARCHAR(255) AFTER username`);
            }
        } catch (error) {
            console.error('添加字段失败:', error);
        }

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS graphs (
                id INT PRIMARY KEY AUTO_INCREMENT,
                userId INT,
                name VARCHAR(255),
                description TEXT,
                code TEXT, -- 存储流程图代码
                sort_order INT DEFAULT 0,
                createdAt DATETIME,
                thumbnail TEXT,
                diagramType VARCHAR(50) DEFAULT 'relationship',
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS nodes (
                id INT PRIMARY KEY AUTO_INCREMENT,
                graphId INT,
                x DOUBLE,
                y DOUBLE,
                radius DOUBLE,
                name VARCHAR(255),
                type VARCHAR(50),
                color VARCHAR(50),
                taskListName VARCHAR(255), -- 事项清单名称（如：目标、待办等）
                image TEXT,
                owner VARCHAR(255),
                notepad TEXT,
                FOREIGN KEY (graphId) REFERENCES graphs(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS edges (
                id INT PRIMARY KEY AUTO_INCREMENT,
                graphId INT,
                sourceId INT,
                targetId INT,
                label VARCHAR(255),
                color VARCHAR(50),
                bendPoints TEXT, -- 转折点（JSON 字符串）
                FOREIGN KEY (sourceId) REFERENCES nodes(id) ON DELETE CASCADE,
                FOREIGN KEY (targetId) REFERENCES nodes(id) ON DELETE CASCADE,
                FOREIGN KEY (graphId) REFERENCES graphs(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INT PRIMARY KEY AUTO_INCREMENT,
                nodeId INT,
                edgeId INT,
                title TEXT,
                done BOOLEAN DEFAULT FALSE,
                sortOrder INT DEFAULT 0,
                FOREIGN KEY (nodeId) REFERENCES nodes(id) ON DELETE CASCADE,
                FOREIGN KEY (edgeId) REFERENCES edges(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS files (
                id INT PRIMARY KEY AUTO_INCREMENT,
                nodeId INT,
                name VARCHAR(255),
                size VARCHAR(50),
                type VARCHAR(100),
                url TEXT,
                uploadedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (nodeId) REFERENCES nodes(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 对于旧数据库，如果没有 bendPoints 字段，则尝试添加
        try {
            await pool.execute('ALTER TABLE edges ADD COLUMN bendPoints TEXT');
            console.log('成功为 edges 表添加 bendPoints 列');
        } catch (e) {
            console.log('edges 表的 bendPoints 列可能已存在:', e.message);
        }

        // 对于旧数据库，添加 nodes 表的新字段
        try {
            await pool.execute('ALTER TABLE nodes ADD COLUMN graphId INT');
            console.log('成功为 nodes 表添加 graphId 列');
        } catch (e) {
            console.log('nodes 表的 graphId 列可能已存在:', e.message);
        }
        try {
            await pool.execute('ALTER TABLE nodes ADD COLUMN taskListName VARCHAR(255)');
            console.log('成功为 nodes 表添加 taskListName 列');
        } catch (e) {
            console.log('nodes 表的 taskListName 列可能已存在:', e.message);
        }
        try {
            await pool.execute('ALTER TABLE nodes ADD COLUMN image TEXT');
            console.log('成功为 nodes 表添加 image 列');
        } catch (e) {
            console.log('nodes 表的 image 列可能已存在:', e.message);
        }
        try {
            await pool.execute('ALTER TABLE nodes ADD COLUMN owner VARCHAR(255)');
            console.log('成功为 nodes 表添加 owner 列');
        } catch (e) {
            console.log('nodes 表的 owner 列可能已存在:', e.message);
        }
        try {
            await pool.execute('ALTER TABLE nodes ADD COLUMN notepad TEXT');
            console.log('成功为 nodes 表添加 notepad 列');
        } catch (e) {
            console.log('nodes 表的 notepad 列可能已存在:', e.message);
        }

        try {
            await pool.execute('ALTER TABLE edges ADD COLUMN graphId INT');
            console.log('成功为 edges 表添加 graphId 列');
        } catch (e) {
            console.log('edges 表的 graphId 列可能已存在:', e.message);
        }

        // 为 graphs 表添加新字段
        try {
            await pool.execute('ALTER TABLE graphs ADD COLUMN description TEXT');
            console.log('成功为 graphs 表添加 description 列');
        } catch (e) {
            console.log('graphs 表的 description 列可能已存在:', e.message);
        }

        try {
            await pool.execute('ALTER TABLE graphs ADD COLUMN sort_order INT DEFAULT 0');
            console.log('成功为 graphs 表添加 sort_order 列');
        } catch (e) {
            console.log('graphs 表的 sort_order 列可能已存在:', e.message);
        }

        try {
            await pool.execute('ALTER TABLE graphs ADD COLUMN diagramType VARCHAR(50) DEFAULT \'relationship\'');
            console.log('成功为 graphs 表添加 diagramType 列');
        } catch (e) {
            console.log('graphs 表的 diagramType 列可能已存在:', e.message);
        }
        
        // 为 graphs 表添加 code 列（存储流程图代码）
        try {
            await pool.execute('ALTER TABLE graphs ADD COLUMN code TEXT');
            console.log('成功为 graphs 表添加 code 列');
        } catch (e) {
            console.log('graphs 表的 code 列可能已存在:', e.message);
        }

        // 为现有数据设置默认排序值
        try {
            await pool.execute('UPDATE graphs SET sort_order = id WHERE sort_order IS NULL OR sort_order = 0');
            console.log('成功为现有关系图设置默认排序值');
        } catch (e) {
            console.log('设置默认排序值失败（可能已设置）:', e.message);
        }

        // 为 graphs 表添加缩放和平移字段
        try {
            await pool.execute('ALTER TABLE graphs ADD COLUMN zoomLevel DOUBLE DEFAULT 1.0');
            console.log('成功为 graphs 表添加 zoomLevel 列');
        } catch (e) {
            console.log('graphs 表的 zoomLevel 列可能已存在:', e.message);
        }

        try {
            await pool.execute('ALTER TABLE graphs ADD COLUMN panOffsetX DOUBLE DEFAULT 0');
            console.log('成功为 graphs 表添加 panOffsetX 列');
        } catch (e) {
            console.log('graphs 表的 panOffsetX 列可能已存在:', e.message);
        }

        try {
            await pool.execute('ALTER TABLE graphs ADD COLUMN panOffsetY DOUBLE DEFAULT 0');
            console.log('成功为 graphs 表添加 panOffsetY 列');
        } catch (e) {
            console.log('graphs 表的 panOffsetY 列可能已存在:', e.message);
        }

        // 为 graphs 表添加画布设置字段
        try {
            await pool.execute('ALTER TABLE graphs ADD COLUMN canvasWidth INT DEFAULT 1600');
            console.log('成功为 graphs 表添加 canvasWidth 列');
        } catch (e) {
            console.log('graphs 表的 canvasWidth 列可能已存在:', e.message);
        }

        try {
            await pool.execute('ALTER TABLE graphs ADD COLUMN canvasHeight INT DEFAULT 1400');
            console.log('成功为 graphs 表添加 canvasHeight 列');
        } catch (e) {
            console.log('graphs 表的 canvasHeight 列可能已存在:', e.message);
        }

        try {
            await pool.execute('ALTER TABLE graphs ADD COLUMN showNodeInfo BOOLEAN DEFAULT TRUE');
            console.log('成功为 graphs 表添加 showNodeInfo 列');
        } catch (e) {
            console.log('graphs 表的 showNodeInfo 列可能已存在:', e.message);
        }

        try {
            await pool.execute('ALTER TABLE graphs ADD COLUMN backgroundImage TEXT');
            console.log('成功为 graphs 表添加 backgroundImage 列');
        } catch (e) {
            console.log('graphs 表的 backgroundImage 列可能已存在:', e.message);
        }

        // 迁移旧数据：如果 nodes/edges 的 graphId 为空，则设为默认关系图 1
        try {
            await pool.execute('UPDATE nodes SET graphId = 1 WHERE graphId IS NULL');
        } catch (e) {
            console.warn('迁移 nodes.graphId 失败（可忽略）:', e.message);
        }
        try {
            await pool.execute('UPDATE edges SET graphId = 1 WHERE graphId IS NULL');
        } catch (e) {
            console.warn('迁移 edges.graphId 失败（可忽略）:', e.message);
        }

        console.log('表初始化完成');
        console.log('数据库初始化完成');

        // 测试查询
        const [testNodes] = await pool.execute('SELECT * FROM nodes');
        console.log('当前节点数:', testNodes.length);
    } catch (error) {
        console.error('数据库初始化失败:', error);
        throw error;
    }
}

// ==================== 数据库操作函数 ====================

// 查询单个结果
async function queryOne(sql, params = []) {
    try {
        const [rows] = await pool.execute(sql, params);
        return rows[0] || null;
    } catch (error) {
        console.error('queryOne 失败:', sql, params, error);
        return null;
    }
}

// 查询多个结果
async function queryAll(sql, params = []) {
    try {
        const [rows] = await pool.execute(sql, params);
        return rows;
    } catch (error) {
        console.error('queryAll 失败:', sql, params, error);
        return [];
    }
}

// 执行 SQL 语句（INSERT、UPDATE、DELETE）
async function run(sql, params = []) {
    try {
        console.log('Backend RUN SQL:', sql, params);
        const [result] = await pool.execute(sql, params);
        console.log('Backend RUN SQL: Affecting rows:', result.affectedRows);
        console.log('Backend RUN SQL: last_insert_rowid returned:', result.insertId);

        return result.insertId || result.affectedRows;
    } catch (error) {
        console.error('Backend RUN SQL: Failed:', sql, params, error);
        throw error;
    }
}

// ==================== 用户认证 ====================

// 获取认证用户ID
function getAuthedUserId(req) {
    const userId = req.session?.userId;
    console.log(`[Auth] User ID: ${userId}, Session:`, req.session);
    if (!userId) {
        return null;
    }
    return userId;
}

// 登录/注册（本地模拟登录）
app.post('/api/auth/mock-login', async (req, res) => {
    try {
        const { nickname } = req.body;
        if (!nickname || nickname.trim() === '') {
            return res.status(400).json({ error: '昵称不能为空' });
        }

        const now = new Date();
        let user = await queryOne('SELECT * FROM users WHERE provider = ? AND providerUserId = ?', ['mock', 'dev']);

        if (!user) {
            const newId = await run(
                'INSERT INTO users (provider, providerUserId, nickname, avatarUrl, createdAt) VALUES (?, ?, ?, ?, ?)',
                ['mock', 'dev', nickname, '', now]
            );
            user = await queryOne('SELECT * FROM users WHERE id = ?', [newId]);
        } else {
            await run('UPDATE users SET nickname = ? WHERE id = ?', [nickname, user.id]);
            user = await queryOne('SELECT * FROM users WHERE id = ?', [user.id]);
        }
        req.session.userId = user.id;
        res.json({ success: true, user: { id: user.id, username: user.username, nickname: user.nickname, avatarUrl: user.avatarUrl } });
    } catch (error) {
        console.error('登录失败:', error);
        res.status(500).json({ error: '登录失败' });
    }
});

// 账号密码登录
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }

        // 查找用户
        let user = await queryOne('SELECT * FROM users WHERE username = ?', [username]);
        
        if (!user) {
            // 如果用户不存在，返回错误
            return res.status(401).json({ error: '账号不存在或密码不正确' });
        } else {
            // 验证密码
            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) {
                // 如果密码不正确，返回错误
                return res.status(401).json({ error: '账号不存在或密码不正确' });
            }
        }
        
        // 设置会话
        req.session.userId = user.id;
        res.json({ success: true, user: { id: user.id, username: user.username, nickname: user.nickname, avatarUrl: user.avatarUrl } });
    } catch (error) {
        console.error('登录失败:', error);
        res.status(500).json({ error: '登录失败' });
    }
});

// 修改密码
app.post('/api/auth/change-password', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: '用户未登录' });
        }
        
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: '当前密码和新密码不能为空' });
        }
        
        // 查找用户
        const user = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(401).json({ error: '用户不存在' });
        }
        
        // 验证当前密码
        const passwordMatch = await bcrypt.compare(currentPassword, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: '当前密码不正确' });
        }
        
        // 加密新密码
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        // 更新密码
        await run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('修改密码失败:', error);
        res.status(500).json({ error: '修改密码失败' });
    }
});

// 微信扫码登录：仅在配置了环境变量时启用（未配置则前端提示）
app.get('/api/auth/wechat/start', (req, res) => {
    const appid = process.env.WECHAT_APPID;
    const callback = process.env.WECHAT_CALLBACK_URL;
    if (!appid || !callback) {
        return res.status(400).json({ error: '微信登录未配置（缺少 WECHAT_APPID / WECHAT_CALLBACK_URL）' });
    }
    const state = nanoid(16);
    req.session.wechatState = state;
    const redirectUri = encodeURIComponent(callback);
    const qrUrl = `https://open.weixin.qq.com/connect/qrconnect?appid=${encodeURIComponent(appid)}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_login&state=${encodeURIComponent(state)}#wechat_redirect`;
    res.json({ qrUrl });
});

// 微信扫码登录二维码接口（前端调用）
app.get('/api/auth/wechat-qr', async (req, res) => {
    try {
        // 调用现有的微信登录开始接口来获取二维码链接
        const appid = process.env.WECHAT_APPID;
        const callback = process.env.WECHAT_CALLBACK_URL;
        if (!appid || !callback) {
            return res.json({ error: '微信登录未配置（缺少 WECHAT_APPID / WECHAT_CALLBACK_URL）' });
        }
        const state = nanoid(16);
        req.session.wechatState = state;
        const redirectUri = encodeURIComponent(callback);
        const qrUrl = `https://open.weixin.qq.com/connect/qrconnect?appid=${encodeURIComponent(appid)}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_login&state=${encodeURIComponent(state)}#wechat_redirect`;
        
        // 返回二维码链接给前端
        res.json({ url: qrUrl });
    } catch (error) {
        console.error('获取微信二维码失败:', error);
        res.json({ error: error.message });
    }
});

// 微信回调（示例，需根据实际情况实现）
app.get('/api/auth/wechat/callback', async (req, res) => {
    try {
        const { code, state } = req.query;
        if (state !== req.session.wechatState) {
            return res.status(403).send('State 不匹配');
        }

        const appid = process.env.WECHAT_APPID;
        const secret = process.env.WECHAT_SECRET;
        const callback = process.env.WECHAT_CALLBACK_URL;

        // 1. 获取 access_token
        const tokenRes = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appid}&secret=${secret}&code=${code}&grant_type=authorization_code`);
        const tokenData = await tokenRes.json();
        if (tokenData.errcode) {
            return res.status(400).send('获取 access_token 失败: ' + tokenData.errmsg);
        }

        // 2. 获取用户信息
        const userRes = await fetch(`https://api.weixin.qq.com/sns/userinfo?access_token=${tokenData.access_token}&openid=${tokenData.openid}`);
        const userData = await userRes.json();
        if (userData.errcode) {
            return res.status(400).send('获取用户信息失败: ' + userData.errmsg);
        }

        // 3. 查找或创建用户
        let user = await queryOne('SELECT * FROM users WHERE provider = ? AND providerUserId = ?', ['wechat', userData.openid]);
        const now = new Date();

        if (!user) {
            const newId = await run(
                'INSERT INTO users (provider, providerUserId, nickname, avatarUrl, createdAt) VALUES (?, ?, ?, ?, ?)',
                ['wechat', userData.openid, userData.nickname, userData.headimgurl, now]
            );
            user = await queryOne('SELECT * FROM users WHERE id = ?', [newId]);
        }

        req.session.userId = user.id;
        res.redirect('/');
    } catch (error) {
        console.error('微信回调失败:', error);
        res.status(500).send('登录失败');
    }
});

// 获取当前用户信息
app.get('/api/auth/user', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const user = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(401).json({ error: '用户不存在' });
        }
        res.json({ user: { id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl } });
    } catch (error) {
        console.error('获取用户信息失败:', error);
        res.status(500).json({ error: '获取用户信息失败' });
    }
});

// 登出
app.post('/api/auth/logout', (req, res) => {
    try {
        req.session.destroy();
        res.json({ success: true });
    } catch (error) {
        console.error('登出失败:', error);
        res.status(500).json({ error: '登出失败' });
    }
});

// 登录状态检查
app.get('/api/auth/status', async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!userId) {
            return res.json({
                loggedIn: false,
                user: null
            });
        }
        const user = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        res.json({
            loggedIn: true,
            userId: userId,
            user: user ? {
                id: user.id,
                username: user.username,
                nickname: user.nickname,
                avatarUrl: user.avatarUrl
            } : null
        });
    } catch (error) {
        console.error('检查登录状态失败:', error);
        res.status(500).json({ error: '检查登录状态失败' });
    }
});

// 用户管理 API - 获取所有用户列表
app.get('/api/users', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const currentUser = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        
        if (!currentUser || currentUser.username !== 'admin') {
            return res.status(403).json({ error: '无权限' });
        }
        
        const users = await queryAll('SELECT id, username, nickname, avatarUrl, isActive, createdAt FROM users ORDER BY id');
        res.json(users);
    } catch (error) {
        console.error('获取用户列表失败:', error);
        res.status(500).json({ error: '获取用户列表失败' });
    }
});

// 用户管理 API - 获取单个用户
app.get('/api/users/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const currentUser = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        
        if (!currentUser || currentUser.username !== 'admin') {
            return res.status(403).json({ error: '无权限' });
        }
        
        const targetUserId = parseInt(req.params.id);
        const user = await queryOne('SELECT id, username, nickname, avatarUrl, isActive, createdAt FROM users WHERE id = ?', [targetUserId]);
        
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }
        
        res.json(user);
    } catch (error) {
        console.error('获取用户信息失败:', error);
        res.status(500).json({ error: '获取用户信息失败' });
    }
});

// 用户管理 API - 创建新用户
app.post('/api/users', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const currentUser = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        
        if (!currentUser || currentUser.username !== 'admin') {
            return res.status(403).json({ error: '无权限' });
        }
        
        const { username, nickname, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }
        
        const existingUser = await queryOne('SELECT * FROM users WHERE username = ?', [username]);
        if (existingUser) {
            return res.status(400).json({ error: '用户名已存在' });
        }
        
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const now = new Date();
        
        const result = await run(
            'INSERT INTO users (username, nickname, password, isActive, createdAt) VALUES (?, ?, ?, ?, ?)',
            [username, nickname || null, hashedPassword, true, now]
        );
        
        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('创建用户失败:', error);
        res.status(500).json({ error: '创建用户失败' });
    }
});

// 用户管理 API - 更新用户信息
app.put('/api/users/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const currentUser = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        
        if (!currentUser || currentUser.username !== 'admin') {
            return res.status(403).json({ error: '无权限' });
        }
        
        const targetUserId = parseInt(req.params.id);
        const targetUser = await queryOne('SELECT * FROM users WHERE id = ?', [targetUserId]);
        
        if (!targetUser) {
            return res.status(404).json({ error: '用户不存在' });
        }
        
        if (targetUser.username === 'admin') {
            return res.status(403).json({ error: '不能修改 admin 用户' });
        }
        
        const { username, nickname, password } = req.body;
        
        if (username && username !== targetUser.username) {
            const existingUser = await queryOne('SELECT * FROM users WHERE username = ? AND id != ?', [username, targetUserId]);
            if (existingUser) {
                return res.status(400).json({ error: '用户名已存在' });
            }
        }
        
        const updates = [];
        const values = [];
        
        if (username) {
            updates.push('username = ?');
            values.push(username);
        }
        
        if (nickname !== undefined) {
            updates.push('nickname = ?');
            values.push(nickname || null);
        }
        
        if (password) {
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            updates.push('password = ?');
            values.push(hashedPassword);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: '没有要更新的内容' });
        }
        
        values.push(targetUserId);
        
        await run(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            values
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('更新用户失败:', error);
        res.status(500).json({ error: '更新用户失败' });
    }
});

// 用户管理 API - 删除用户
app.delete('/api/users/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const currentUser = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        
        if (!currentUser || currentUser.username !== 'admin') {
            return res.status(403).json({ error: '无权限' });
        }
        
        const targetUserId = parseInt(req.params.id);
        const targetUser = await queryOne('SELECT * FROM users WHERE id = ?', [targetUserId]);
        
        if (!targetUser) {
            return res.status(404).json({ error: '用户不存在' });
        }
        
        if (targetUser.username === 'admin') {
            return res.status(403).json({ error: '不能删除 admin 用户' });
        }
        
        await run('DELETE FROM users WHERE id = ?', [targetUserId]);
        res.json({ success: true });
    } catch (error) {
        console.error('删除用户失败:', error);
        res.status(500).json({ error: '删除用户失败' });
    }
});

// 用户管理 API - 启用/停用用户
app.put('/api/users/:id/status', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const currentUser = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        
        if (!currentUser || currentUser.username !== 'admin') {
            return res.status(403).json({ error: '无权限' });
        }
        
        const targetUserId = parseInt(req.params.id);
        const targetUser = await queryOne('SELECT * FROM users WHERE id = ?', [targetUserId]);
        
        if (!targetUser) {
            return res.status(404).json({ error: '用户不存在' });
        }
        
        if (targetUser.username === 'admin') {
            return res.status(403).json({ error: '不能停用 admin 用户' });
        }
        
        const { isActive } = req.body;
        
        await run('UPDATE users SET isActive = ? WHERE id = ?', [isActive, targetUserId]);
        res.json({ success: true });
    } catch (error) {
        console.error('更新用户状态失败:', error);
        res.status(500).json({ error: '更新用户状态失败' });
    }
});

// 用户管理 API - 重置用户密码
app.post('/api/users/:id/reset-password', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const currentUser = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        
        if (!currentUser || currentUser.username !== 'admin') {
            return res.status(403).json({ error: '无权限' });
        }
        
        const targetUserId = parseInt(req.params.id);
        const targetUser = await queryOne('SELECT * FROM users WHERE id = ?', [targetUserId]);
        
        if (!targetUser) {
            return res.status(404).json({ error: '用户不存在' });
        }
        
        if (targetUser.username === 'admin') {
            return res.status(403).json({ error: '不能重置 admin 用户密码' });
        }
        
        const defaultPassword = '123456';
        const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);
        
        await run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, targetUserId]);
        res.json({ success: true, defaultPassword });
    } catch (error) {
        console.error('重置用户密码失败:', error);
        res.status(500).json({ error: '重置用户密码失败' });
    }
});

// ==================== 关系图 API ====================

// 获取所有关系图
app.get('/api/graphs', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const sql = 'SELECT id, name, description, sort_order, createdAt, thumbnail, diagramType FROM graphs WHERE userId = ? ORDER BY sort_order ASC, id DESC';
        console.log(`[SQL] ${sql} - params: [${userId}]`);
        const [graphs] = await pool.execute(sql, [userId]);
        // console.log('关系图列表:', graphs);
        res.json(graphs);
    } catch (e) {
        console.error('获取 graphs 失败:', e);
        res.status(500).json({ error: '获取关系图失败' });
    }
});

// 创建关系图
app.post('/api/graphs', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const { name, description, code, thumbnail, diagramType } = req.body;
        const now = new Date();
        
        // 获取当前用户的最大排序值
        const [maxSortResult] = await pool.execute(
            'SELECT MAX(sort_order) as maxSort FROM graphs WHERE userId = ?',
            [userId]
        );
        const maxSort = maxSortResult[0].maxSort || 0;
        const newSortOrder = maxSort + 1;
        
        const [result] = await pool.execute(
            'INSERT INTO graphs (userId, name, description, code, sort_order, createdAt, thumbnail, diagramType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [userId, name, description || '', code || '', newSortOrder, now, thumbnail || '', diagramType || 'relationship']
        );
        const newId = result.insertId;
        const graph = await queryOne('SELECT id, name, description, code, sort_order, createdAt, thumbnail, diagramType FROM graphs WHERE id = ?', [newId]);
        res.json(graph);
    } catch (e) {
        console.error('创建关系图失败:', e);
        res.status(500).json({ error: '创建关系图失败' });
    }
});

// 更新关系图
// 更新关系图排序
// 批量更新关系图排序
app.put('/api/graphs/sort-orders', async (req, res) => {
    console.log('====================================');
    console.log('[Sort API] START - Received request');
    console.log('[Sort API] Method:', req.method);
    console.log('[Sort API] URL:', req.url);
    console.log('[Sort API] Headers:', req.headers);
    console.log('[Sort API] Body:', req.body);
    console.log('[Sort API] Session:', req.session);
    try {
        const userId = getAuthedUserId(req);
        console.log('[Sort API] userId:', userId);
        const { graphs } = req.body; // 格式: [{ id: 1, sort_order: 0 }, { id: 2, sort_order: 1 }, ...]
        
        if (!graphs || !Array.isArray(graphs)) {
            console.log('[Sort API] Error: graphs is not an array');
            return res.status(400).json({ error: 'graphs 参数必须是数组' });
        }
        
        console.log('[Sort API] Graphs to update:', graphs);
        
        // 查看数据库中的关系图
        const [allGraphs] = await pool.execute('SELECT id, name, userId, sort_order FROM graphs');
        console.log('[Sort API] All graphs in DB:', allGraphs);
        
        // 查看当前用户的关系图
        const [userGraphs] = await pool.execute('SELECT id, name, userId, sort_order FROM graphs WHERE userId = ?', [userId]);
        console.log('[Sort API] User graphs (userId=' + userId + '):', userGraphs);

        // 开启事务
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            for (const graph of graphs) {
                console.log('[Sort API] Updating graph', graph.id, 'to sort_order', graph.sort_order, 'for userId', userId);
                // 更新排序（不检查权限，因为这是用户自己的关系图）
                const [result] = await connection.execute(
                    'UPDATE graphs SET sort_order = ? WHERE id = ? AND userId = ?',
                    [graph.sort_order, graph.id, userId]
                );
                console.log('[Sort API] Updated graph', graph.id, 'affectedRows:', result.affectedRows);
                if (result.affectedRows === 0) {
                    throw new Error(`关系图 ${graph.id} 不存在或无权限`);
                }
            }

            await connection.commit();
            console.log('[Sort API] Commit successful');
            res.json({ success: true });
        } catch (e) {
            await connection.rollback();
            console.log('[Sort API] Rollback due to error:', e.message);
            throw e;
        } finally {
            connection.release();
        }
    } catch (e) {
        console.error('批量更新排序失败:', e);
        res.status(500).json({ error: '批量更新排序失败: ' + e.message });
    }
});

app.put('/api/graphs/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const id = parseInt(req.params.id);
        const { name, description, code, thumbnail, zoomLevel, panOffsetX, panOffsetY, canvasWidth, canvasHeight, showNodeInfo, backgroundImage, diagramType } = req.body;

        // 检查是否有权限
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [id, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        // 构建动态更新语句
        const updates = [];
        const values = [];
        
        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            values.push(description);
        }
        if (thumbnail !== undefined) {
            updates.push('thumbnail = ?');
            values.push(thumbnail);
        }
        if (zoomLevel !== undefined) {
            updates.push('zoomLevel = ?');
            values.push(zoomLevel);
        }
        if (panOffsetX !== undefined) {
            updates.push('panOffsetX = ?');
            values.push(panOffsetX);
        }
        if (panOffsetY !== undefined) {
            updates.push('panOffsetY = ?');
            values.push(panOffsetY);
        }
        if (canvasWidth !== undefined) {
            updates.push('canvasWidth = ?');
            values.push(canvasWidth);
        }
        if (canvasHeight !== undefined) {
            updates.push('canvasHeight = ?');
            values.push(canvasHeight);
        }
        if (showNodeInfo !== undefined) {
            updates.push('showNodeInfo = ?');
            values.push(showNodeInfo);
        }
        if (backgroundImage !== undefined) {
            updates.push('backgroundImage = ?');
            values.push(backgroundImage);
        }
        if (diagramType !== undefined) {
            updates.push('diagramType = ?');
            values.push(diagramType);
        }
        if (code !== undefined) {
            updates.push('code = ?');
            values.push(code);
        }
        
        if (updates.length === 0) {
            return res.json(graph);
        }
        
        values.push(id);
        
        await run(
            `UPDATE graphs SET ${updates.join(', ')} WHERE id = ?`,
            values
        );
        
        const updatedGraph = await queryOne('SELECT id, name, description, code, sort_order, createdAt, thumbnail, zoomLevel, panOffsetX, panOffsetY, diagramType FROM graphs WHERE id = ?', [id]);
        res.json(updatedGraph);
    } catch (e) {
        console.error('更新关系图失败:', e);
        res.status(500).json({ error: '更新关系图失败' });
    }
});

app.put('/api/graphs/:id/sort-order', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const id = parseInt(req.params.id);
        const { sort_order } = req.body;

        // 检查是否有权限
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [id, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        await run(
            'UPDATE graphs SET sort_order = ? WHERE id = ?',
            [sort_order, id]
        );
        res.json({ success: true });
    } catch (e) {
        console.error('更新排序失败:', e);
        res.status(500).json({ error: '更新排序失败' });
    }
});

// 更新关系图缩略图
app.put('/api/graphs/:id/thumbnail', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const id = parseInt(req.params.id);
        const { thumbnail } = req.body;

        // 检查是否有权限
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [id, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        await run(
            'UPDATE graphs SET thumbnail = ? WHERE id = ?',
            [thumbnail, id]
        );
        res.json({ success: true });
    } catch (e) {
        console.error('更新缩略图失败:', e);
        res.status(500).json({ error: '更新缩略图失败' });
    }
});

// 删除关系图
app.delete('/api/graphs/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const id = parseInt(req.params.id);

        // 检查是否有权限
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [id, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        // 删除相关的节点和边
        await run('DELETE FROM edges WHERE graphId = ?', [id]);
        await run('DELETE FROM nodes WHERE graphId = ?', [id]);
        await run('DELETE FROM graphs WHERE id = ?', [id]);

        res.json({ success: true });
    } catch (e) {
        console.error('删除关系图失败:', e);
        res.status(500).json({ error: '删除关系图失败' });
    }
});

// 复制关系图
app.post('/api/graphs/:id/duplicate', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const sourceId = parseInt(req.params.id);
        const { name } = req.body;

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [sourceGraphs] = await connection.execute(
                'SELECT * FROM graphs WHERE id = ? AND userId = ?',
                [sourceId, userId]
            );
            if (sourceGraphs.length === 0) {
                await connection.rollback();
                return res.status(403).json({ error: '无权限' });
            }
            const sourceGraph = sourceGraphs[0];

            const [maxSortResult] = await connection.execute(
                'SELECT MAX(sort_order) as maxSort FROM graphs WHERE userId = ?',
                [userId]
            );
            const maxSort = maxSortResult[0].maxSort || 0;
            const newSortOrder = maxSort + 1;

            const [graphResult] = await connection.execute(
                'INSERT INTO graphs (userId, name, description, code, sort_order, createdAt, thumbnail, zoomLevel, panOffsetX, panOffsetY, canvasWidth, canvasHeight, showNodeInfo, backgroundImage, diagramType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [userId, name, sourceGraph.description || '', sourceGraph.code || '', newSortOrder, new Date(), sourceGraph.thumbnail || '', sourceGraph.zoomLevel || 1.0, sourceGraph.panOffsetX || 0, sourceGraph.panOffsetY || 0, sourceGraph.canvasWidth || 2000, sourceGraph.canvasHeight || 2000, sourceGraph.showNodeInfo !== undefined ? sourceGraph.showNodeInfo : 1, sourceGraph.backgroundImage || '', sourceGraph.diagramType || 'relationship']
            );
            const newGraphId = graphResult.insertId;

            const [nodes] = await connection.execute('SELECT * FROM nodes WHERE graphId = ?', [sourceId]);
            const nodeIdMap = {};
            for (const node of nodes) {
                const [nodeResult] = await connection.execute(
                    'INSERT INTO nodes (graphId, x, y, radius, name, type, color, taskListName) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [newGraphId, node.x, node.y, node.radius, node.name, node.type, node.color, node.taskListName]
                );
                const newNodeId = nodeResult.insertId;
                nodeIdMap[node.id] = newNodeId;
                
                // 复制节点的tasks
                const [tasks] = await connection.execute('SELECT * FROM tasks WHERE nodeId = ?', [node.id]);
                for (const task of tasks) {
                    await connection.execute(
                        'INSERT INTO tasks (nodeId, edgeId, title, done, sortOrder) VALUES (?, ?, ?, ?, ?)',
                        [newNodeId, task.edgeId || null, task.title, task.done, task.sortOrder]
                    );
                }
                
                // 复制节点的files
                const [files] = await connection.execute('SELECT * FROM files WHERE nodeId = ?', [node.id]);
                for (const file of files) {
                    await connection.execute(
                        'INSERT INTO files (nodeId, name, url, size, type, uploadedAt) VALUES (?, ?, ?, ?, ?, ?)',
                        [newNodeId, file.name, file.url, file.size, file.type, file.uploadedAt]
                    );
                }
                
                // 复制节点的image
                const [nodeImages] = await connection.execute('SELECT * FROM node_images WHERE nodeId = ?', [node.id]);
                for (const nodeImage of nodeImages) {
                    await connection.execute(
                        'INSERT INTO node_images (nodeId, imageData) VALUES (?, ?)',
                        [newNodeId, nodeImage.imageData]
                    );
                }
            }

            const [edges] = await connection.execute('SELECT * FROM edges WHERE graphId = ?', [sourceId]);
            const edgeIdMap = {};
            for (const edge of edges) {
                const newSourceId = nodeIdMap[edge.sourceId];
                const newTargetId = nodeIdMap[edge.targetId];
                if (newSourceId && newTargetId) {
                    const [edgeResult] = await connection.execute(
                        'INSERT INTO edges (graphId, sourceId, targetId, label, color, bendPoints, tasks) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [newGraphId, newSourceId, newTargetId, edge.label, edge.color, edge.bendPoints, edge.tasks]
                    );
                    const newEdgeId = edgeResult.insertId;
                    edgeIdMap[edge.id] = newEdgeId;
                    
                    // 复制边的tasks
                const [edgeTasks] = await connection.execute('SELECT * FROM tasks WHERE edgeId = ?', [edge.id]);
                for (const task of edgeTasks) {
                    await connection.execute(
                        'INSERT INTO tasks (nodeId, edgeId, title, done, sortOrder) VALUES (?, ?, ?, ?, ?)',
                        [task.nodeId ? nodeIdMap[task.nodeId] || null : null, newEdgeId, task.title, task.done, task.sortOrder]
                    );
                }
                    
                    // 边的files暂不支持，因为files表没有edgeId字段
                    // 可以在后续版本中添加这个功能
                }
            }

            await connection.commit();
            
            // 使用同一个连接查询新创建的关系图
            const [newGraphs] = await connection.execute(
                'SELECT id, name, description, sort_order, createdAt, thumbnail FROM graphs WHERE id = ?',
                [newGraphId]
            );
            const newGraph = newGraphs[0];
            res.json(newGraph);
        } catch (e) {
            await connection.rollback();
            throw e;
        } finally {
            connection.release();
        }
    } catch (e) {
        console.error('复制关系图失败:', e);
        res.status(500).json({ error: '复制关系图失败: ' + e.message });
    }
});

// 获取关系图详情
app.get('/api/graphs/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const id = parseInt(req.params.id);

        // 检查是否有权限
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [id, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        const nodes = await queryAll('SELECT * FROM nodes WHERE graphId = ?', [id]);
        const edges = await queryAll('SELECT * FROM edges WHERE graphId = ?', [id]);

        res.json({
            id: graph.id,
            name: graph.name,
            description: graph.description,
            code: graph.code,
            createdAt: graph.createdAt,
            thumbnail: graph.thumbnail,
            zoomLevel: graph.zoomLevel,
            panOffsetX: graph.panOffsetX,
            panOffsetY: graph.panOffsetY,
            canvasWidth: graph.canvasWidth,
            canvasHeight: graph.canvasHeight,
            showNodeInfo: graph.showNodeInfo,
            backgroundImage: graph.backgroundImage,
            diagramType: graph.diagramType
        });
    } catch (e) {
        console.error('获取关系图详情失败:', e);
        res.status(500).json({ error: '获取关系图详情失败' });
    }
});

// ==================== 节点 API ====================

// 获取所有节点
app.get('/api/nodes', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const { graphId } = req.query;

        if (!graphId) {
            return res.status(400).json({ error: '缺少 graphId 参数' });
        }

        // 检查是否有权限
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        const sql = 'SELECT id, graphId, x, y, radius, name, type, color, taskListName, tasks, files, owner, notepad FROM nodes WHERE graphId = ?';
        console.log(`[SQL] ${sql} - params: [${graphId}]`);
        const nodes = await queryAll(sql, [graphId]);
        
        // 为每个节点添加空的 tasks 和 files 数组，保持向前兼容
        const parsedNodes = nodes.map(node => ({
            ...node,
            tasks: [],
            files: []
        }));
        
        res.json(parsedNodes);
    } catch (e) {
        console.error('获取 nodes 失败:', e);
        res.status(500).json({ error: '获取节点失败' });
    }
});

// 创建节点
app.post('/api/nodes', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const { graphId, x, y, radius, name, type, color, taskListName, tasks, files, owner, notepad } = req.body;

        // 检查是否有权限
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        const newId = await run(
            'INSERT INTO nodes (graphId, x, y, radius, name, type, color, taskListName, owner, notepad) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [graphId || null, x || null, y || null, radius || null, name || null, type || null, color || null, taskListName || '', owner || '', notepad || '']
        );
        const node = await queryOne('SELECT id, graphId, x, y, radius, name, type, color, taskListName, tasks, files, owner, notepad FROM nodes WHERE id = ?', [newId]);
        res.json(node);
    } catch (e) {
        console.error('创建节点失败:', e);
        res.status(500).json({ error: '创建节点失败' });
    }
});

// 更新节点
app.put('/api/nodes/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const id = parseInt(req.params.id);
        const { x, y, radius, name, type, color, taskListName, tasks, files, owner, notepad } = req.body;

        // 检查是否有权限
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [id]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        // 确保所有参数都不是undefined，对于必需参数使用数据库中现有的值
        const xValue = x !== undefined ? x : node.x;
        const yValue = y !== undefined ? y : node.y;
        const radiusValue = radius !== undefined ? radius : node.radius;
        const nameValue = name !== undefined ? name : node.name;
        const typeValue = type !== undefined ? type : node.type;
        const colorValue = color !== undefined ? color : node.color;
        const taskListNameValue = taskListName !== undefined ? taskListName : node.taskListName;
        const ownerValue = owner !== undefined ? owner : node.owner;
        const notepadValue = notepad !== undefined ? notepad : node.notepad;
        
        await run(
            'UPDATE nodes SET x = ?, y = ?, radius = ?, name = ?, type = ?, color = ?, taskListName = ?, owner = ?, notepad = ? WHERE id = ?',
            [xValue, yValue, radiusValue, nameValue, typeValue, colorValue, taskListNameValue, ownerValue, notepadValue, id]
        );
        const updatedNode = await queryOne('SELECT * FROM nodes WHERE id = ?', [id]);
        res.json(updatedNode);
    } catch (e) {
        console.error('更新节点失败:', e);
        res.status(500).json({ error: '更新节点失败' });
    }
});

// 删除节点
app.delete('/api/nodes/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const id = parseInt(req.params.id);

        // 检查是否有权限
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [id]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        // 删除相关的边
        await run('DELETE FROM edges WHERE sourceId = ? OR targetId = ?', [id, id]);
        await run('DELETE FROM nodes WHERE id = ?', [id]);

        res.json({ success: true });
    } catch (e) {
        console.error('删除节点失败:', e);
        res.status(500).json({ error: '删除节点失败' });
    }
});

// ==================== 任务 API ====================

// 获取节点的所有任务
app.get('/api/tasks', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: '用户未登录' });
        }
        const { nodeId } = req.query;

        if (!nodeId) {
            return res.status(400).json({ error: '缺少 nodeId 参数' });
        }

        // 检查是否有权限
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [nodeId]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        const tasks = await queryAll('SELECT * FROM tasks WHERE nodeId = ? ORDER BY sortOrder', [nodeId]);
        res.json(tasks);
    } catch (e) {
        console.error('获取任务失败:', e);
        res.status(500).json({ error: '获取任务失败' });
    }
});

// 创建任务
app.post('/api/tasks', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: '用户未登录' });
        }
        const { nodeId, title, done, sortOrder } = req.body;

        // 检查是否有权限
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [nodeId]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        const newId = await run(
            'INSERT INTO tasks (nodeId, title, done, sortOrder) VALUES (?, ?, ?, ?)',
            [nodeId, title || '', done || false, sortOrder || 0]
        );
        const task = await queryOne('SELECT * FROM tasks WHERE id = ?', [newId]);
        res.json(task);
    } catch (e) {
        console.error('创建任务失败:', e);
        res.status(500).json({ error: '创建任务失败' });
    }
});

// 更新任务
app.put('/api/tasks/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: '用户未登录' });
        }
        const id = parseInt(req.params.id);
        const { title, done, sortOrder } = req.body;

        // 检查是否有权限
        const task = await queryOne('SELECT * FROM tasks WHERE id = ?', [id]);
        if (!task) {
            return res.status(404).json({ error: '任务不存在' });
        }
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [task.nodeId]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        await run(
            'UPDATE tasks SET title = ?, done = ?, sortOrder = ? WHERE id = ?',
            [title || task.title, done !== undefined ? done : task.done, sortOrder !== undefined ? sortOrder : task.sortOrder, id]
        );
        const updatedTask = await queryOne('SELECT * FROM tasks WHERE id = ?', [id]);
        res.json(updatedTask);
    } catch (e) {
        console.error('更新任务失败:', e);
        res.status(500).json({ error: '更新任务失败' });
    }
});

// 删除任务
app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: '用户未登录' });
        }
        const id = parseInt(req.params.id);

        // 检查是否有权限
        const task = await queryOne('SELECT * FROM tasks WHERE id = ?', [id]);
        if (!task) {
            return res.status(404).json({ error: '任务不存在' });
        }
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [task.nodeId]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        await run('DELETE FROM tasks WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (e) {
        console.error('删除任务失败:', e);
        res.status(500).json({ error: '删除任务失败' });
    }
});

// ==================== 文件 API ====================

// 获取节点的所有文件
app.get('/api/files', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: '用户未登录' });
        }
        const { nodeId } = req.query;

        if (!nodeId) {
            return res.status(400).json({ error: '缺少 nodeId 参数' });
        }

        // 检查是否有权限
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [nodeId]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        const files = await queryAll('SELECT * FROM files WHERE nodeId = ? ORDER BY uploadedAt DESC', [nodeId]);
        res.json(files);
    } catch (e) {
        console.error('获取文件失败:', e);
        res.status(500).json({ error: '获取文件失败' });
    }
});

// 删除文件
app.delete('/api/files/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: '用户未登录' });
        }
        const id = parseInt(req.params.id);

        // 检查是否有权限
        const file = await queryOne('SELECT * FROM files WHERE id = ?', [id]);
        if (!file) {
            return res.status(404).json({ error: '文件不存在' });
        }
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [file.nodeId]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        await run('DELETE FROM files WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (e) {
        console.error('删除文件失败:', e);
        res.status(500).json({ error: '删除文件失败' });
    }
});

const upload = multer({ dest: path.join(__dirname, 'temp') });

// 上传文件
app.post('/api/files', upload.single('file'), async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: '用户未登录' });
        }
        const { nodeId, name, size, type } = req.body;

        if (!nodeId) {
            return res.status(400).json({ error: '缺少 nodeId 参数' });
        }

        // 检查是否有权限
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [nodeId]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        let filePath = '';
        if (req.file) {
            filePath = `/uploads/${req.file.filename}`;
        }

        const newId = await run(
            'INSERT INTO files (nodeId, name, size, url, type, uploadedAt) VALUES (?, ?, ?, ?, ?, ?)',
            [nodeId, name || req.file?.originalname || '', size || '', filePath || req.body.url || '', type || req.file?.mimetype || '', new Date().toISOString().slice(0, 19).replace('T', ' ')]
        );
        const file = await queryOne('SELECT * FROM files WHERE id = ?', [newId]);
        res.json(file);
    } catch (e) {
        console.error('上传文件失败:', e);
        res.status(500).json({ error: '上传文件失败' });
    }
});

// 下载文件
app.get('/api/files/:id/download', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: '用户未登录' });
        }
        const id = parseInt(req.params.id);

        // 检查是否有权限
        const file = await queryOne('SELECT * FROM files WHERE id = ?', [id]);
        if (!file) {
            return res.status(404).json({ error: '文件不存在' });
        }
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [file.nodeId]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        if (file.url) {
            // 如果文件是本地上传的，返回文件
            if (file.url.startsWith('/uploads/')) {
                const filePath = path.join(__dirname, 'public', file.url);
                if (fs.existsSync(filePath)) {
                    res.download(filePath, file.name);
                } else {
                    res.status(404).json({ error: '文件不存在' });
                }
            } else {
                // 如果文件是外部链接，重定向
                res.redirect(file.url);
            }
        } else {
            res.status(404).json({ error: '文件不存在' });
        }
    } catch (e) {
        console.error('下载文件失败:', e);
        res.status(500).json({ error: '下载文件失败' });
    }
});

// ==================== 图片 API ====================

// 获取节点的图片
app.get('/api/node-images', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: '用户未登录' });
        }
        const { nodeId } = req.query;

        if (!nodeId) {
            return res.status(400).json({ error: '缺少 nodeId 参数' });
        }

        // 检查是否有权限
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [nodeId]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        const image = await queryOne('SELECT * FROM node_images WHERE nodeId = ?', [nodeId]);
        res.json(image ? image.imageData : null);
    } catch (e) {
        console.error('获取图片失败:', e);
        res.status(500).json({ error: '获取图片失败' });
    }
});

// 保存节点的图片
app.post('/api/node-images', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: '用户未登录' });
        }
        const { nodeId, imageData } = req.body;

        if (!nodeId) {
            return res.status(400).json({ error: '缺少 nodeId 参数' });
        }

        // 检查是否有权限
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [nodeId]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        // 检查是否已存在图片
        const existingImage = await queryOne('SELECT * FROM node_images WHERE nodeId = ?', [nodeId]);
        if (existingImage) {
            // 更新现有图片
            await run('UPDATE node_images SET imageData = ? WHERE nodeId = ?', [imageData, nodeId]);
        } else {
            // 创建新图片记录
            await run('INSERT INTO node_images (nodeId, imageData) VALUES (?, ?)', [nodeId, imageData]);
        }

        res.json({ success: true });
    } catch (e) {
        console.error('保存图片失败:', e);
        res.status(500).json({ error: '保存图片失败' });
    }
});

// 删除节点的图片
app.delete('/api/node-images', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: '用户未登录' });
        }
        const { nodeId } = req.query;

        if (!nodeId) {
            return res.status(400).json({ error: '缺少 nodeId 参数' });
        }

        // 检查是否有权限
        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [nodeId]);
        if (!node) {
            return res.status(404).json({ error: '节点不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [node.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        await run('DELETE FROM node_images WHERE nodeId = ?', [nodeId]);
        res.json({ success: true });
    } catch (e) {
        console.error('删除图片失败:', e);
        res.status(500).json({ error: '删除图片失败' });
    }
});

// ==================== 边 API ====================

// 获取所有边
app.get('/api/edges', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const { graphId } = req.query;

        if (!graphId) {
            return res.status(400).json({ error: '缺少 graphId 参数' });
        }

        // 检查是否有权限
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        const sql = 'SELECT * FROM edges WHERE graphId = ?';
        console.log(`[SQL] ${sql} - params: [${graphId}]`);
        const edges = await queryAll(sql, [graphId]);
        
        // 解析 bendPoints 字段
        const parsedEdges = edges.map(edge => ({
            ...edge,
            bendPoints: edge.bendPoints ? JSON.parse(edge.bendPoints) : [],
            tasks: edge.tasks ? JSON.parse(edge.tasks) : []
        }));
        
        res.json(parsedEdges);
    } catch (e) {
        console.error('获取 edges 失败:', e);
        res.status(500).json({ error: '获取边失败' });
    }
});

// 创建边
app.post('/api/edges', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const { graphId, sourceId, targetId, label, color, bendPoints, tasks } = req.body;

        // 检查是否有权限
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        const newId = await run(
            'INSERT INTO edges (graphId, sourceId, targetId, label, color, bendPoints, tasks) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [graphId || null, sourceId || null, targetId || null, label || null, color || null, JSON.stringify(bendPoints || []), JSON.stringify(tasks || [])]
        );
        const edge = await queryOne('SELECT * FROM edges WHERE id = ?', [newId]);
        res.json(edge);
    } catch (e) {
        console.error('创建边失败:', e);
        res.status(500).json({ error: '创建边失败' });
    }
});

// 更新边
app.put('/api/edges/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const id = parseInt(req.params.id);
        const { sourceId, targetId, label, color, bendPoints, tasks } = req.body;

        // 检查是否有权限
        const edge = await queryOne('SELECT * FROM edges WHERE id = ?', [id]);
        if (!edge) {
            return res.status(404).json({ error: '边不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [edge.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        // 确保所有参数都不是undefined，对于必需参数使用数据库中现有的值
        const sourceIdValue = sourceId !== undefined ? sourceId : edge.sourceId;
        const targetIdValue = targetId !== undefined ? targetId : edge.targetId;
        const labelValue = label !== undefined ? label : edge.label;
        const colorValue = color !== undefined ? color : edge.color;
        const bendPointsValue = bendPoints !== undefined ? JSON.stringify(bendPoints) : edge.bendPoints;
        const tasksValue = tasks !== undefined ? JSON.stringify(tasks) : edge.tasks;
        
        await run(
            'UPDATE edges SET sourceId = ?, targetId = ?, label = ?, color = ?, bendPoints = ?, tasks = ? WHERE id = ?',
            [sourceIdValue, targetIdValue, labelValue, colorValue, bendPointsValue, tasksValue, id]
        );
        const updatedEdge = await queryOne('SELECT * FROM edges WHERE id = ?', [id]);
        res.json(updatedEdge);
    } catch (e) {
        console.error('更新边失败:', e);
        res.status(500).json({ error: '更新边失败' });
    }
});

// 删除边
app.delete('/api/edges/:id', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const id = parseInt(req.params.id);

        // 检查是否有权限
        const edge = await queryOne('SELECT * FROM edges WHERE id = ?', [id]);
        if (!edge) {
            return res.status(404).json({ error: '边不存在' });
        }
        const graph = await queryOne('SELECT * FROM graphs WHERE id = ? AND userId = ?', [edge.graphId, userId]);
        if (!graph) {
            return res.status(403).json({ error: '无权限' });
        }

        await run('DELETE FROM edges WHERE id = ?', [id]);

        res.json({ success: true });
    } catch (e) {
        console.error('删除边失败:', e);
        res.status(500).json({ error: '删除边失败' });
    }
});

// ==================== 导入导出 API ====================

// 导出数据库 (MySQL 不支持直接导出文件，改为导出 JSON 数据)
app.get('/api/export', async (req, res) => {
    try {
        const userId = getAuthedUserId(req);

        // 获取用户的所有数据
        const graphs = await queryAll('SELECT * FROM graphs WHERE userId = ?', [userId]);
        const nodes = await queryAll('SELECT * FROM nodes WHERE graphId IN (SELECT id FROM graphs WHERE userId = ?)', [userId]);
        const edges = await queryAll('SELECT * FROM edges WHERE graphId IN (SELECT id FROM graphs WHERE userId = ?)', [userId]);

        const exportData = {
            version: '2.0.0',
            exportedAt: new Date().toISOString(),
            userId,
            graphs,
            nodes,
            edges
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="graph-data.json"');
        res.json(exportData);
    } catch (error) {
        console.error('导出失败:', error);
        res.status(500).json({ error: '导出失败' });
    }
});

// 导入数据库
app.post('/api/import', upload.single('file'), async (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const uploadedPath = req.file.path;

        if (!fs.existsSync(uploadedPath)) {
            return res.status(400).json({ error: '上传的文件为空' });
        }

        // 读取上传的 JSON 文件
        const fileContent = fs.readFileSync(uploadedPath, 'utf8');
        const importData = JSON.parse(fileContent);

        // 验证数据格式
        if (!importData.version || !importData.graphs) {
            return res.status(400).json({ error: '无效的导入文件格式' });
        }

        // 导入数据（使用事务）
        const connection = await pool.getConnection();
        try {
            await connection.execute('START TRANSACTION');

            // 导入关系图
            for (const graph of importData.graphs) {
                // 导入关系图
                const [graphResult] = await connection.execute(
                    'INSERT INTO graphs (userId, name, createdAt, thumbnail) VALUES (?, ?, ?, ?)',
                    [userId, graph.name, graph.createdAt, graph.thumbnail || '']
                );
                const newId = graphResult.insertId;

                // 导入节点
                const graphNodes = importData.nodes.filter(n => n.graphId === graph.id);
                for (const node of graphNodes) {
                    await connection.execute(
                        'INSERT INTO nodes (graphId, x, y, radius, name, type, color, taskListName, tasks, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [newId, node.x, node.y, node.radius, node.name, node.type, node.color, node.taskListName || '', node.tasks || '[]', node.image || '']
                    );
                }

                // 导入边
                const graphEdges = importData.edges.filter(e => e.graphId === graph.id);
                for (const edge of graphEdges) {
                    await connection.execute(
                        'INSERT INTO edges (graphId, sourceId, targetId, label, color, bendPoints, tasks) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [newId, edge.sourceId, edge.targetId, edge.label, edge.color, edge.bendPoints || '[]', edge.tasks || '[]']
                    );
                }
            }

            await connection.execute('COMMIT');

            // 删除上传的临时文件
            fs.unlinkSync(uploadedPath);

            res.json({ success: true, message: '导入成功' });
        } catch (error) {
            await connection.execute('ROLLBACK');
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('导入失败:', error);
        res.status(500).json({ error: '导入失败: ' + error.message });
    }
});

app.get('/api/info', async (req, res) => {
    try {
        const [nodeCount] = await pool.execute('SELECT COUNT(*) as count FROM nodes');
        const [edgeCount] = await pool.execute('SELECT COUNT(*) as count FROM edges');

        res.json({
            nodeCount: nodeCount[0].count || 0,
            edgeCount: edgeCount[0].count || 0,
            database: 'MySQL'
        });
    } catch (error) {
        console.error('获取信息失败:', error);
        res.status(500).json({ error: '获取信息失败' });
    }
});

app.get('/api/config', (req, res) => {
    res.json({
        drawioUrl: DB_CONFIG.drawioUrl || 'http://localhost:8080'
    });
});

// ==================== SPA Fallback (必须放在所有 API 路由之后) ====================
// 对于所有其他请求，返回 index.html 以支持前端路由
app.get('*', (req, res) => {
    // 排除已知的静态文件
    const knownStaticExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.map'];
    const ext = path.extname(req.path);
    if (knownStaticExtensions.includes(ext)) {
        return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }
    // 返回前端入口文件
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务器
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 关系图编辑器服务器已启动                              ║
║                                                           ║
║   访问地址: http://localhost:${PORT}                        ║
║   数据库: MySQL (${DB_CONFIG.host}:${DB_CONFIG.port})  ║
║                                                           ║
║   API 端点:                                               ║
║   - GET    /api/nodes        - 获取所有节点               ║
║   - POST   /api/nodes        - 创建节点                   ║
║   - PUT    /api/nodes/:id    - 更新节点                   ║
║   - DELETE /api/nodes/:id    - 删除节点                   ║
║   - GET    /api/edges        - 获取所有关系               ║
║   - POST   /api/edges        - 创建关系                   ║
║   - PUT    /api/edges/:id    - 更新关系                   ║
║   - DELETE /api/edges/:id    - 删除关系                   ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
        `);
    });
}).catch(err => {
    console.error('数据库初始化失败:', err);
    process.exit(1);
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    if (pool) {
        pool.end((err) => {
            if (err) {
                console.error('关闭数据库连接池失败:', err);
            }
            console.log('数据库连接池已关闭');
        });
    }
    process.exit(0);
});