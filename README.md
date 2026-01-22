# 关系图编辑器 - Node.js 版本

## 项目概述

这是一个基于 Node.js 的关系图编辑器，支持节点和边的可视化编辑，以及数据的持久化存储。

## 技术栈

- **后端**: Node.js + Express
- **数据库**: MySQL (使用 mysql2 驱动)
- **前端**: HTML + CSS + JavaScript (原生)
- **其他**: Session 管理、文件上传/下载

## 核心特性

### 数据库架构

项目使用 **MySQL** 作为数据库，具有以下特点：

1. **连接池管理** - 使用 mysql2 连接池，支持并发连接
2. **异步操作** - 所有数据库操作都是异步的，使用 async/await
3. **事务支持** - 导入数据时使用事务，确保数据一致性
4. **外键约束** - 使用 InnoDB 引擎，支持外键和级联删除

## 安装说明

### 前置条件

1. **Node.js** - 建议 v16.x 或更高版本
2. **MySQL** - 建议 5.7+ 或 8.0+

### 安装步骤

1. **安装依赖**
```bash
npm install
```

2. **配置 MySQL 数据库**
   - 创建数据库：`CREATE DATABASE graph_editor DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci;`
   - 创建用户并授权：
     ```sql
     CREATE USER 'graph_user'@'localhost' IDENTIFIED BY 'your_password';
     GRANT ALL PRIVILEGES ON graph_editor.* TO 'graph_user'@'localhost';
     FLUSH PRIVILEGES;
     ```

3. **配置环境变量** (可选)
```bash
# Windows (PowerShell)
$env:DB_HOST = 'localhost'
$env:DB_USER = 'root'
$env:DB_PASSWORD = 'your_password'
$env:DB_NAME = 'graph_editor'
$env:DB_PORT = 3306
$env:SESSION_SECRET = 'your_secret_key'

# Linux/Mac
export DB_HOST=localhost
export DB_USER=root
export DB_PASSWORD=your_password
export DB_NAME=graph_editor
export DB_PORT=3306
export SESSION_SECRET=your_secret_key
```

4. **启动服务**
```bash
npm start
```

5. **访问应用**
```
http://localhost:3000
```

## 数据库配置

### 默认配置

```javascript
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'graph_editor',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};
```

### 使用环境变量配置

推荐使用环境变量来配置数据库连接，这样可以避免在代码中硬编码敏感信息。

**Windows (PowerShell)**:
```powershell
$env:DB_HOST = 'localhost'
$env:DB_USER = 'graph_user'
$env:DB_PASSWORD = 'your_secure_password'
$env:DB_NAME = 'graph_editor'
$env:DB_PORT = 3306
$env:SESSION_SECRET = 'your-session-secret-key-keep-it-safe'

npm start
```

**Linux/Mac**:
```bash
export DB_HOST=localhost
export DB_USER=graph_user
export DB_PASSWORD=your_secure_password
export DB_NAME=graph_editor
export DB_PORT=3306
export SESSION_SECRET=your-session-secret-key-keep-it-safe

npm start
```

## 常见问题

### 问题 1: 数据库连接失败

**错误信息**:
```
Error: connect ECONNREFUSED 127.0.0.1:3306
```

**解决方案**:

1. **检查 MySQL 服务是否启动**
   ```bash
   # Windows
   net start mysql

   # Linux
   sudo systemctl start mysql

   # Mac
   brew services start mysql
   ```

2. **检查数据库配置**
   - 确保数据库主机、端口、用户名、密码正确
   - 确保数据库已创建：`CREATE DATABASE graph_editor`
   - 确保用户有访问权限：`GRANT ALL ON graph_editor.* TO 'user'@'localhost'`

3. **检查防火墙设置**
   - 确保 3306 端口没有被防火墙阻止

### 问题 2: 表不存在或字段不存在

**错误信息**:
```
Error: Table 'graph_editor.nodes' doesn't exist
```

**解决方案**:

- 服务启动时会自动创建表和缺失的字段
- 如果仍然有问题，可以手动删除数据库，然后重启服务：
  ```sql
  DROP DATABASE graph_editor;
  CREATE DATABASE graph_editor DEFAULT CHARSET utf8mb4;
  ```

### 问题 3: 导入数据失败

**错误信息**:
```
Error: Invalid JSON format
```

**解决方案**:

- 确保导入的文件是有效的 JSON 格式
- 确保文件包含 `version` 和 `graphs` 字段
- 可以使用 `/api/export` 导出数据作为模板

## API 端点

### 认证 API

- `POST /api/auth/mock` - 模拟登录/注册
- `GET /api/auth/wechat/start` - 微信扫码登录 (需配置环境变量)
- `GET /api/auth/wechat/callback` - 微信登录回调
- `GET /api/auth/user` - 获取当前用户信息
- `POST /api/auth/logout` - 登出

### 关系图 API

- `GET /api/graphs` - 获取所有关系图
- `POST /api/graphs` - 创建关系图
- `PUT /api/graphs/:id` - 更新关系图
- `DELETE /api/graphs/:id` - 删除关系图
- `GET /api/graphs/:id` - 获取关系图详情 (包含节点和边)

### 节点 API

- `GET /api/nodes?graphId=:id` - 获取指定关系图的所有节点
- `POST /api/nodes` - 创建节点
- `PUT /api/nodes/:id` - 更新节点
- `DELETE /api/nodes/:id` - 删除节点

### 边 API

- `GET /api/edges?graphId=:id` - 获取指定关系图的所有边
- `POST /api/edges` - 创建边
- `PUT /api/edges/:id` - 更新边
- `DELETE /api/edges/:id` - 删除边

### 导入导出 API

- `GET /api/export` - 导出数据为 JSON 格式
- `POST /api/import` - 导入 JSON 格式的数据

## 数据存储

### 数据库路径

MySQL 数据库存储在 MySQL 服务器中，默认数据库名称为 `graph_editor`。

### 数据备份

建议定期备份数据库：

```bash
# 备份数据库
mysqldump -u root -p graph_editor > graph_editor_backup.sql

# 恢复数据库
mysql -u root -p graph_editor < graph_editor_backup.sql
```

## 开发指南

### 数据库操作

项目提供了三个核心数据库操作函数：

```javascript
// 查询单个结果
async function queryOne(sql, params = [])

// 查询多个结果
async function queryAll(sql, params = [])

// 执行 INSERT/UPDATE/DELETE
async function run(sql, params = [])
```

### 示例代码

```javascript
// 查询用户
const user = await queryOne('SELECT * FROM users WHERE id = ?', [1]);

// 查询所有节点
const nodes = await queryAll('SELECT * FROM nodes WHERE graphId = ?', [1]);

// 插入新节点
const newId = await run(
    'INSERT INTO nodes (graphId, x, y, radius, name) VALUES (?, ?, ?, ?, ?)',
    [1, 100, 200, 50, '新节点']
);
```

## 部署建议

### 生产环境

1. **使用进程管理器**
   ```bash
   npm install -g pm2
   pm2 start server.js --name graph-editor
   ```

2. **配置环境变量**
   ```bash
   # 微信登录配置 (可选)
   WECHAT_APPID=your_app_id
   WECHAT_SECRET=your_secret
   WECHAT_CALLBACK_URL=http://yourdomain.com/api/auth/wechat/callback
   
   # Session 密钥
   SESSION_SECRET=your_secret_key
   
   # 数据库配置
   DB_HOST=localhost
   DB_USER=graph_user
   DB_PASSWORD=your_secure_password
   DB_NAME=graph_editor
   DB_PORT=3306
   ```

3. **启用 HTTPS**
   - 使用 Nginx 反向代理
   - 配置 SSL 证书

4. **定期备份**
   - 配置定时任务自动备份数据库
   - 考虑使用云存储备份

5. **数据库优化**
   - 为常用查询字段创建索引
   - 定期优化表：`OPTIMIZE TABLE nodes, edges, graphs`
   - 考虑分库分表（如果数据量很大）

## 贡献指南

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License
