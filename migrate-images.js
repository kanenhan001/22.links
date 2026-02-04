// 图片数据迁移脚本
// 将 nodes 表中的 image 字段数据迁移到 node_images 表中

const mysql = require('mysql2/promise');
const DB_CONFIG = require('./config/database');

async function migrateImages() {
    let connection;
    
    try {
        // 创建数据库连接
        connection = await mysql.createConnection(DB_CONFIG);
        console.log('✅ 成功连接到数据库');
        
        // 检查 node_images 表是否存在
        const [checkTable] = await connection.execute(
            "SHOW TABLES LIKE 'node_images'"
        );
        
        if (checkTable.length === 0) {
            console.error('❌ node_images 表不存在，请先创建该表');
            return;
        }
        
        // 查询 nodes 表中所有有 image 数据的记录
        const [nodesWithImages] = await connection.execute(
            "SELECT id, image FROM nodes WHERE image IS NOT NULL AND image != '' AND LENGTH(image) > 10"
        );
        
        console.log(`📊 找到 ${nodesWithImages.length} 个节点包含图片数据`);
        
        if (nodesWithImages.length === 0) {
            console.log('✅ 没有需要迁移的图片数据');
            return;
        }
        
        // 开始迁移数据
        console.log('🚀 开始迁移图片数据...');
        
        let migratedCount = 0;
        let skippedCount = 0;
        
        for (const node of nodesWithImages) {
            try {
                // 检查 node_images 表中是否已存在该节点的图片记录
                const [existingImage] = await connection.execute(
                    'SELECT id FROM node_images WHERE nodeId = ?',
                    [node.id]
                );
                
                if (existingImage.length > 0) {
                    console.log(`⏭️  节点 ${node.id} 的图片记录已存在，跳过`);
                    skippedCount++;
                    continue;
                }
                
                // 插入图片数据到 node_images 表
                await connection.execute(
                    'INSERT INTO node_images (nodeId, imageData) VALUES (?, ?)',
                    [node.id, node.image]
                );
                
                migratedCount++;
                console.log(`✅ 成功迁移节点 ${node.id} 的图片数据`);
                
            } catch (error) {
                console.error(`❌ 迁移节点 ${node.id} 的图片数据失败:`, error.message);
                skippedCount++;
            }
        }
        
        // 迁移完成后，清空 nodes 表中的 image 字段
        console.log('🧹 清空 nodes 表中的 image 字段...');
        await connection.execute(
            "UPDATE nodes SET image = NULL WHERE image IS NOT NULL AND image != '' AND LENGTH(image) > 10"
        );
        
        console.log('\n📋 迁移完成报告:');
        console.log(`✅ 成功迁移: ${migratedCount} 条记录`);
        console.log(`⏭️  跳过: ${skippedCount} 条记录`);
        console.log(`📊 总计处理: ${nodesWithImages.length} 条记录`);
        console.log('✅ 迁移任务完成！');
        
    } catch (error) {
        console.error('❌ 迁移过程中发生错误:', error);
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 数据库连接已关闭');
        }
    }
}

// 运行迁移脚本
migrateImages();