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
            await this.apiDelete(`/api/edges/${edge.id}`);
            this.edges = this.edges.filter(e => e.id !== edge.id);
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
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', this.handleMouseUp.bind(this));
        
        // 键盘事件
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        
        // 按钮事件
        document.getElementById('addNodeBtn').addEventListener('click', () => this.showNodeModal());
        document.getElementById('addEdgeBtn').addEventListener('click', () => this.showEdgeModal());
        document.getElementById('clearBtn').addEventListener('click', this.handleClear.bind(this));
        
        this.setupModalListeners();
    }
    
    setupModalListeners() {
        document.querySelectorAll('.close').forEach(closeBtn => {
            closeBtn.addEventListener('click', (e) => {
                e.target.closest('.modal').style.display = 'none';
            });
        });
        
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });
        
        document.getElementById('nodeForm').addEventListener('submit', this.handleNodeFormSubmit.bind(this));
        document.getElementById('edgeForm').addEventListener('submit', this.handleEdgeFormSubmit.bind(this));
        
        document.getElementById('propertiesContent').addEventListener('input', this.handlePropertyChange.bind(this));
        document.getElementById('propertiesContent').addEventListener('change', this.handlePropertyChange.bind(this));
    }
    
    handlePropertyChange(e) {
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
    
    handleCanvasClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
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
                this.selectedNode = node;
                this.updatePropertiesPanel();
                this.render();
                return;
            }
        }
        
        this.updatePropertiesPanel();
        this.render();
    }
    
    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        for (let node of this.nodes) {
            if (this.isPointInNode(x, y, node)) {
                this.draggingNode = node;
                this.dragOffset = { x: x - node.x, y: y - node.y };
                return;
            }
        }
    }
    
    handleMouseMove(e) {
        if (!this.draggingNode) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.draggingNode.x = x - this.dragOffset.x;
        this.draggingNode.y = y - this.dragOffset.y;
        
        this.render();
    }
    
    async handleMouseUp() {
        if (this.draggingNode) {
            await this.saveNode(this.draggingNode);
        }
        this.draggingNode = null;
    }
    
    handleKeyDown(e) {
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
        
        const lineLength = Math.sqrt((target.x - source.x) ** 2 + (target.y - source.y) ** 2);
        const distanceToStart = Math.sqrt((x - source.x) ** 2 + (y - source.y) ** 2);
        const distanceToEnd = Math.sqrt((x - target.x) ** 2 + (y - target.y) ** 2);
        
        return Math.abs(distanceToStart + distanceToEnd - lineLength) < 10;
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
            alert('请先选择一个节点或关系');
            return;
        }
        
        if (confirm('确定要删除选中的项目吗？')) {
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
    
    updatePropertiesPanel() {
        const panel = document.getElementById('propertiesContent');
        
        if (this.selectedNode) {
            panel.innerHTML = `
                <div class="property-group">
                    <label>节点ID:</label>
                    <input type="text" value="${this.selectedNode.id}" readonly>
                </div>
                <div class="property-group">
                    <label>节点名称:</label>
                    <input type="text" id="propName" value="${this.selectedNode.name}" data-prop="name">
                </div>
                <div class="property-group">
                    <label>节点类型:</label>
                    <select id="propType" data-prop="type">
                        <option value="person" ${this.selectedNode.type === 'person' ? 'selected' : ''}>人物</option>
                        <option value="organization" ${this.selectedNode.type === 'organization' ? 'selected' : ''}>组织</option>
                        <option value="event" ${this.selectedNode.type === 'event' ? 'selected' : ''}>事件</option>
                        <option value="concept" ${this.selectedNode.type === 'concept' ? 'selected' : ''}>概念</option>
                    </select>
                </div>
                <div class="property-group">
                    <label>节点颜色:</label>
                    <input type="color" id="propColor" value="${this.selectedNode.color}" data-prop="color">
                </div>
                <p style="color: #666; font-size: 12px; margin-top: 10px;">💡 按 Delete 键删除选中项</p>
                
            `;
        } else if (this.selectedEdge) {
            const source = this.nodes.find(n => n.id === this.selectedEdge.sourceId);
            const target = this.nodes.find(n => n.id === this.selectedEdge.targetId);
            
            panel.innerHTML = `
                <div class="property-group">
                    <label>关系ID:</label>
                    <input type="text" value="${this.selectedEdge.id}" readonly>
                </div>
                <div class="property-group">
                    <label>源节点:</label>
                    <input type="text" value="${source ? source.name : '未知'}" readonly>
                </div>
                <div class="property-group">
                    <label>目标节点:</label>
                    <input type="text" value="${target ? target.name : '未知'}" readonly>
                </div>
                <div class="property-group">
                    <label>关系标签:</label>
                    <input type="text" id="propLabel" value="${this.selectedEdge.label}" data-prop="label">
                </div>
                <div class="property-group">
                    <label>关系颜色:</label>
                    <input type="color" id="propEdgeColor" value="${this.selectedEdge.color}" data-prop="color">
                </div>
                <p style="color: #666; font-size: 12px; margin-top: 10px;">💡 按 Delete 键删除选中项</p>
                <button class="btn-delete" style="background: #667eea; margin-top: 10px;" onclick="editor.showEdgeModal(editor.selectedEdge)">编辑关系</button>
            `;
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
        
        this.edges.forEach(edge => this.drawEdge(edge));
        this.nodes.forEach(node => this.drawNode(node));
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
    
    drawEdge(edge) {
        const source = this.nodes.find(n => n.id === edge.sourceId);
        const target = this.nodes.find(n => n.id === edge.targetId);
        
        if (!source || !target) return;
        
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        const angle = Math.atan2(dy, dx);
        const sourceX = source.x + Math.cos(angle) * source.radius;
        const sourceY = source.y + Math.sin(angle) * source.radius;
        const targetX = target.x - Math.cos(angle) * target.radius;
        const targetY = target.y - Math.sin(angle) * target.radius;
        
        this.ctx.beginPath();
        this.ctx.moveTo(sourceX, sourceY);
        this.ctx.lineTo(targetX, targetY);
        this.ctx.strokeStyle = edge.color;
        this.ctx.lineWidth = this.selectedEdge === edge ? 4 : 2;
        this.ctx.stroke();
        
        const arrowSize = 10;
        const arrowAngle = Math.PI / 6;
        
        this.ctx.beginPath();
        this.ctx.moveTo(targetX, targetY);
        this.ctx.lineTo(
            targetX - arrowSize * Math.cos(angle - arrowAngle),
            targetY - arrowSize * Math.sin(angle - arrowAngle)
        );
        this.ctx.lineTo(
            targetX - arrowSize * Math.cos(angle + arrowAngle),
            targetY - arrowSize * Math.sin(angle + arrowAngle)
        );
        this.ctx.closePath();
        this.ctx.fillStyle = edge.color;
        this.ctx.fill();
        
        const midX = (sourceX + targetX) / 2;
        const midY = (sourceY + targetY) / 2;
        
        this.ctx.fillStyle = edge.color;
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'bottom';
        this.ctx.fillText(edge.label, midX, midY - 5);
        
        if (this.selectedEdge === edge) {
            this.ctx.beginPath();
            this.ctx.moveTo(sourceX, sourceY);
            this.ctx.lineTo(targetX, targetY);
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
