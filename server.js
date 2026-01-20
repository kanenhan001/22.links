const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
// nanoid v5.x 是 ES Module，使用动态导入
let nanoid;

const app = express();
const PORT = 3000;

// 中间件
app.use(cors());
app.use(express.json());
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

// 数据库路径
const DB_PATH = path.join(__dirname, 'data', 'graph.db');

// 确保数据目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化 nanoid（ES Module）
async function initNanoid() {
    const nanoidModule = await import('nanoid');
    nanoid = nanoidModule.nanoid;
}

// ==================== 数据库初始化 ====================
let db;

async function initDatabase() {
    // 先初始化 nanoid
    await initNanoid();

    try {
        console.log('正在初始化数据库...');
        console.log('正在初始化数据库...');
        const initSqlJs = require('sql.js');
        const SQL = await initSqlJs();
        console.log('sql.js 加载成功');
        
        // 加载现有数据库或创建新的
        if (fs.existsSync(DB_PATH)) {
            const fileBuffer = fs.readFileSync(DB_PATH);
            console.log('数据库文件大小:', fileBuffer.length, 'bytes');
            db = new SQL.Database(fileBuffer);
        } else {
            console.log('创建新的数据库');
            db = new SQL.Database();
        }
        console.log('数据库实例创建成功');
        
        // 初始化表
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT, -- wechat / mock
                providerUserId TEXT, -- openid 等
                nickname TEXT,
                avatarUrl TEXT,
                createdAt TEXT
            );

            CREATE TABLE IF NOT EXISTS graphs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER,
                name TEXT,
                createdAt TEXT,
                thumbnail TEXT,
                FOREIGN KEY (userId) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                graphId INTEGER,
                x REAL,
                y REAL,
                radius REAL,
                name TEXT,
                type TEXT,
                color TEXT,
                taskListName TEXT, -- 事项清单名称（如：目标、待办等）
                tasks TEXT, -- 事项清单（JSON 字符串）
                FOREIGN KEY (graphId) REFERENCES graphs(id)
            );
            
            CREATE TABLE IF NOT EXISTS edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                graphId INTEGER,
                sourceId INTEGER,
                targetId INTEGER,
                label TEXT,
                color TEXT,
                bendPoints TEXT, -- 转折点（JSON 字符串）
                tasks TEXT, -- 事项清单（JSON 字符串）
                FOREIGN KEY (sourceId) REFERENCES nodes(id),
                FOREIGN KEY (targetId) REFERENCES nodes(id),
                FOREIGN KEY (graphId) REFERENCES graphs(id)
            );
        `);

        // 对于旧数据库，如果没有 tasks 字段，则尝试添加
        try {
            db.run('ALTER TABLE edges ADD COLUMN tasks TEXT');
            console.log('成功为 edges 表添加 tasks 列');
        } catch (e) {
            console.log('edges 表的 tasks 列可能已存在:', e.message);
        }

        // 对于旧数据库，如果没有 bendPoints 字段，则尝试添加
        try {
            db.run('ALTER TABLE edges ADD COLUMN bendPoints TEXT');
            console.log('成功为 edges 表添加 bendPoints 列');
        } catch (e) {
            console.log('edges 表的 bendPoints 列可能已存在:', e.message);
        }
        
        // 对于旧数据库，添加 nodes 表的新字段
        try {
            db.run('ALTER TABLE nodes ADD COLUMN graphId INTEGER');
            console.log('成功为 nodes 表添加 graphId 列');
        } catch (e) {
            console.log('nodes 表的 graphId 列可能已存在:', e.message);
        }
        try {
            db.run('ALTER TABLE nodes ADD COLUMN taskListName TEXT');
            console.log('成功为 nodes 表添加 taskListName 列');
        } catch (e) {
            console.log('nodes 表的 taskListName 列可能已存在:', e.message);
        }
        
        try {
            db.run('ALTER TABLE nodes ADD COLUMN tasks TEXT');
            console.log('成功为 nodes 表添加 tasks 列');
        } catch (e) {
            console.log('nodes 表的 tasks 列可能已存在:', e.message);
        }

        try {
            db.run('ALTER TABLE edges ADD COLUMN graphId INTEGER');
            console.log('成功为 edges 表添加 graphId 列');
        } catch (e) {
            console.log('edges 表的 graphId 列可能已存在:', e.message);
        }

        // 确保至少有一个默认用户和默认关系图（用于旧数据迁移 / 未登录体验）
        const now = new Date().toISOString();
        const defaultUser = queryOne("SELECT * FROM users WHERE id = 1");
        if (!defaultUser) {
            run(
                "INSERT INTO users (id, provider, providerUserId, nickname, avatarUrl, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
                [1, 'mock', 'local', '本地用户', '', now]
            );
        }
        const defaultGraph = queryOne("SELECT * FROM graphs WHERE id = 1");
        if (!defaultGraph) {
            run(
                "INSERT INTO graphs (id, userId, name, createdAt, thumbnail) VALUES (?, ?, ?, ?, ?)",
                [1, 1, '默认关系图', now, '']
            );
        }

        // 迁移旧数据：如果 nodes/edges 的 graphId 为空，则设为默认关系图 1
        try {
            run("UPDATE nodes SET graphId = 1 WHERE graphId IS NULL");
        } catch (e) {
            console.warn('迁移 nodes.graphId 失败（可忽略）:', e.message);
        }
        try {
            run("UPDATE edges SET graphId = 1 WHERE graphId IS NULL");
        } catch (e) {
            console.warn('迁移 edges.graphId 失败（可忽略）:', e.message);
        }
        
        console.log('表初始化完成');
        
        saveDatabase();
        console.log('数据库初始化完成:', DB_PATH);
        
        // 测试查询
        const testNodes = queryAll('SELECT * FROM nodes');
        console.log('当前节点数:', testNodes.length);
    } catch (error) {
        console.error('数据库初始化失败:', error);
        throw error;
    }
}

function getAuthedUserId(req) {
    // 未登录时，回退到默认用户 1（兼容旧用法）。上线可改为必须登录。
    return req.session?.userId || 1;
}

function requireLogin(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({ error: '未登录' });
    }
    next();
}

// ==================== 页面路由（登录/我的关系图/编辑器） ====================
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/my', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my.html')));
app.get('/g/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ==================== 认证 API ====================
app.get('/api/auth/status', (req, res) => {
    if (!req.session?.userId) {
        return res.json({ loggedIn: false });
    }
    const user = queryOne('SELECT id, nickname, avatarUrl, provider FROM users WHERE id = ?', [req.session.userId]);
    return res.json({ loggedIn: true, user });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

// 开发/自测用：模拟登录（不依赖微信配置）
app.post('/api/auth/mock-login', (req, res) => {
    const now = new Date().toISOString();
    const nickname = (req.body?.nickname || '测试用户').toString().slice(0, 30);
    // 固定一个 mock 用户（id=1 为默认用户，避免覆盖；mock 用户用 id=2）
    let user = queryOne("SELECT * FROM users WHERE provider = 'mock' AND providerUserId = 'dev'");
    if (!user) {
        const newId = run(
            "INSERT INTO users (provider, providerUserId, nickname, avatarUrl, createdAt) VALUES (?, ?, ?, ?, ?)",
            ['mock', 'dev', nickname, '', now]
        );
        user = queryOne('SELECT * FROM users WHERE id = ?', [newId]);
    } else {
        run("UPDATE users SET nickname = ? WHERE id = ?", [nickname, user.id]);
        user = queryOne('SELECT * FROM users WHERE id = ?', [user.id]);
    }
    req.session.userId = user.id;
    res.json({ success: true, user: { id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl } });
});

// 微信扫码登录：仅在配置了环境变量时启用（未配置则前端提示）
app.get('/api/auth/wechat/start', (req, res) => {
    const appid = process.env.WECHAT_APPID;
    const callback = process.env.WECHAT_CALLBACK_URL; // 例如: http://yourdomain.com/api/auth/wechat/callback
    if (!appid || !callback) {
        return res.status(400).json({ error: '微信登录未配置（缺少 WECHAT_APPID / WECHAT_CALLBACK_URL）' });
    }
    const state = nanoid(16);
    req.session.wechatState = state;
    const redirectUri = encodeURIComponent(callback);
    const qrUrl = `https://open.weixin.qq.com/connect/qrconnect?appid=${encodeURIComponent(appid)}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_login&state=${encodeURIComponent(state)}#wechat_redirect`;
    res.json({ qrUrl });
});

// 这里预留回调（需要 WECHAT_SECRET 才能换取 openid）；没配置 secret 则提示
app.get('/api/auth/wechat/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.wechatState) {
        return res.status(400).send('无效的回调参数');
    }
    const appid = process.env.WECHAT_APPID;
    const secret = process.env.WECHAT_SECRET;
    if (!appid || !secret) {
        return res.status(400).send('微信登录未配置 WECHAT_SECRET');
    }
    try {
        const fetch = (await import('node-fetch')).default;
        const tokenRes = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`);
        const tokenJson = await tokenRes.json();
        if (!tokenJson.openid) {
            return res.status(400).send('微信授权失败');
        }

        // 拉取用户信息（需要 unionid/昵称等，可选）
        let nickname = '微信用户';
        let avatarUrl = '';
        try {
            const infoRes = await fetch(`https://api.weixin.qq.com/sns/userinfo?access_token=${encodeURIComponent(tokenJson.access_token)}&openid=${encodeURIComponent(tokenJson.openid)}&lang=zh_CN`);
            const infoJson = await infoRes.json();
            if (infoJson.nickname) nickname = infoJson.nickname;
            if (infoJson.headimgurl) avatarUrl = infoJson.headimgurl;
        } catch (_) {}

        const now = new Date().toISOString();
        let user = queryOne("SELECT * FROM users WHERE provider = 'wechat' AND providerUserId = ?", [tokenJson.openid]);
        if (!user) {
            const newId = run(
                "INSERT INTO users (provider, providerUserId, nickname, avatarUrl, createdAt) VALUES (?, ?, ?, ?, ?)",
                ['wechat', tokenJson.openid, nickname, avatarUrl, now]
            );
            user = queryOne('SELECT * FROM users WHERE id = ?', [newId]);
        } else {
            run("UPDATE users SET nickname = ?, avatarUrl = ? WHERE id = ?", [nickname, avatarUrl, user.id]);
        }
        req.session.userId = user.id;
        res.redirect('/my');
    } catch (e) {
        console.error('微信回调处理失败:', e);
        res.status(500).send('微信登录失败');
    }
});

// ==================== 关系图（graphs）API ====================
app.get('/api/graphs', (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const graphs = queryAll('SELECT id, name, createdAt, thumbnail FROM graphs WHERE userId = ? ORDER BY id DESC', [userId]);
        res.json(graphs);
    } catch (e) {
        console.error('获取 graphs 失败:', e);
        res.status(500).json({ error: '获取关系图失败' });
    }
});

app.post('/api/graphs', (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const now = new Date().toISOString();
        const name = (req.body?.name || '未命名关系图').toString().slice(0, 80);
        const newId = run('INSERT INTO graphs (userId, name, createdAt, thumbnail) VALUES (?, ?, ?, ?)', [userId, name, now, '']);
        const graph = queryOne('SELECT id, name, createdAt, thumbnail FROM graphs WHERE id = ?', [newId]);
        res.json(graph);
    } catch (e) {
        console.error('创建 graph 失败:', e);
        res.status(500).json({ error: '创建关系图失败' });
    }
});

app.get('/api/graphs/:id', (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const graph = queryOne('SELECT id, name, createdAt, thumbnail, userId FROM graphs WHERE id = ?', [req.params.id]);
        if (!graph || graph.userId !== userId) return res.status(404).json({ error: '关系图不存在' });
        res.json(graph);
    } catch (e) {
        console.error('获取 graph 失败:', e);
        res.status(500).json({ error: '获取关系图失败' });
    }
});

app.put('/api/graphs/:id', (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        const graph = queryOne('SELECT id, userId FROM graphs WHERE id = ?', [req.params.id]);
        if (!graph || graph.userId !== userId) return res.status(404).json({ error: '关系图不存在' });
        const name = (req.body?.name || '').toString().slice(0, 80);
        const thumbnail = (req.body?.thumbnail || '').toString();
        if (name) run('UPDATE graphs SET name = ? WHERE id = ?', [name, graph.id]);
        if (thumbnail !== undefined) run('UPDATE graphs SET thumbnail = ? WHERE id = ?', [thumbnail, graph.id]);
        const updated = queryOne('SELECT id, name, createdAt, thumbnail FROM graphs WHERE id = ?', [graph.id]);
        res.json(updated);
    } catch (e) {
        console.error('更新 graph 失败:', e);
        res.status(500).json({ error: '更新关系图失败' });
    }
});

app.delete('/api/graphs/:id', (req, res) => {
    try {
        const userId = getAuthedUserId(req);
        console.log('Backend: 删除关系图请求 - userId:', userId, 'graphId:', req.params.id);
        const graph = queryOne('SELECT id, userId FROM graphs WHERE id = ?', [req.params.id]);
        console.log('Backend: 查询到的graph:', graph);
        if (!graph || graph.userId !== userId) {
            console.log('Backend: 关系图不存在或无权限');
            return res.status(404).json({ error: '关系图不存在' });
        }

        // 删除关联的 nodes 和 edges
        console.log('Backend: 开始删除关联数据');
        run('DELETE FROM nodes WHERE graphId = ?', [graph.id]);
        run('DELETE FROM edges WHERE graphId = ?', [graph.id]);
        // 删除关系图本身
        console.log('Backend: 删除关系图本身');
        run('DELETE FROM graphs WHERE id = ?', [graph.id]);

        console.log('Backend: 删除成功');
        res.json({ success: true });
    } catch (e) {
        console.error('Backend: 删除 graph 失败:', e);
        res.status(500).json({ error: '删除关系图失败: ' + e.message });
    }
});

// 保存数据库到文件
function saveDatabase() {
    try {
        console.info('Backend: Executing saveDatabase...');
        if (!db) {
            console.error('Backend: saveDatabase failed: db is null');
            return;
        }
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
        console.log('Backend: Database saved to file, size:', buffer.length, 'bytes');
    } catch (error) {
        console.error('Backend: Failed to save database:', error);
    }
}

// 查询辅助函数
function queryOne(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        if (!stmt) {
            console.error('queryOne 失败: 无法准备 SQL 语句', sql, params);
            return null;
        }
        if (params && params.length > 0) {
            stmt.bind(params);
        }
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
        }
        stmt.free();
        return null;
    } catch (error) {
        console.error('queryOne 失败:', sql, params, error);
        return null;
    }
}

function queryAll(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        if (params && params.length > 0) {
            stmt.bind(params);
        }
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    } catch (error) {
        console.error('queryAll 失败:', sql, params, error);
        return [];
    }
}

function run(sql, params = []) {
    try {
        console.log('Backend RUN SQL:', sql, params);
        db.run(sql, params);
        const rowsModified = db.getRowsModified();
        console.log('Backend RUN SQL: Affecting rows:', rowsModified);

        let lastId = null;
        if (sql.toUpperCase().startsWith('INSERT INTO')) {
            // 对于 INSERT 操作，尝试获取最后插入的ID
            const result = queryOne('SELECT last_insert_rowid() as id');
            if (result && result.id !== null && result.id !== 0) { // 检查ID是否有效且非0
                lastId = result.id;
                console.log('Backend RUN SQL: last_insert_rowid returned:', lastId);
            } else {
                console.warn('Backend RUN SQL: last_insert_rowid() returned 0 or null after INSERT. Attempting MAX(id) fallback.');
                // 备用方案：如果 last_insert_rowid 失败，尝试查询 MAX(id)
                const tableName = sql.split(' ')[2]; // 从SQL中提取表名 (e.g., INSERT INTO <table> ...)
                if (tableName) {
                    const maxIdResult = queryOne(`SELECT MAX(id) as id FROM ${tableName}`);
                    if (maxIdResult && maxIdResult.id !== null && maxIdResult.id !== 0) {
                        lastId = maxIdResult.id;
                        console.log('Backend RUN SQL: MAX(id) fallback returned:', lastId);
                    }
                }
            }
        }

        saveDatabase();
        return lastId || rowsModified; // 对于非INSERT操作，返回影响行数；对于INSERT，返回lastId (如果获取到)
    } catch (error) {
        console.error('Backend RUN SQL: Failed:', sql, params, error);
        throw error;
    }
}

function lastInsertRowId() {
    try {
        console.log('lastInsertRowId 调用');
        const result = queryOne('SELECT last_insert_rowid() as id');
        console.log('lastInsertRowId 查询结果:', result);
        return result ? result.id : null;
    } catch (error) {
        console.error('获取 last_insert_rowid 失败:', error);
        return null;
    }
}

// ==================== 节点 API ====================

app.get('/api/nodes', (req, res) => {
    try {
        const graphId = parseInt(req.query.graphId || '1', 10) || 1;
        const nodesRaw = queryAll('SELECT * FROM nodes WHERE graphId = ? ORDER BY id', [graphId]);
        // 将 tasks 从 JSON 字符串解析为数组
        const nodes = nodesRaw.map(n => ({
            ...n,
            tasks: n.tasks ? JSON.parse(n.tasks) : []
        }));
        console.log('获取节点:', nodes.length, '个');
        res.json(nodes);
    } catch (error) {
        console.error('获取节点失败:', error);
        res.status(500).json({ error: '获取节点失败' });
    }
});

app.post('/api/nodes', (req, res) => {
    try {
        const { graphId, x, y, radius, name, type, color, taskListName, tasks } = req.body;
        const gid = parseInt(graphId || '1', 10) || 1;
        console.log('创建节点:', req.body);
        
        const newId = run(
            'INSERT INTO nodes (graphId, x, y, radius, name, type, color, taskListName, tasks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [gid, x, y, radius, name, type, color, taskListName || '', tasks ? JSON.stringify(tasks) : '[]']
        );
        
        console.log('Backend: run function returned ID for new node:', newId);

        if (newId === null || newId === 0) {
            console.error('Backend: Failed to get valid ID after node insert.');
            return res.status(500).json({ error: '创建节点失败: 无法获取新创建的节点ID' });
        }

        const node = queryOne('SELECT * FROM nodes WHERE id = ?', [newId]);
        if (node) {
            res.json(node);
        } else {
            console.error('Backend: Could not find newly created node with ID:', newId);
            res.status(500).json({ error: '创建节点失败: 无法查询到新创建的节点' });
        }
    } catch (error) {
        console.error('创建节点失败:', error);
        res.status(500).json({ error: '创建节点失败: ' + error.message });
    }
});

app.put('/api/nodes/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { graphId, x, y, radius, name, type, color, taskListName, tasks } = req.body;
        const gid = parseInt(graphId || '1', 10) || 1;
        const tasksJson = tasks ? JSON.stringify(tasks) : '[]';
        
        run(
            'UPDATE nodes SET graphId = ?, x = ?, y = ?, radius = ?, name = ?, type = ?, color = ?, taskListName = ?, tasks = ? WHERE id = ?',
            [gid, x, y, radius, name, type, color, taskListName || '', tasksJson, id]
        );
        
        const node = queryOne('SELECT * FROM nodes WHERE id = ?', [id]);
        res.json(node);
    } catch (error) {
        console.error('更新节点失败:', error);
        res.status(500).json({ error: '更新节点失败' });
    }
});

app.delete('/api/nodes/:id', (req, res) => {
    try {
        const { id } = req.params;
        run('DELETE FROM edges WHERE sourceId = ? OR targetId = ?', [id, id]);
        run('DELETE FROM nodes WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('删除节点失败:', error);
        res.status(500).json({ error: '删除节点失败' });
    }
});

// ==================== 边（关系）API ====================

app.get('/api/edges', (req, res) => {
    try {
        const graphId = parseInt(req.query.graphId || '1', 10) || 1;
        const edgesRaw = queryAll('SELECT * FROM edges WHERE graphId = ? ORDER BY id', [graphId]);
        // 将 tasks/bendPoints 从 JSON 字符串解析为数组
        const edges = edgesRaw.map(e => ({
            ...e,
            bendPoints: e.bendPoints ? JSON.parse(e.bendPoints) : [],
            tasks: e.tasks ? JSON.parse(e.tasks) : []
        }));
        res.json(edges);
    } catch (error) {
        console.error('获取边失败:', error);
        res.status(500).json({ error: '获取边失败' });
    }
});

app.post('/api/edges', (req, res) => {
    try {
        const { graphId, sourceId, targetId, label, color, bendPoints, tasks } = req.body;
        const gid = parseInt(graphId || '1', 10) || 1;
        const bendPointsJson = bendPoints ? JSON.stringify(bendPoints) : '[]';
        const tasksJson = tasks ? JSON.stringify(tasks) : '[]';
        console.log('Backend: Inserting edge:', { sourceId, targetId, label, color, bendPoints, tasks });
        const newId = run(
            'INSERT INTO edges (graphId, sourceId, targetId, label, color, bendPoints, tasks) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [gid, sourceId, targetId, label, color, bendPointsJson, tasksJson]
        );
        
        console.log('Backend: run function returned ID for new edge:', newId);

        if (newId === null || newId === 0) { // 检查ID是否有效
            console.error('Backend: Failed to get valid ID after edge insert.');
            return res.status(500).json({ error: '创建边失败: 无法获取新创建的边ID' });
        }

        let edge = queryOne('SELECT * FROM edges WHERE id = ?', [newId]);
        if (edge) {
            edge = {
                ...edge,
                bendPoints: edge.bendPoints ? JSON.parse(edge.bendPoints) : [],
                tasks: edge.tasks ? JSON.parse(edge.tasks) : []
            };
            res.json(edge);
        } else {
            console.error('Backend: Could not find newly created edge with ID:', newId);
            res.status(500).json({ error: '创建边失败: 无法查询到新创建的边' });
        }
    } catch (error) {
        console.error('Backend: Failed to create edge:', error);
        res.status(500).json({ error: '创建边失败' });
    }
});

app.put('/api/edges/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { graphId, sourceId, targetId, label, color, bendPoints, tasks } = req.body;
        const gid = parseInt(graphId || '1', 10) || 1;
        const bendPointsJson = bendPoints ? JSON.stringify(bendPoints) : '[]';
        const tasksJson = tasks ? JSON.stringify(tasks) : '[]';
        
        run(
            'UPDATE edges SET graphId = ?, sourceId = ?, targetId = ?, label = ?, color = ?, bendPoints = ?, tasks = ? WHERE id = ?',
            [gid, sourceId, targetId, label, color, bendPointsJson, tasksJson, id]
        );
        
        let edge = queryOne('SELECT * FROM edges WHERE id = ?', [id]);
        if (edge) {
            edge = {
                ...edge,
                bendPoints: edge.bendPoints ? JSON.parse(edge.bendPoints) : [],
                tasks: edge.tasks ? JSON.parse(edge.tasks) : []
            };
        }
        res.json(edge);
    } catch (error) {
        console.error('更新边失败:', error);
        res.status(500).json({ error: '更新边失败' });
    }
});

app.delete('/api/edges/:id', (req, res) => {
    try {
        const { id } = req.params;
        console.log('Backend: Attempting to delete edge with id:', id);
        const rowsModified = run('DELETE FROM edges WHERE id = ?', [id]);
        console.log('Backend: Rows modified by delete:', rowsModified);
        res.json({ success: true, rowsModified });
    } catch (error) {
        console.error('Backend: Failed to delete edge:', error);
        res.status(500).json({ error: '删除边失败' });
    }
});

// ==================== 其他操作 API ====================

app.delete('/api/clear', (req, res) => {
    try {
        run('DELETE FROM edges');
        run('DELETE FROM nodes');
        res.json({ success: true });
    } catch (error) {
        console.error('清空数据失败:', error);
        res.status(500).json({ error: '清空数据失败' });
    }
});

app.get('/api/export', (req, res) => {
    try {
        if (!fs.existsSync(DB_PATH)) {
            return res.status(404).json({ error: '数据库文件不存在' });
        }
        res.download(DB_PATH, 'graph.db', (err) => {
            if (err) {
                console.error('导出失败:', err);
            }
        });
    } catch (error) {
        console.error('导出失败:', error);
        res.status(500).json({ error: '导出失败' });
    }
});

const upload = multer({ dest: path.join(__dirname, 'uploads') });
app.post('/api/import', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '没有上传文件' });
        }
        
        const uploadedPath = req.file.path;
        
        // 验证上传的文件
        const stats = fs.statSync(uploadedPath);
        if (stats.size === 0) {
            fs.unlinkSync(uploadedPath);
            return res.status(400).json({ error: '上传的文件为空' });
        }
        
        // 备份当前数据库
        const backupPath = DB_PATH + '.backup.' + Date.now();
        if (fs.existsSync(DB_PATH)) {
            fs.copyFileSync(DB_PATH, backupPath);
        }
        
        // 替换数据库文件
        fs.copyFileSync(uploadedPath, DB_PATH);
        
        // 重新加载数据库
        const initSqlJs = require('sql.js');
        const SQL = await initSqlJs();
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
        
        // 删除上传的临时文件
        fs.unlinkSync(uploadedPath);
        
        res.json({ success: true, message: '导入成功' });
    } catch (error) {
        console.error('导入失败:', error);
        res.status(500).json({ error: '导入失败: ' + error.message });
    }
});

app.get('/api/info', (req, res) => {
    try {
        const nodeCount = queryOne('SELECT COUNT(*) as count FROM nodes')?.count || 0;
        const edgeCount = queryOne('SELECT COUNT(*) as count FROM edges')?.count || 0;
        
        res.json({
            nodeCount,
            edgeCount,
            dbPath: DB_PATH
        });
    } catch (error) {
        console.error('获取信息失败:', error);
        res.status(500).json({ error: '获取信息失败' });
    }
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
║   数据库: ${DB_PATH}  ║
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
    if (db) {
        saveDatabase();
    }
    process.exit(0);
});
