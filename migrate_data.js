const mysql = require('mysql2/promise');

// 数据库连接配置
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'graph_editor',
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

async function migrateData() {
    let connection;
    
    try {
        // 建立数据库连接
        connection = await mysql.createConnection(dbConfig);
        console.log('数据库连接成功');
        
        // 读取nodes表中的数据
        const [nodes] = await connection.execute('SELECT id, tasks, files FROM nodes WHERE (tasks IS NOT NULL AND tasks != "[]") OR (files IS NOT NULL AND files != "[]")');
        console.log(`找到 ${nodes.length} 个需要迁移数据的节点`);
        
        // 遍历每个节点，迁移数据
        let taskCount = 0;
        let fileCount = 0;
        
        for (const node of nodes) {
            const nodeId = node.id;
            
            // 迁移tasks数据
            if (node.tasks && node.tasks !== '[]') {
                try {
                    const tasks = JSON.parse(node.tasks);
                    if (Array.isArray(tasks) && tasks.length > 0) {
                        for (const task of tasks) {
                            if (task.title) {
                                await connection.execute(
                                    'INSERT INTO tasks (nodeId, title, done, sortOrder) VALUES (?, ?, ?, ?)',
                                    [nodeId, task.title, task.done || false, task.sortOrder || 0]
                                );
                                taskCount++;
                            }
                        }
                    }
                } catch (error) {
                    console.error(`迁移节点 ${nodeId} 的tasks数据失败:`, error);
                }
            }
            
            // 迁移files数据
            if (node.files && node.files !== '[]') {
                try {
                    const files = JSON.parse(node.files);
                    if (Array.isArray(files) && files.length > 0) {
                        for (const file of files) {
                            if (file.name) {
                                // 转换日期时间格式为MySQL支持的格式
                                let uploadedAt = new Date();
                                if (file.uploadDate) {
                                    uploadedAt = new Date(file.uploadDate);
                                }
                                const mysqlDatetime = uploadedAt.toISOString().slice(0, 19).replace('T', ' ');
                                
                                await connection.execute(
                                    'INSERT INTO files (nodeId, name, size, url, type, uploadedAt) VALUES (?, ?, ?, ?, ?, ?)',
                                    [
                                        nodeId,
                                        file.name,
                                        file.size || '',
                                        file.data || file.url || '',
                                        file.type || '',
                                        mysqlDatetime
                                    ]
                                );
                                fileCount++;
                            }
                        }
                    }
                } catch (error) {
                    console.error(`迁移节点 ${nodeId} 的files数据失败:`, error);
                }
            }
        }
        
        console.log(`数据迁移完成，共迁移了 ${taskCount} 个任务和 ${fileCount} 个文件`);
        
    } catch (error) {
        console.error('数据迁移失败:', error);
    } finally {
        // 关闭数据库连接
        if (connection) {
            await connection.end();
            console.log('数据库连接已关闭');
        }
    }
}

// 执行数据迁移
migrateData();
