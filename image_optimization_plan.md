# 节点图片存储优化方案

## 问题分析
当前nodes表中的image字段存储了base64编码的图片数据，类型为longtext。当加载节点时，这些图片数据会一并加载，导致：
1. 数据传输量增加
2. 节点加载速度变慢
3. 内存占用增加

## 解决方案
1. **创建新的image表**：将图片数据从nodes表移到单独的表中
2. **修改后端API**：支持图片的单独存储和获取
3. **修改前端代码**：实现图片的异步加载

## 表结构设计

### 新表：node_images
| 字段名 | 类型 | 约束 | 描述 |
|-------|------|------|------|
| id | INT | PRIMARY KEY, AUTO_INCREMENT | 图片ID |
| nodeId | INT | FOREIGN KEY REFERENCES nodes(id) ON DELETE CASCADE | 关联的节点ID |
| imageData | LONGTEXT | NULL | Base64编码的图片数据 |
| createdAt | DATETIME | DEFAULT CURRENT_TIMESTAMP | 创建时间 |
| updatedAt | DATETIME | DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | 更新时间 |

## 后端API修改
1. **修改节点加载API**：移除image字段，只返回基本信息
2. **新增图片获取API**：根据nodeId获取图片数据
3. **新增图片保存API**：保存图片数据到node_images表
4. **修改节点保存API**：处理图片数据的存储

## 前端代码修改
1. **修改节点加载逻辑**：不等待图片数据，直接渲染节点
2. **实现图片异步加载**：节点渲染后，异步获取图片数据
3. **修改图片上传逻辑**：使用新的API保存图片
4. **修改图片删除逻辑**：同步更新node_images表

## 预期效果
1. 节点加载速度显著提升
2. 内存占用减少
3. 用户体验改善，特别是在节点数量较多时