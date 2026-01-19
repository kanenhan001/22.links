class GraphEditor {
    constructor() {
        this.canvas = document.getElementById('graphCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.nodes = [];
        this.edges = [];
        this.selectedNode = null;
        this.selectedEdge = null;
        this.draggingNode = null;
        this.dragOffset = { x: 0, y: 0 };
        // 创建关系相关状态
        this.creatingEdge = false;
        this.edgeSourceNode = null;
        this.edgeMousePos = { x: 0, y: 0 };
    }
    
    static async create() {
        const editor = new GraphEditor();
        editor.setupEventListeners();
        await editor.loadData();
        return editor;
    }
    
    // ==================== API 调用 ====================
    
    async apiGet(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
    }
    
    async apiPost(url, data) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
    }
    
    async apiPut(url, data) {
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
    }
    
    async apiDelete(url) {
        const response = await fetch(url, { method: 'DELETE' });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
    }
    
    async loadData() {
        try {
            this.showStatus('正在加载数据...');
            const [nodes, edges] = await Promise.all([
                this.apiGet('/api/nodes'),
                this.apiGet('/api/edges')
            ]);
            this.nodes = nodes;
            this.edges = edges;
            this.showStatus(`已加载 ${nodes.length} 个节点, ${edges.length} 个关系`);
            this.render();
        } catch (error) {
            console.error('加载数据失败:', error);
            this.showStatus('加载数据失败: ' + error.message);
            alert('加载数据失败，请确保服务器已启动');
        }
    }
    
    async saveNode(node) {
        console.log('saveNode 被调用, id:', node.id);
        try {
            if (node.id) {
                console.log('更新节点:', node.id);
                await this.apiPut(`/api/nodes/${node.id}`, node);
            } else {
                console.log('新增节点');
                const result = await this.apiPost('/api/nodes', node);
                console.log('服务器返回:', result);
                
                if (result.id) {
                    node.id = result.id;
                }
                
                console.log('保存后 nodes 长度:', this.nodes.length);
            }
            this.showStatus('节点已保存');
        } catch (error) {
            console.error('保存节点失败:', error);
            this.showStatus('保存节点失败: ' + error.message);
        }
    }
    
    async saveEdge(edge) {
        try {
            if (edge.id) {
                await this.apiPut(`/api/edges/${edge.id}`, edge);
            } else {
                const result = await this.apiPost('/api/edges', edge);
                edge.id = result.id;
            }
            this.showStatus('关系已保存');
        } catch (error) {
            console.error('保存关系失败:', error);
            this.showStatus('保存关系失败: ' + error.message);
        }
    }
    
    async deleteNode(node) {
        try {
            await this.apiDelete(`/api/nodes/${node.id}`);
            this.nodes = this.nodes.filter(n => n.id !== node.id);
            this.edges = this.edges.filter(e => e.sourceId !== node.id && e.targetId !== node.id);
            this.showStatus('节点已删除');
        } catch (error) {
            console.error('删除节点失败:', error);
            this.showStatus('删除节点失败: ' + error.message);
        }
    }
    
    async deleteEdge(edge) {
        try {
            console.log('Attempting to delete edge on frontend with id:', edge.id);
            await this.apiDelete(`/api/edges/${edge.id}`);
            this.edges = this.edges.filter(e => e.id !== edge.id);
            console.log('Frontend: Edges after filter:', this.edges.length);
            this.showStatus('关系已删除');
        } catch (error) {
            console.error('删除关系失败:', error);
            this.showStatus('删除关系失败: ' + error.message);
        }
    }
    
    async clearAll() {
        try {
            await this.apiDelete('/api/clear');
            this.nodes = [];
            this.edges = [];
            this.showStatus('画布已清空');
        } catch (error) {
            console.error('清空失败:', error);
            this.showStatus('清空失败: ' + error.message);
        }
    }
    
    setupEventListeners() {
        this.canvas.addEventListener('click', this.handleCanvasClick.bind(this));
        this.canvas.addEventListener('dblclick', this.handleCanvasDoubleClick.bind(this)); // 新增双击事件
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', (e) => {
            // 如果正在创建关系，不取消（允许鼠标暂时离开画布）
            if (!this.creatingEdge) {
                this.handleMouseUp(e);
            }
        });
        
        // 键盘事件
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        
        // 按钮事件
        document.getElementById('addNodeBtn').addEventListener('click', () => this.showNodeModal());
        document.getElementById('clearBtn').addEventListener('click', this.handleClear.bind(this));
        document.getElementById('helpBtn').addEventListener('click', () => this.showHelpModal());
        
        this.setupModalListeners();
    }
    
    setupModalListeners() {
        // 使用事件委托，保证后插入的关闭按钮也能生效（如 helpModal 的关闭按钮）
        document.addEventListener('click', (e) => {
            const closeBtn = e.target.closest('.close');
            if (closeBtn) {
                const targetModalId = closeBtn.dataset.modalTarget;
                if (targetModalId) {
                    const modalEl = document.getElementById(targetModalId);
                    if (modalEl) {
                        modalEl.style.display = 'none';
                    }
                }
                e.stopPropagation(); // 阻止事件冒泡到 window，避免重复处理
                return;
            }
        });
        
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });
        
        document.getElementById('nodeForm').addEventListener('submit', this.handleNodeFormSubmit.bind(this));
        document.getElementById('edgeForm').addEventListener('submit', this.handleEdgeFormSubmit.bind(this));
        
        document.getElementById('propertiesContent').addEventListener('input', (e) => {
            // 处理 textarea 自动高度调整
            if (e.target.classList.contains('task-textarea')) {
                this.autoResizeTextarea(e.target);
            }
            // 只更新数据，不重新渲染，避免干扰 IME
            this.handlePropertyInput(e);
        });
        document.getElementById('propertiesContent').addEventListener('change', this.handlePropertyChange.bind(this));
        document.getElementById('propertiesContent').addEventListener('blur', (e) => {
            // 使用 blur 事件保存数据，避免干扰 IME
            if (e.target.dataset.taskField === 'title' || e.target.dataset.nodeTaskField === 'title') {
                this.handlePropertyChange(e);
            }
            // 保存清单名称
            if (e.target.classList.contains('task-list-name-input')) {
                const newValue = e.target.value.trim();
                this.selectedNode.taskListName = newValue;
                this.saveNode(this.selectedNode);
                this.updatePropertiesPanel();
            }
        }, true); // 使用捕获阶段，确保先触发
        document.getElementById('propertiesContent').addEventListener('click', this.handleTaskClick.bind(this));
        // 键盘事件处理（Enter 保存，Esc 取消）
        document.getElementById('propertiesContent').addEventListener('keydown', (e) => {
            if (e.target.classList.contains('task-list-name-input')) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const newValue = e.target.value.trim();
                    this.selectedNode.taskListName = newValue;
                    this.saveNode(this.selectedNode);
                    this.updatePropertiesPanel();
                    this.render();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    // 恢复原始值
                    const originalValue = e.target.dataset.originalValue || '';
                    this.selectedNode.taskListName = originalValue;
                    this.updatePropertiesPanel();
                }
            }
        });
    }
    
    handlePropertyChange(e) {
        // 处理节点的事项清单字段
        const nodeTaskField = e.target.dataset.nodeTaskField;
        if (nodeTaskField && this.selectedNode) {
            if (!Array.isArray(this.selectedNode.tasks)) {
                this.selectedNode.tasks = [];
            }
            const itemEl = e.target.closest('.task-item');
            if (!itemEl) return;
            const index = parseInt(itemEl.dataset.nodeTaskIndex, 10);
            if (Number.isNaN(index) || !this.selectedNode.tasks[index]) return;
            const task = this.selectedNode.tasks[index];

            if (nodeTaskField === 'title') {
                task.title = e.target.value;
            } else if (nodeTaskField === 'done') {
                task.done = !!e.target.checked;
            }

            this.saveNode(this.selectedNode);
            this.render();
            return;
        }

        // 处理关系的事项清单字段
        const taskField = e.target.dataset.taskField;
        if (taskField && this.selectedEdge) {
            if (!Array.isArray(this.selectedEdge.tasks)) {
                this.selectedEdge.tasks = [];
            }
            const itemEl = e.target.closest('.task-item');
            if (!itemEl) return;
            const index = parseInt(itemEl.dataset.taskIndex, 10);
            if (Number.isNaN(index) || !this.selectedEdge.tasks[index]) return;
            const task = this.selectedEdge.tasks[index];

            if (taskField === 'title') {
                task.title = e.target.value;
            } else if (taskField === 'done') {
                task.done = !!e.target.checked;
            }

            this.saveEdge(this.selectedEdge);
            this.render();
            return;
        }

        const prop = e.target.dataset.prop;
        if (!prop) return;

        if (this.selectedNode) {
            this.selectedNode[prop] = e.target.value;
            this.saveNode(this.selectedNode);
            this.render();
        } else if (this.selectedEdge) {
            this.selectedEdge[prop] = e.target.value;
            this.saveEdge(this.selectedEdge);
            this.render();
        }
    }

    // 处理输入事件（实时更新数据，但不重新渲染，避免干扰 IME）
    handlePropertyInput(e) {
        // 处理节点的事项清单字段
        const nodeTaskField = e.target.dataset.nodeTaskField;
        if (nodeTaskField && this.selectedNode) {
            if (!Array.isArray(this.selectedNode.tasks)) {
                this.selectedNode.tasks = [];
            }
            const itemEl = e.target.closest('.task-item');
            if (!itemEl) return;
            const index = parseInt(itemEl.dataset.nodeTaskIndex, 10);
            if (Number.isNaN(index) || !this.selectedNode.tasks[index]) return;
            const task = this.selectedNode.tasks[index];

            if (nodeTaskField === 'title') {
                task.title = e.target.value;
            }
            return;
        }

        // 处理关系的事项清单字段
        const taskField = e.target.dataset.taskField;
        if (taskField && this.selectedEdge) {
            if (!Array.isArray(this.selectedEdge.tasks)) {
                this.selectedEdge.tasks = [];
            }
            const itemEl = e.target.closest('.task-item');
            if (!itemEl) return;
            const index = parseInt(itemEl.dataset.taskIndex, 10);
            if (Number.isNaN(index) || !this.selectedEdge.tasks[index]) return;
            const task = this.selectedEdge.tasks[index];

            if (taskField === 'title') {
                task.title = e.target.value;
            }
        }
    }

    handleTaskClick(e) {
        // 点击发出的关系项，选中该关系
        const outgoingEdgeItem = e.target.closest('.outgoing-edge-item');
        if (outgoingEdgeItem) {
            const edgeId = outgoingEdgeItem.dataset.edgeId;
            if (edgeId) {
                const edge = this.edges.find(ed => ed.id === parseInt(edgeId));
                if (edge) {
                    this.selectedEdge = edge;
                    this.selectedNode = null;
                    this.updatePropertiesPanel();
                    this.render();
                }
            }
            return;
        }

        // 点击编辑按钮，切换为编辑模式
        const editBtn = e.target.closest('[data-action="edit-task-list-name"]');
        if (editBtn) {
            const header = editBtn.closest('.task-list-header');
            if (header) {
                const currentTitle = this.selectedNode.taskListName || '';
                header.innerHTML = `
                    <input type="text" class="task-list-name-input" 
                        data-prop="taskListName" 
                        placeholder="请输入事项清单名称（如：目标、待办等）" 
                        value="${currentTitle}"
                        data-original-value="${currentTitle}">
                `;
                const input = header.querySelector('.task-list-name-input');
                if (input) {
                    input.focus();
                    input.select();
                }
            }
            return;
        }

        // 新增节点事项
        if (e.target.id === 'addNodeTaskBtn') {
            const textarea = document.getElementById('newNodeTaskTitle');
            if (!textarea) return;
            const title = textarea.value.trim();
            if (!title) return;

            if (!Array.isArray(this.selectedNode.tasks)) {
                this.selectedNode.tasks = [];
            }

            this.selectedNode.tasks.push({
                id: Date.now(),
                title,
                done: false
            });

            textarea.value = '';
            this.saveNode(this.selectedNode);
            this.updatePropertiesPanel();
            this.render();
            return;
        }

        // 删除节点事项
        if (e.target.dataset.nodeTaskAction === 'delete') {
            const itemEl = e.target.closest('.task-item');
            if (!itemEl) return;
            const index = parseInt(itemEl.dataset.nodeTaskIndex, 10);
            if (Number.isNaN(index)) return;

            if (!Array.isArray(this.selectedNode.tasks)) {
                this.selectedNode.tasks = [];
            }

            this.selectedNode.tasks.splice(index, 1);
            this.saveNode(this.selectedNode);
            this.updatePropertiesPanel();
            this.render();
            return;
        }

        if (!this.selectedEdge) return;

        // 新增关系事项
        if (e.target.id === 'addTaskBtn') {
            const input = document.getElementById('newTaskTitle');
            if (!input) return;
            const title = input.value.trim();
            if (!title) return;

            if (!Array.isArray(this.selectedEdge.tasks)) {
                this.selectedEdge.tasks = [];
            }

            this.selectedEdge.tasks.push({
                id: Date.now(),
                title,
                done: false
            });

            input.value = '';
            this.saveEdge(this.selectedEdge);
            this.updatePropertiesPanel();
            this.render();
            return;
        }

        // 删除事项
        if (e.target.dataset.taskAction === 'delete') {
            const itemEl = e.target.closest('.task-item');
            if (!itemEl) return;
            const index = parseInt(itemEl.dataset.taskIndex, 10);
            if (Number.isNaN(index)) return;

            if (!Array.isArray(this.selectedEdge.tasks)) {
                this.selectedEdge.tasks = [];
            }

            this.selectedEdge.tasks.splice(index, 1);
            this.saveEdge(this.selectedEdge);
            this.updatePropertiesPanel();
            this.render();
        }
    }
    
    handleCanvasClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // 如果正在创建关系，处理点击事件 (点击空白处取消，点击节点切换源节点)
        if (this.creatingEdge) {
            for (let node of this.nodes) {
                if (this.isPointInNode(x, y, node)) {
                    if (node !== this.edgeSourceNode) {
                        this.edgeSourceNode = node;
                        this.selectedNode = node;
                        this.edgeMousePos = { x, y }; // 更新鼠标位置
                        this.updatePropertiesPanel();
                        this.showStatus(`创建关系模式：已选择源节点"${node.name}"，请拖拽到目标节点（或按ESC取消）`);
                        this.render();
                    }
                    return;
                }
            }
            this.cancelCreatingEdge(); // 点击空白处取消
            return;
        }
        
        // 正常模式下的点击处理
        this.selectedNode = null;
        this.selectedEdge = null;
        
        for (let edge of this.edges) {
            if (this.isPointOnEdge(x, y, edge)) {
                this.selectedEdge = edge;
                this.updatePropertiesPanel();
                this.render();
                return;
            }
        }
        
        for (let node of this.nodes) {
            if (this.isPointInNode(x, y, node)) {
                this.selectedNode = node; // 只选中，不进入创建模式
                this.updatePropertiesPanel();
                this.render();
                return;
            }
        }
        
        this.updatePropertiesPanel();
        this.render();
    }
    
    handleCanvasDoubleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // 检查双击是否发生在节点上
        for (let node of this.nodes) {
            if (this.isPointInNode(x, y, node)) {
                // 双击节点，进入创建关系模式
                this.selectedNode = node;
                this.edgeMousePos = { x, y }; // 初始化鼠标位置
                this.startCreatingEdge(node);
                this.updatePropertiesPanel();
                this.render();
                return;
            }
        }
    }
    
    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // 如果正在创建关系模式，不处理节点拖拽（只处理选择目标节点）
        if (this.creatingEdge) {
            // 更新鼠标位置，用于绘制临时线
            this.edgeMousePos = { x, y };
            this.render();
            return;
        }
        
        // 正常的拖拽节点
        for (let node of this.nodes) {
            if (this.isPointInNode(x, y, node)) {
                this.draggingNode = node;
                this.dragOffset = { x: x - node.x, y: y - node.y };
                return;
            }
        }
    }
    
    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // 如果正在创建关系，更新鼠标位置并重绘临时线
        if (this.creatingEdge && this.edgeSourceNode) {
            this.edgeMousePos = { x, y };
            this.render();
            return;
        }
        
        // 正常的拖拽节点
        if (this.draggingNode) {
            this.draggingNode.x = x - this.dragOffset.x;
            this.draggingNode.y = y - this.dragOffset.y;
            this.render();
        }
    }
    
    async handleMouseUp(e) {
        // 如果正在创建关系，检查是否释放在目标节点上
        if (this.creatingEdge && this.edgeSourceNode) {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            for (let node of this.nodes) {
                if (node !== this.edgeSourceNode && this.isPointInNode(x, y, node)) {
                    // 释放在目标节点上，创建关系
                    await this.createEdgeFromNodes(this.edgeSourceNode, node);
                    this.cancelCreatingEdge();
                    return;
                }
            }
            
            // 如果释放在空白处，保持创建关系模式，允许用户继续拖拽
            // 用户可以通过ESC键或点击空白处取消
        }
        
        // 正常的拖拽节点结束
        if (this.draggingNode) {
            await this.saveNode(this.draggingNode);
        }
        this.draggingNode = null;

        // 如果当前是创建关系模式，且鼠标松开后没有创建成功，但已经选择了源节点，则可以认为是想切换源节点
        // 但由于双击已经进入了创建模式，所以这里的mouseUp不应该取消，否则会影响双击后的拖拽
        // 如果需要取消，用户可以使用ESC键或单击空白处
    }
    
    handleKeyDown(e) {
        // 按 ESC 键取消创建关系模式
        if (e.key === 'Escape' && this.creatingEdge) {
            this.cancelCreatingEdge();
            return;
        }
        
        // 按 Delete 键删除选中项
        if (e.key === 'Delete' || e.key === 'Del') {
            // 模态框打开时不处理
            if (document.getElementById('nodeModal').style.display === 'block') return;
            if (document.getElementById('edgeModal').style.display === 'block') return;
            
            this.handleDelete();
        }
    }
    
    isPointInNode(x, y, node) {
        const distance = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
        return distance <= node.radius;
    }
    
    isPointOnEdge(x, y, edge) {
        const source = this.nodes.find(n => n.id === edge.sourceId);
        const target = this.nodes.find(n => n.id === edge.targetId);
        
        if (!source || !target) return false;
        
        // 找到同一对节点之间的所有边，计算当前边的偏移量
        // 使用与 groupEdgesByNodePair 相同的逻辑
        const samePairEdges = this.edges.filter(e => {
            const key1 = e.sourceId < e.targetId 
                ? `${e.sourceId}-${e.targetId}`
                : `${e.targetId}-${e.sourceId}`;
            const key2 = edge.sourceId < edge.targetId 
                ? `${edge.sourceId}-${edge.targetId}`
                : `${edge.targetId}-${edge.sourceId}`;
            return key1 === key2;
        });
        
        // 按ID排序，确保顺序一致
        samePairEdges.sort((a, b) => (a.id || 0) - (b.id || 0));
        
        const edgeIndex = samePairEdges.findIndex(e => e.id === edge.id);
        if (edgeIndex === -1) return false;
        
        const offset = this.calculateEdgeOffsetForPair(samePairEdges, edgeIndex);
        
        // 计算起点和终点（在节点边缘）
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const angle = Math.atan2(dy, dx);
        const perpAngle = angle + Math.PI / 2;
        
        const sourceX = source.x + Math.cos(angle) * source.radius;
        const sourceY = source.y + Math.sin(angle) * source.radius;
        const targetX = target.x - Math.cos(angle) * target.radius;
        const targetY = target.y - Math.sin(angle) * target.radius;
        
        if (offset === 0) {
            // 直线：计算点到直线的距离
            const A = targetY - sourceY;
            const B = sourceX - targetX;
            const C = targetX * sourceY - sourceX * targetY;
            
            const distance = Math.abs(A * x + B * y + C) / Math.sqrt(A * A + B * B);
            
            // 检查点是否在线段范围内
            const lineLength = Math.sqrt((targetX - sourceX) ** 2 + (targetY - sourceY) ** 2);
            const distToStart = Math.sqrt((x - sourceX) ** 2 + (y - sourceY) ** 2);
            const distToEnd = Math.sqrt((x - targetX) ** 2 + (y - targetY) ** 2);
            const onSegment = distToStart + distToEnd <= lineLength + 5;
            
            return distance < 8 && onSegment;
        } else {
            // 弧线：计算点到二次贝塞尔曲线的距离
            // 使用统一的垂直方向（基于标准化的节点对）
            let unifiedPerpAngle = perpAngle;
            if (samePairEdges.length > 1) {
                const minId = Math.min(edge.sourceId, edge.targetId);
                const maxId = Math.max(edge.sourceId, edge.targetId);
                const node1 = this.nodes.find(n => n.id === minId);
                const node2 = this.nodes.find(n => n.id === maxId);
                if (node1 && node2) {
                    const unifiedDx = node2.x - node1.x;
                    const unifiedDy = node2.y - node1.y;
                    const unifiedAngle = Math.atan2(unifiedDy, unifiedDx);
                    unifiedPerpAngle = unifiedAngle + Math.PI / 2;
                }
            }
            
            const midX = (sourceX + targetX) / 2;
            const midY = (sourceY + targetY) / 2;
            const controlX = midX + Math.cos(unifiedPerpAngle) * offset;
            const controlY = midY + Math.sin(unifiedPerpAngle) * offset;
            
            // 采样曲线上的点，计算最小距离
            let minDistance = Infinity;
            const samples = 50; // 采样点数
            
            for (let i = 0; i <= samples; i++) {
                const t = i / samples;
                // 二次贝塞尔曲线：B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
                const curveX = (1 - t) * (1 - t) * sourceX + 2 * (1 - t) * t * controlX + t * t * targetX;
                const curveY = (1 - t) * (1 - t) * sourceY + 2 * (1 - t) * t * controlY + t * t * targetY;
                
                const dist = Math.sqrt((x - curveX) ** 2 + (y - curveY) ** 2);
                if (dist < minDistance) {
                    minDistance = dist;
                }
            }
            
            return minDistance < 10; // 10像素的点击容差（弧线需要稍大的容差）
        }
    }
    
    // 为同一对节点的边计算偏移量
    calculateEdgeOffsetForPair(edges, index) {
        const totalEdges = edges.length;
        if (totalEdges === 1) {
            return 0;
        }
        
        const spacing = 40; // 与 calculateEdgeOffset 保持一致
        const offset = (index - (totalEdges - 1) / 2) * spacing;
        return offset;
    }
    
    showNodeModal(node = null) {
        const modal = document.getElementById('nodeModal');
        const title = document.getElementById('modalTitle');
        const form = document.getElementById('nodeForm');
        
        if (node) {
            console.log('打开编辑节点模态框, id:', node.id);
            title.textContent = '编辑节点';
            document.getElementById('nodeName').value = node.name;
            document.getElementById('nodeType').value = node.type;
            document.getElementById('nodeColor').value = node.color;
            form.dataset.nodeId = node.id;
        } else {
            console.log('打开新增节点模态框');
            title.textContent = '新增节点';
            form.reset();
            // 显式设置为空字符串，确保覆盖之前的值
            form.dataset.nodeId = '';
            form.removeAttribute('data-node-id');
            console.log('data-node-id 已处理');
        }
        
        modal.style.display = 'block';
    }
    
    showHelpModal() {
        const modal = document.getElementById('helpModal');
        modal.style.display = 'block';
    }
    
    startCreatingEdge(sourceNode = null) {
        this.creatingEdge = true;
        this.edgeSourceNode = sourceNode;
        if (sourceNode) {
            this.showStatus(`创建关系模式：已选择源节点"${sourceNode.name}"，请拖拽到目标节点（或按ESC取消）`);
        } else {
            this.showStatus('创建关系模式：请点击源节点，然后拖拽到目标节点（或按ESC取消）');
        }
        // 改变鼠标样式
        this.canvas.style.cursor = 'crosshair';
        if (!sourceNode) {
            this.render();
        }
    }
    
    cancelCreatingEdge() {
        this.creatingEdge = false;
        this.edgeSourceNode = null;
        this.edgeMousePos = { x: 0, y: 0 };
        this.showStatus('已取消创建关系模式');
        this.canvas.style.cursor = 'default';
        // 取消创建关系模式时，清除选中的节点
        this.selectedNode = null;
        this.render();
    }
    
    async createEdgeFromNodes(sourceNode, targetNode) {
        // 检查是否已存在相同的关系
        const existingEdge = this.edges.find(e => 
            e.sourceId === sourceNode.id && e.targetId === targetNode.id
        );
        
        if (existingEdge) {
            this.showStatus('关系已存在，请编辑现有关系');
            this.selectedEdge = existingEdge;
            this.cancelCreatingEdge();
            this.updatePropertiesPanel();
            this.render();
            return;
        }
        
        // 创建新关系，使用默认值
        // 创建新关系，使用默认值
        const newEdge = {
            sourceId: sourceNode.id,
            targetId: targetNode.id,
            label: '关系',
            color: '#e74c3c'
        };
        
        // 先保存到后端获取ID
        await this.saveEdge(newEdge);
        console.log('Frontend: New edge created with id:', newEdge.id, newEdge);
        this.edges.push(newEdge);
        
        this.showStatus(`已创建关系：${sourceNode.name} -> ${targetNode.name}`);
        this.selectedEdge = newEdge;
        // 创建关系后，取消创建关系模式
        this.creatingEdge = false;
        this.edgeSourceNode = null;
        this.edgeMousePos = { x: 0, y: 0 };
        this.canvas.style.cursor = 'default';
        this.updatePropertiesPanel();
        this.render();
    }
    
    showEdgeModal(edge = null) {
        const modal = document.getElementById('edgeModal');
        const title = document.getElementById('edgeModalTitle');
        const form = document.getElementById('edgeForm');
        
        this.populateEdgeSelects();
        
        if (edge) {
            title.textContent = '编辑关系';
            document.getElementById('edgeSource').value = edge.sourceId;
            document.getElementById('edgeTarget').value = edge.targetId;
            document.getElementById('edgeLabel').value = edge.label;
            document.getElementById('edgeColor').value = edge.color;
            form.dataset.edgeId = edge.id;
        } else {
            title.textContent = '新增关系';
            form.reset();
            delete form.dataset.edgeId;
        }
        
        modal.style.display = 'block';
    }
    
    populateEdgeSelects() {
        const sourceSelect = document.getElementById('edgeSource');
        const targetSelect = document.getElementById('edgeTarget');
        
        sourceSelect.innerHTML = '';
        targetSelect.innerHTML = '';
        
        if (this.nodes.length === 0) {
            const option = document.createElement('option');
            option.textContent = '请先添加节点';
            option.disabled = true;
            sourceSelect.appendChild(option);
            targetSelect.appendChild(option.cloneNode(true));
            return;
        }
        
        this.nodes.forEach(node => {
            const option1 = document.createElement('option');
            option1.value = node.id;
            option1.textContent = node.name;
            sourceSelect.appendChild(option1);
            
            const option2 = document.createElement('option');
            option2.value = node.id;
            option2.textContent = node.name;
            targetSelect.appendChild(option2);
        });
    }
    
    async handleNodeFormSubmit(e) {
        e.preventDefault();
        
        const form = e.target;
        const nodeId = form.dataset.nodeId;
        console.log('handleNodeFormSubmit, nodeId:', nodeId);
        
        const nodeData = {
            name: document.getElementById('nodeName').value,
            type: document.getElementById('nodeType').value,
            color: document.getElementById('nodeColor').value
        };
        
        // 检查是否是有效的编辑模式
        if (nodeId && nodeId !== 'undefined' && nodeId.trim() !== '') {
            console.log('编辑模式, nodeId =', nodeId);
            const node = this.nodes.find(n => n.id === parseInt(nodeId));
            if (node) {
                Object.assign(node, nodeData);
                await this.saveNode(node);
            }
        } else {
            console.log('新增模式');
            const newNode = {
                x: Math.random() * (this.canvas.width - 200) + 100,
                y: Math.random() * (this.canvas.height - 200) + 100,
                radius: 40,
                ...nodeData
            };
            this.nodes.push(newNode);
            await this.saveNode(newNode);
        }
        
        form.reset();
        document.getElementById('nodeModal').style.display = 'none';
        this.updatePropertiesPanel();
        this.render();
    }
    
    async handleEdgeFormSubmit(e) {
        e.preventDefault();
        
        const form = e.target;
        const edgeId = form.dataset.edgeId;
        
        const edgeData = {
            sourceId: parseInt(document.getElementById('edgeSource').value),
            targetId: parseInt(document.getElementById('edgeTarget').value),
            label: document.getElementById('edgeLabel').value,
            color: document.getElementById('edgeColor').value
        };
        
        if (edgeId) {
            const edge = this.edges.find(e => e.id === parseInt(edgeId));
            if (edge) {
                Object.assign(edge, edgeData);
                await this.saveEdge(edge);
            }
        } else {
            this.edges.push(edgeData);
            await this.saveEdge(edgeData);
        }
        
        form.reset();
        document.getElementById('edgeModal').style.display = 'none';
        this.updatePropertiesPanel();
        this.render();
    }
    
    async handleDelete() {
        if (!this.selectedNode && !this.selectedEdge) {
            this.showStatus('请先选择一个节点或关系');
            return;
        }
        
        if (this.selectedNode) {
            // 删除节点
            const nodeName = this.selectedNode.name;
            if (confirm(`确定要删除节点"${nodeName}"吗？\n删除节点将同时删除与该节点相关的所有关系。`)) {
                await this.deleteNode(this.selectedNode);
                this.selectedNode = null;
                this.updatePropertiesPanel();
                this.render();
            }
        } else if (this.selectedEdge) {
            // 删除关系
            console.log('Frontend: Attempting to delete selected edge with id:', this.selectedEdge.id);
            const source = this.nodes.find(n => n.id === this.selectedEdge.sourceId);
            const target = this.nodes.find(n => n.id === this.selectedEdge.targetId);
            const sourceName = source ? source.name : '未知';
            const targetName = target ? target.name : '未知';
            const edgeLabel = this.selectedEdge.label || '关系';
            
            if (confirm(`确定要删除关系"${edgeLabel}"吗？\n(${sourceName} -> ${targetName})`)) {
                await this.deleteEdge(this.selectedEdge);
                this.selectedEdge = null;
                this.updatePropertiesPanel();
                this.render();
            }
        }
    }
    
    async handleClear() {
        if (confirm('确定要清空整个画布吗？')) {
            await this.clearAll();
            this.selectedNode = null;
            this.selectedEdge = null;
            this.updatePropertiesPanel();
            this.render();
        }
    }
    
    exportDatabase() {
        window.open('/api/export', '_blank');
        this.showStatus('正在导出数据库...');
    }
    
    async importDatabase(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            this.showStatus('正在导入数据库...');
            const response = await fetch('/api/import', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) throw new Error('导入失败');
            
            await this.loadData();
            alert('数据库导入成功');
            this.showStatus('导入成功');
        } catch (error) {
            console.error('导入失败:', error);
            alert('导入数据库失败: ' + error.message);
            this.showStatus('导入失败: ' + error.message);
        }
        
        e.target.value = '';
    }
    
    showStatus(message) {
        const statusText = document.getElementById('statusText');
        if (statusText) {
            statusText.textContent = message;
        }
        console.log(message);
    }

    // 自动调整 textarea 高度以适应内容
    autoResizeTextarea(textarea) {
        // 临时将高度设为 0，以获取内容的真实高度
        textarea.style.height = '0';
        // 设置高度为 scrollHeight，自动适应内容
        textarea.style.height = textarea.scrollHeight + 'px';
    }

    updatePropertiesPanel() {
        const panel = document.getElementById('propertiesContent');
        
        if (this.selectedNode) {
            // 找出所有从当前节点发出的关系
            const outgoingEdges = this.edges.filter(e => e.sourceId === this.selectedNode.id);
            // 获取节点的清单名称和事项
            const taskListName = this.selectedNode.taskListName || '';
            const nodeTasks = Array.isArray(this.selectedNode.tasks) ? this.selectedNode.tasks : [];
            
            panel.innerHTML = `
                <div class="property-group">
                    <label>基本信息:</label>
                    <div class="property-inline-row">
                        <input type="text" id="propName" value="${this.selectedNode.name}" data-prop="name" placeholder="名称">
                        <select id="propType" data-prop="type">
                            <option value="person" ${this.selectedNode.type === 'person' ? 'selected' : ''}>人物</option>
                            <option value="organization" ${this.selectedNode.type === 'organization' ? 'selected' : ''}>组织</option>
                            <option value="event" ${this.selectedNode.type === 'event' ? 'selected' : ''}>事件</option>
                            <option value="concept" ${this.selectedNode.type === 'concept' ? 'selected' : ''}>概念</option>
                        </select>
                        <input type="color" id="propColor" value="${this.selectedNode.color}" data-prop="color" class="inline-color-input">
                    </div>
                </div>
                <div class="property-group">
                    <div class="task-list-header">
                        ${taskListName ? `
                            <span class="task-list-title-label">${taskListName}</span>
                            <button type="button" class="task-list-edit-btn" data-action="edit-task-list-name" title="编辑">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                            </button>
                        ` : `
                            <input type="text" class="task-list-name-input" data-prop="taskListName" placeholder="请输入事项清单名称（如：目标、待办等）" value="">
                        `}
                    </div>
                    <div class="task-list" id="nodeTaskList">
                        ${nodeTasks.map((task, index) => `
                            <div class="task-item" data-node-task-index="${index}">
                                <textarea class="task-textarea" data-node-task-field="title" placeholder="事项内容">${task.title || ''}</textarea>
                                <button type="button" class="task-delete-btn" data-node-task-action="delete">删</button>
                            </div>
                        `).join('')}
                    </div>
                    <div class="task-add">
                        <textarea id="newNodeTaskTitle" class="task-textarea task-add-textarea" placeholder="新增事项..."></textarea>
                        <button type="button" id="addNodeTaskBtn" class="task-add-btn">添加</button>
                    </div>
                </div>
                <div class="property-group">
                    <label>相关方 (${outgoingEdges.length}):</label>
                    ${outgoingEdges.length > 0 ? `
                        <div class="outgoing-edges-list">
                            ${outgoingEdges.map(edge => {
                                const targetNode = this.nodes.find(n => n.id === edge.targetId);
                                const tasks = Array.isArray(edge.tasks) ? edge.tasks : [];
                                return `
                                    <div class="outgoing-edge-item" data-edge-id="${edge.id}">
                                        <div class="outgoing-edge-header">
                                            <span class="edge-arrow">→</span>
                                            <span class="edge-target">${targetNode ? targetNode.name : '未知'}</span>
                                            <span class="edge-label">${edge.label}</span>
                                            ${tasks.length > 0 ? `<span class="edge-task-count">(${tasks.length})</span>` : ''}
                                        </div>
                                        ${tasks.length > 0 ? `
                                            <div class="edge-tasks-preview">
                                                ${tasks.slice(0, 3).map(task => `
                                                    <span class="task-preview-item ${task.done ? 'done' : ''}">${task.title}</span>
                                                `).join('')}
                                                ${tasks.length > 3 ? `<span class="task-more">+${tasks.length - 3}更多</span>` : ''}
                                            </div>
                                        ` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : '<p style="color: #999; font-size: 13px;">暂无发出的关系</p>'}
                </div>
                
            `;

            // 自动调整所有 textarea 的高度
            panel.querySelectorAll('.task-textarea').forEach(textarea => {
                this.autoResizeTextarea(textarea);
            });
        } else if (this.selectedEdge) {
            const source = this.nodes.find(n => n.id === this.selectedEdge.sourceId);
            const target = this.nodes.find(n => n.id === this.selectedEdge.targetId);
            const tasks = Array.isArray(this.selectedEdge.tasks) ? this.selectedEdge.tasks : [];
            console.log('关系属性面板 - 当前关系任务列表:', this.selectedEdge.id, tasks);
            
            panel.innerHTML = `
                <div class="property-group">
                    <label>源 / 目标节点:</label>
                    <div class="property-inline-row">
                        <input type="text" value="${source ? source.name : '未知'}" readonly>
                        <span class="property-inline-arrow">→</span>
                        <input type="text" value="${target ? target.name : '未知'}" readonly>
                    </div>
                </div>
                <div class="property-group">
                    <label>关系名称:</label>
                    <div class="property-inline-row">
                        <input type="text" id="propLabel" value="${this.selectedEdge.label}" data-prop="label">
                        <input type="color" id="propEdgeColor" value="${this.selectedEdge.color}" data-prop="color" class="inline-color-input">
                    </div>
                </div>
                <div class="property-group">
                    <label>事项清单:</label>
                    <div class="task-list">
                        ${tasks.map((task, index) => `
                            <div class="task-item" data-task-index="${index}">
                                <textarea class="task-textarea" data-task-field="title" placeholder="事项内容">${task.title || ''}</textarea>
                                <button type="button" class="task-delete-btn" data-task-action="delete">删</button>
                            </div>
                        `).join('')}
                    </div>
                    <div class="task-add">
                        <textarea id="newTaskTitle" class="task-textarea task-add-textarea" placeholder="新增事项..."></textarea>
                        <button type="button" id="addTaskBtn" class="task-add-btn">添加</button>
                    </div>
                </div>
            `;

            // 自动调整所有 textarea 的高度
            panel.querySelectorAll('.task-textarea').forEach(textarea => {
                this.autoResizeTextarea(textarea);
            });

            // 渲染完成后，再通过 JS 显式把标题填充到输入框里，避免 HTML 解析导致的显示问题
            const titleInputs = panel.querySelectorAll('.task-item textarea[data-task-field="title"]');
            titleInputs.forEach((input, index) => {
                const task = tasks[index];
                if (task && typeof task.title === 'string') {
                    input.value = task.title;
                }
                this.autoResizeTextarea(input);
            });
        } else {
            panel.innerHTML = '<p>请选择一个节点或关系</p>';
        }
    }
    
    async deleteSelected() {
        if (this.selectedNode) {
            await this.deleteNode(this.selectedNode);
            this.selectedNode = null;
        } else if (this.selectedEdge) {
            await this.deleteEdge(this.selectedEdge);
            this.selectedEdge = null;
        }
        
        this.updatePropertiesPanel();
        this.render();
    }
    
    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 按节点对分组边，以便处理多条边的情况
        const edgeGroups = this.groupEdgesByNodePair();
        
        // 绘制所有边
        edgeGroups.forEach(group => {
            // 计算统一的垂直方向（基于标准化的节点对）
            // 使用较小的节点ID作为起点，较大的作为终点，计算统一的垂直方向
            const node1 = this.nodes.find(n => n.id === group.sourceId);
            const node2 = this.nodes.find(n => n.id === group.targetId);
            
            let unifiedPerpAngle = null;
            if (node1 && node2 && group.edges.length > 1) {
                // 计算从 node1 到 node2 的角度
                const unifiedDx = node2.x - node1.x;
                const unifiedDy = node2.y - node1.y;
                const unifiedAngle = Math.atan2(unifiedDy, unifiedDx);
                // 统一的垂直方向
                unifiedPerpAngle = unifiedAngle + Math.PI / 2;
            }
            
            // 同一对节点间的所有边，按顺序分配不同的偏移量
            // 使用统一的垂直方向，确保所有弧线向同一个方向弯曲
            group.edges.forEach((edge, index) => {
                const offset = this.calculateEdgeOffset(group, index);
                this.drawEdge(edge, offset, group.edges.length, unifiedPerpAngle);
            });
        });
        
        // 绘制正在创建关系的临时线
        if (this.creatingEdge && this.edgeSourceNode) {
            this.drawTemporaryEdge(this.edgeSourceNode, this.edgeMousePos);
        }
        
        this.nodes.forEach(node => this.drawNode(node));
    }
    
    drawTemporaryEdge(sourceNode, mousePos) {
        const sourceX = sourceNode.x;
        const sourceY = sourceNode.y;
        const targetX = mousePos.x;
        const targetY = mousePos.y;
        
        // 计算起点（在节点边缘）
        const dx = targetX - sourceX;
        const dy = targetY - sourceY;
        const angle = Math.atan2(dy, dx);
        const startX = sourceX + Math.cos(angle) * sourceNode.radius;
        const startY = sourceY + Math.sin(angle) * sourceNode.radius;
        
        // 绘制临时线（虚线）
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.lineTo(targetX, targetY);
        this.ctx.strokeStyle = '#667eea';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
        
        // 绘制临时箭头
        const arrowSize = 10;
        const arrowAngle = Math.PI / 6;
        const lineAngle = Math.atan2(targetY - startY, targetX - startX);
        
        this.ctx.beginPath();
        this.ctx.moveTo(targetX, targetY);
        this.ctx.lineTo(
            targetX - arrowSize * Math.cos(lineAngle - arrowAngle),
            targetY - arrowSize * Math.sin(lineAngle - arrowAngle)
        );
        this.ctx.lineTo(
            targetX - arrowSize * Math.cos(lineAngle + arrowAngle),
            targetY - arrowSize * Math.sin(lineAngle + arrowAngle)
        );
        this.ctx.closePath();
        this.ctx.fillStyle = '#667eea';
        this.ctx.fill();
    }
    
    // 按节点对分组边
    groupEdgesByNodePair() {
        const groups = new Map();
        
        this.edges.forEach(edge => {
            // 创建标准化的键（较小的ID在前，确保同一对节点被归为一组）
            const key = edge.sourceId < edge.targetId 
                ? `${edge.sourceId}-${edge.targetId}`
                : `${edge.targetId}-${edge.sourceId}`;
            
            if (!groups.has(key)) {
                groups.set(key, {
                    sourceId: edge.sourceId < edge.targetId ? edge.sourceId : edge.targetId,
                    targetId: edge.sourceId < edge.targetId ? edge.targetId : edge.sourceId,
                    edges: []
                });
            }
            
            groups.get(key).edges.push(edge);
        });
        
        // 对每组中的边按ID排序，确保顺序一致
        groups.forEach(group => {
            group.edges.sort((a, b) => (a.id || 0) - (b.id || 0));
        });
        
        return Array.from(groups.values());
    }
    
    // 计算边的偏移量
    calculateEdgeOffset(group, index) {
        const totalEdges = group.edges.length;
        if (totalEdges === 1) {
            return 0; // 只有一条边，不需要偏移
        }
        
        // 边之间的间隔（像素）- 对于弧线，使用更大的间隔
        const spacing = 50;
        // 当前边的偏移量（从中心向两侧分布）
        // 例如：3条边时，偏移量为 -50, 0, 50
        // 例如：2条边时，偏移量为 -25, 25
        const offset = (index - (totalEdges - 1) / 2) * spacing;
        
        return offset;
    }
    
    drawNode(node) {
        this.ctx.beginPath();
        this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        this.ctx.fillStyle = node.color;
        this.ctx.fill();
        this.ctx.strokeStyle = this.selectedNode === node ? '#667eea' : '#333';
        this.ctx.lineWidth = this.selectedNode === node ? 4 : 2;
        this.ctx.stroke();
        
        this.ctx.fillStyle = 'white';
        this.ctx.font = 'bold 14px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(node.name, node.x, node.y);
        
        if (this.selectedNode === node) {
            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, node.radius + 8, 0, Math.PI * 2);
            this.ctx.strokeStyle = '#667eea';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }
    }
    
    drawEdge(edge, offset = 0, totalEdgesInGroup = 1, unifiedPerpAngle = null) {
        const source = this.nodes.find(n => n.id === edge.sourceId);
        const target = this.nodes.find(n => n.id === edge.targetId);
        
        if (!source || !target) return;
        
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        const angle = Math.atan2(dy, dx);
        
        // 计算起点和终点（在节点边缘）
        const sourceX = source.x + Math.cos(angle) * source.radius;
        const sourceY = source.y + Math.sin(angle) * source.radius;
        const targetX = target.x - Math.cos(angle) * target.radius;
        const targetY = target.y - Math.sin(angle) * target.radius;
        
        // 使用统一的垂直方向（如果提供），否则使用当前边的垂直方向
        const perpAngle = unifiedPerpAngle !== null ? unifiedPerpAngle : (angle + Math.PI / 2);
        
        let pathPoints = [];
        let arrowAngle = angle;
        
        if (totalEdgesInGroup === 1 || offset === 0) {
            // 单条边，绘制直线
            this.ctx.beginPath();
            this.ctx.moveTo(sourceX, sourceY);
            this.ctx.lineTo(targetX, targetY);
            this.ctx.strokeStyle = edge.color;
            this.ctx.lineWidth = this.selectedEdge === edge ? 4 : 2;
            this.ctx.stroke();
            
            pathPoints = [
                { x: sourceX, y: sourceY },
                { x: targetX, y: targetY }
            ];
        } else {
            // 多条边，绘制弧线
            // 计算弧线的控制点（在统一的垂直方向上）
            const midX = (sourceX + targetX) / 2;
            const midY = (sourceY + targetY) / 2;
            
            // 控制点在统一的垂直方向上，使用偏移量作为控制点位置
            // 所有弧线使用相同的垂直方向，但由于起点和终点不同，不会重叠
            const controlX = midX + Math.cos(perpAngle) * offset;
            const controlY = midY + Math.sin(perpAngle) * offset;
            
            // 使用二次贝塞尔曲线绘制弧线
            this.ctx.beginPath();
            this.ctx.moveTo(sourceX, sourceY);
            this.ctx.quadraticCurveTo(controlX, controlY, targetX, targetY);
            this.ctx.strokeStyle = edge.color;
            this.ctx.lineWidth = this.selectedEdge === edge ? 4 : 2;
            this.ctx.stroke();
            
            // 计算弧线在终点的切线方向（用于绘制箭头）
            // 二次贝塞尔曲线在终点的切线方向是从控制点到终点的方向
            arrowAngle = Math.atan2(targetY - controlY, targetX - controlX);
            
            // 保存路径点用于点击检测
            pathPoints = [
                { x: sourceX, y: sourceY },
                { x: controlX, y: controlY },
                { x: targetX, y: targetY }
            ];
        }
        
        // 绘制箭头
        const arrowSize = 10;
        const arrowAngleRad = Math.PI / 6;
        
        this.ctx.beginPath();
        this.ctx.moveTo(targetX, targetY);
        this.ctx.lineTo(
            targetX - arrowSize * Math.cos(arrowAngle - arrowAngleRad),
            targetY - arrowSize * Math.sin(arrowAngle - arrowAngleRad)
        );
        this.ctx.lineTo(
            targetX - arrowSize * Math.cos(arrowAngle + arrowAngleRad),
            targetY - arrowSize * Math.sin(arrowAngle + arrowAngleRad)
        );
        this.ctx.closePath();
        this.ctx.fillStyle = edge.color;
        this.ctx.fill();
        
        // 计算标签位置
        let labelX, labelY;
        
        if (offset === 0) {
            // 直线：标签在中心
            labelX = (sourceX + targetX) / 2;
            labelY = (sourceY + targetY) / 2;
        } else {
            // 弧线：标签在控制点附近，稍微偏移以避免与线重叠
            const midX = (sourceX + targetX) / 2;
            const midY = (sourceY + targetY) / 2;
            // 让标签更靠近弧线：减小与弧线的额外偏移量
            const labelOffset = offset > 0 ? 8 : -8;
            labelX = midX + Math.cos(perpAngle) * (offset + labelOffset);
            labelY = midY + Math.sin(perpAngle) * (offset + labelOffset);
        }
        
        // 构建标签文本：如果有关系事项，显示名称 + 事项数量
        const tasks = Array.isArray(edge.tasks) ? edge.tasks : [];
        let displayLabel = edge.label;
        if (tasks.length > 0) {
            displayLabel = `${edge.label} (${tasks.length})`;
        }
        
        // 绘制标签背景（白色半透明，提高可读性）
        this.ctx.font = '12px Arial';
        const textMetrics = this.ctx.measureText(displayLabel);
        const textWidth = textMetrics.width;
        const textHeight = 12;
        
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        this.ctx.fillRect(
            labelX - textWidth / 2 - 4,
            labelY - textHeight / 2 - 2,
            textWidth + 8,
            textHeight + 4
        );
        
        // 绘制标签文字
        this.ctx.fillStyle = edge.color;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(displayLabel, labelX, labelY);
        
        // 选中效果
        if (this.selectedEdge === edge) {
            this.ctx.beginPath();
            if (offset === 0) {
                this.ctx.moveTo(sourceX, sourceY);
                this.ctx.lineTo(targetX, targetY);
            } else {
                const midX = (sourceX + targetX) / 2;
                const midY = (sourceY + targetY) / 2;
                const controlX = midX + Math.cos(perpAngle) * offset;
                const controlY = midY + Math.sin(perpAngle) * offset;
                this.ctx.moveTo(sourceX, sourceY);
                this.ctx.quadraticCurveTo(controlX, controlY, targetX, targetY);
            }
            this.ctx.strokeStyle = '#667eea';
            this.ctx.lineWidth = 6;
            this.ctx.globalAlpha = 0.3;
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;
        }
    }
}

let editor;
(async () => {
    editor = await GraphEditor.create();
    console.log('GraphEditor initialized successfully');
})();
