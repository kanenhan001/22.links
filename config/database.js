// 数据库配置文件
// 支持环境变量和默认配置
const config = {
    host: process.env.DB_HOST || '82.156.210.116',
    user: process.env.DB_USER || 'hanmanyi',
    password: process.env.DB_PASSWORD || 'wucheng123',
    database: process.env.DB_NAME || 'graph_editor',
    port: parseInt(process.env.DB_PORT) || 3309,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

module.exports = config;
