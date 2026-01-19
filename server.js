const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 数据库路径
const DB_PATH = path.join(__dirname, 'data', 'graph.db');

// 确保数据目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化 sql.js
let db;

async function initDatabase() {
    try {
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
            CREATE TABLE IF NOT EXISTS nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                x REAL,
                y REAL,
                radius REAL,
                name TEXT,
                type TEXT,
                color TEXT
            );
            
            CREATE TABLE IF NOT EXISTS edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sourceId INTEGER,
                targetId INTEGER,
                label TEXT,
                color TEXT,
                FOREIGN KEY (sourceId) REFERENCES nodes(id),
                FOREIGN KEY (targetId) REFERENCES nodes(id)
            );
        `);
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

// 保存数据库到文件
function saveDatabase() {
    try {
        console.info('执行保存');
        if (!db) {
            console.error('saveDatabase 失败: db 为空');
            return;
        }
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
        console.log('数据库已保存到文件, 大小:', buffer.length, 'bytes');
    } catch (error) {
        console.error('保存数据库失败:', error);
    }
}

// 查询辅助函数
function queryOne(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
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
        console.log('执行 SQL:', sql, params);
        db.run(sql, params);
        const rowsModified = db.getRowsModified();
        console.log('影响行数:', rowsModified);
        saveDatabase();
        return rowsModified;
    } catch (error) {
        console.error('执行 SQL 失败:', sql, params, error);
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
        const nodes = queryAll('SELECT * FROM nodes ORDER BY id');
        console.log('获取节点:', nodes.length, '个');
        res.json(nodes);
    } catch (error) {
        console.error('获取节点失败:', error);
        res.status(500).json({ error: '获取节点失败' });
    }
});

app.post('/api/nodes', (req, res) => {
    try {
        const { x, y, radius, name, type, color } = req.body;
        console.log('创建节点:', req.body);
        
        run(
            'INSERT INTO nodes (x, y, radius, name, type, color) VALUES (?, ?, ?, ?, ?, ?)',
            [x, y, radius, name, type, color]
        );
        
        // sql.js 的 last_insert_rowid() 有时返回 0，改用查询最大 ID
        const maxNode = queryOne('SELECT * FROM nodes WHERE id = (SELECT MAX(id) FROM nodes)');
        console.log('查询最大节点:', maxNode);
        
        if (maxNode) {
            res.json(maxNode);
        } else {
            // 如果查询失败，返回输入数据（ID 由前端临时生成）
            const tempNode = { x, y, radius, name, type, color };
            console.log('返回临时节点:', tempNode);
            res.json(tempNode);
        }
    } catch (error) {
        console.error('创建节点失败:', error);
        res.status(500).json({ error: '创建节点失败: ' + error.message });
    }
});

app.put('/api/nodes/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { x, y, radius, name, type, color } = req.body;
        
        run(
            'UPDATE nodes SET x = ?, y = ?, radius = ?, name = ?, type = ?, color = ? WHERE id = ?',
            [x, y, radius, name, type, color, id]
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
        const edges = queryAll('SELECT * FROM edges ORDER BY id');
        res.json(edges);
    } catch (error) {
        console.error('获取边失败:', error);
        res.status(500).json({ error: '获取边失败' });
    }
});

app.post('/api/edges', (req, res) => {
    try {
        const { sourceId, targetId, label, color } = req.body;
        run(
            'INSERT INTO edges (sourceId, targetId, label, color) VALUES (?, ?, ?, ?)',
            [sourceId, targetId, label, color]
        );
        
        const id = lastInsertRowId();
        const edge = queryOne('SELECT * FROM edges WHERE id = ?', [id]);
        res.json(edge);
    } catch (error) {
        console.error('创建边失败:', error);
        res.status(500).json({ error: '创建边失败' });
    }
});

app.put('/api/edges/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { sourceId, targetId, label, color } = req.body;
        
        run(
            'UPDATE edges SET sourceId = ?, targetId = ?, label = ?, color = ? WHERE id = ?',
            [sourceId, targetId, label, color, id]
        );
        
        const edge = queryOne('SELECT * FROM edges WHERE id = ?', [id]);
        res.json(edge);
    } catch (error) {
        console.error('更新边失败:', error);
        res.status(500).json({ error: '更新边失败' });
    }
});

app.delete('/api/edges/:id', (req, res) => {
    try {
        const { id } = req.params;
        run('DELETE FROM edges WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('删除边失败:', error);
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
║   - DELETE /api/clear        - 清空所有数据               ║
║   - GET    /api/export       - 导出数据库                 ║
║   - POST   /api/import       - 导入数据库                 ║
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
