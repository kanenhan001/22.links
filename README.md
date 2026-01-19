# 关系图编辑器

一个基于 Node.js + SQLite 的关系图编辑器，支持节点的增删改查、关系的建立以及数据的导入导出。

## 技术栈

- **前端**: 原生 JavaScript + Canvas + CSS3
- **后端**: Node.js + Express
- **数据库**: SQLite (better-sqlite3)

## 功能特性

- ✨ 可视化节点和关系编辑
- 🔄 节点拖拽移动
- 💾 数据持久化存储到 SQLite 数据库
- 📤 导出数据库文件
- 📂 导入数据库文件
- 🎨 自定义节点颜色和类型
- 🔗 支持多种关系类型

## 安装与运行

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务器

```bash
npm start
```

### 3. 访问应用

打开浏览器访问: http://localhost:3000

## 项目结构

```
graph-editor/
├── server.js          # Express 服务器
├── package.json       # 项目配置
├── data/              # 数据库存储目录
│   └── graph.db       # SQLite 数据库文件
└── public/            # 前端静态资源
    ├── index.html     # 主页面
    ├── app.js         # 前端逻辑
    └── styles.css     # 样式文件
```

## API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/nodes | 获取所有节点 |
| POST | /api/nodes | 创建节点 |
| PUT | /api/nodes/:id | 更新节点 |
| DELETE | /api/nodes/:id | 删除节点 |
| GET | /api/edges | 获取所有关系 |
| POST | /api/edges | 创建关系 |
| PUT | /api/edges/:id | 更新关系 |
| DELETE | /api/edges/:id | 删除关系 |
| DELETE | /api/clear | 清空所有数据 |
| GET | /api/export | 导出数据库文件 |
| POST | /api/import | 导入数据库文件 |

## 数据库结构

### nodes 表
| 字段 | 类型 | 描述 |
|------|------|------|
| id | INTEGER | 节点 ID (主键) |
| x | REAL | X 坐标 |
| y | REAL | Y 坐标 |
| radius | REAL | 节点半径 |
| name | TEXT | 节点名称 |
| type | TEXT | 节点类型 |
| color | TEXT | 节点颜色 |

### edges 表
| 字段 | 类型 | 描述 |
|------|------|------|
| id | INTEGER | 关系 ID (主键) |
| sourceId | INTEGER | 源节点 ID |
| targetId | INTEGER | 目标节点 ID |
| label | TEXT | 关系标签 |
| color | TEXT | 关系颜色 |

## 许可证

MIT
