// 数据库配置文件
// 支持环境变量和默认配置
const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'graph_editor',
    port: parseInt(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    drawioUrl: process.env.DRAWIO_URL || 'http://localhost:8080'
};

module.exports = config;
