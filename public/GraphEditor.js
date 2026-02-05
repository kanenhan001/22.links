class GraphEditor {
    constructor() {
        this.canvas = document.getElementById('graphCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        this.dpr = window.devicePixelRatio || 1;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        
        this.renderRequested = false;
        this.rafId = null;
        
        this.setupHighDPICanvas();
        
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
        // 拖拽边的状态
        this.draggingEdge = null;
        this.edgeDragOffset = { x: 0, y: 0 };
        this.edgeDragStartPos = { x: 0, y: 0 };
        this.edgeDragTempTarget = null;
        // 拖拽转折点的状态
        this.draggingBendPoint = null;
        this.bendPointIndex = -1;
        this.bendPointEdge = null;
        // 选中的转折点
        this.selectedBendPoint = null;
        this.selectedBendPointIndex = -1;
        // 圈选相关状态
        this.isDraggingSelection = false;
        this.selectionStart = { x: 0, y: 0 };
        this.selectionEnd = { x: 0, y: 0 };
        this.selectedNodes = [];
        this.selectedBendPoints = [];
        this.draggingSelectedNodes = false;
        // 缩放相关状态
        // 默认缩放级别，稍后会尝试从本地缓存恢复
        this.zoomLevel = 1.0; // 当前缩放级别，1.0 = 100%
        this.minZoom = 0.25; // 最小缩放 25%
        this.maxZoom = 3.0; // 最大缩放 300%
        this.zoomStep = 0.1; // 每次缩放步长
        this.panOffset = { x: 0, y: 0 }; // 画布平移偏移量
        this.isPanning = false; // 是否正在平移
        this.lastPanPosition = { x: 0, y: 0 }; // 上一次平移位置

        // 画布设置
        this.canvasWidth = 1600;
        this.canvasHeight = 1400;
        this.showNodeInfo = true;
        this.backgroundImage = null;

        // 当前关系图ID（来自 URL /g/:id）
        this.graphId = this.getGraphIdFromUrl();

        // 图表类型
        this.diagramType = 'relationship';

        // 节点图片缓存
        this.nodeImageCache = new Map();

        // 撤销/重做历史状态
        this.history = [];
        this.historyIndex = -1;
        this.maxHistorySize = 50;
        this.isRestoring = false;
        
        // 节点信息框展开状态
        this.nodeInfoExpanded = new Map();
    }
    
    setupHighDPICanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        const newWidth = rect.width * dpr;
        const newHeight = rect.height * dpr;
        
        if (this.canvasWidth === newWidth && this.canvasHeight === newHeight) {
            return;
        }
        
        this.canvasWidth = newWidth;
        this.canvasHeight = newHeight;
        
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        
        this.ctx.scale(dpr, dpr);
    }
    static async create() {
        const editor = new GraphEditor();

        editor.setupEventListeners();
        await editor.loadData();
        return editor;
    }

    getGraphIdFromUrl() {
        // 支持路径：/g/:id  或 ?graphId=xx
        try {
            const url = new URL(window.location.href);
            const q = url.searchParams.get('graphId');
            if (q) {
                const gid = parseInt(q, 10);
                if (!Number.isNaN(gid) && gid > 0) return gid;
            }
            const parts = window.location.pathname.split('/').filter(Boolean);
            const gIndex = parts.indexOf('g');
            if (gIndex !== -1 && parts[gIndex + 1]) {
                const gid = parseInt(parts[gIndex + 1], 10);
                if (!Number.isNaN(gid) && gid > 0) return gid;
            }
        } catch (_) {}
        return 1;
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
            const [graphData, nodes, edges] = await Promise.all([
                this.apiGet(`/api/graphs/${this.graphId}`),
                this.apiGet(`/api/nodes?graphId=${this.graphId}`),
                this.apiGet(`/api/edges?graphId=${this.graphId}`)
            ]);
            this.nodes = nodes;
            this.edges = edges;
            this.graphInfo = graphData;
            
            // 恢复缩放和平移状态
            if (graphData.zoomLevel) {
                this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, graphData.zoomLevel));
            }
            if (graphData.panOffsetX !== undefined && graphData.panOffsetY !== undefined) {
                this.panOffset = { x: graphData.panOffsetX || 0, y: graphData.panOffsetY || 0 };
            }
            
            // 恢复画布设置
            if (graphData.canvasWidth) {
                this.canvasWidth = graphData.canvasWidth;
            }
            if (graphData.canvasHeight) {
                this.canvasHeight = graphData.canvasHeight;
            }
            if (graphData.showNodeInfo !== undefined) {
                this.showNodeInfo = graphData.showNodeInfo;
            }
            if (graphData.backgroundImage) {
                this.backgroundImage = graphData.backgroundImage;
            }
            
            // 加载图表类型
            console.log('loadData - 开始加载图表类型:', graphData.diagramType);
            if (graphData.diagramType) {
                console.log('loadData - 加载到图表类型:', graphData.diagramType);
                this.diagramType = graphData.diagramType;
                // 更新图表类型显示
                const diagramTypeDisplay = document.getElementById('diagramType');
                console.log('loadData - 图表类型显示:', diagramTypeDisplay);
                if (diagramTypeDisplay) {
                    console.log('loadData - 更新图表类型显示:', this.getDiagramTypeName(this.diagramType));
                    diagramTypeDisplay.textContent = this.getDiagramTypeName(this.diagramType);
                }
                // 根据加载的图表类型切换编辑器
                console.log('loadData - 调用switchEditorType:', this.diagramType);
                this.switchEditorType(this.diagramType);
                
                // 如果是Mermaid图表类型，直接返回，不执行后续的关系图相关操作
                if (this.diagramType === 'flow' || this.diagramType === 'swimlane' || this.diagramType === 'mindmap') {
                    console.log('loadData - 是Mermaid图表类型，直接返回');
                    return;
                }
            } else {
                console.log('loadData - 没有加载到图表类型');
            }
            
            // 更新画布尺寸 - 保持高DPI设置
            this.setupHighDPICanvas();
            
            this.showStatus(`已加载 ${nodes.length} 个节点, ${edges.length} 个关系`);
            this.updateZoomDisplay();
            this.applyZoom();
            this.render();
            
            // 等待1秒后自动加载所有节点的任务数据和图片数据，让信息框自动显示出来
            setTimeout(() => {
                this.nodes.forEach(node => {
                    this.loadNodeTasks(node);
                    this.loadNodeImage(node);
                });
            }, 1000);
            
            this.history = [];
            this.historyIndex = -1;
            this.saveState();
            this.updateUndoRedoButtons();
        } catch (error) {
            console.error('加载数据失败:', error);
            this.showStatus('加载数据失败: ' + error.message);
            showModal({ 
                title: '加载失败', 
                message: '加载数据失败，请确保服务器已启动', 
                type: 'error',
                onConfirm: () => {
                    window.location.href = '/login';
                }
            });
        }
    }
    
    beautifyGraph() {
        if (this.nodes.length === 0) {
            this.showStatus('没有节点需要美化');
            return;
        }
        
        const nodeCount = this.nodes.length;
        const padding = 150;
        
        if (nodeCount === 1) {
            this.nodes[0].x = this.canvasWidth / 2;
            this.nodes[0].y = this.canvasHeight / 2;
            this.saveAllNodes();
            this.render();
            this.showStatus('美化完成');
            return;
        }
        
        const iterations = 500;
        const repulsionStrength = 8000;
        const attractionStrength = 0.02;
        const centerForce = 0.001;
        const minDistance = 120;
        
        const positions = this.nodes.map(node => ({ x: node.x, y: node.y }));
        const velocities = this.nodes.map(() => ({ x: 0, y: 0 }));
        
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        
        for (let iter = 0; iter < iterations; iter++) {
            const cooling = Math.pow(1 - iter / iterations, 0.5);
            
            for (let i = 0; i < nodeCount; i++) {
                let fx = 0, fy = 0;
                
                for (let j = 0; j < nodeCount; j++) {
                    if (i === j) continue;
                    
                    const dx = positions[i].x - positions[j].x;
                    const dy = positions[i].y - positions[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                    
                    if (dist < minDistance) {
                        const force = (minDistance - dist) / minDistance * repulsionStrength;
                        fx += (dx / dist) * force;
                        fy += (dy / dist) * force;
                    } else {
                        const force = repulsionStrength / (dist * dist);
                        fx += (dx / dist) * force;
                        fy += (dy / dist) * force;
                    }
                }
                
                const dx = positions[i].x - centerX;
                const dy = positions[i].y - centerY;
                fx -= dx * centerForce;
                fy -= dy * centerForce;
                
                velocities[i].x = (velocities[i].x + fx) * 0.7;
                velocities[i].y = (velocities[i].y + fy) * 0.7;
            }
            
            for (const edge of this.edges) {
                const sourceIndex = this.nodes.findIndex(n => n.id === edge.sourceId);
                const targetIndex = this.nodes.findIndex(n => n.id === edge.targetId);
                
                if (sourceIndex !== -1 && targetIndex !== -1) {
                    const dx = positions[targetIndex].x - positions[sourceIndex].x;
                    const dy = positions[targetIndex].y - positions[sourceIndex].y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                    
                    const force = dist * attractionStrength;
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    
                    velocities[sourceIndex].x += fx;
                    velocities[sourceIndex].y += fy;
                    velocities[targetIndex].x -= fx;
                    velocities[targetIndex].y -= fy;
                }
            }
            
            for (let i = 0; i < nodeCount; i++) {
                positions[i].x += velocities[i].x * cooling;
                positions[i].y += velocities[i].y * cooling;
                
                positions[i].x = Math.max(padding, Math.min(this.canvasWidth - padding, positions[i].x));
                positions[i].y = Math.max(padding, Math.min(this.canvasHeight - padding, positions[i].y));
            }
            
            if (iter % 10 === 0) {
                this.resolvePositionsOverlaps(positions, padding);
            }
        }
        
        this.resolvePositionsOverlaps(positions, padding);
        
        for (let i = 0; i < nodeCount; i++) {
            this.nodes[i].x = positions[i].x;
            this.nodes[i].y = positions[i].y;
        }
        
        this.saveAllNodes();
        this.saveState();
        this.render();
        this.showStatus('美化完成');
    }
    
    resolvePositionsOverlaps(positions, padding) {
        const maxIterations = 50;
        const minDistance = 200;
        
        for (let iter = 0; iter < maxIterations; iter++) {
            let hasOverlap = false;
            let maxOverlap = 0;
            
            for (let i = 0; i < positions.length; i++) {
                for (let j = i + 1; j < positions.length; j++) {
                    const node1 = this.nodes[i];
                    const node2 = this.nodes[j];
                    
                    const dx = positions[j].x - positions[i].x;
                    const dy = positions[j].y - positions[i].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minDist = node1.radius + node2.radius + minDistance;
                    
                    if (dist < minDist && dist > 0) {
                        hasOverlap = true;
                        const overlap = minDist - dist;
                        maxOverlap = Math.max(maxOverlap, overlap);
                        
                        const moveX = (dx / dist) * overlap * 0.8;
                        const moveY = (dy / dist) * overlap * 0.8;
                        
                        positions[i].x -= moveX;
                        positions[i].y -= moveY;
                        positions[j].x += moveX;
                        positions[j].y += moveY;
                    }
                }
            }
            
            for (let i = 0; i < positions.length; i++) {
                positions[i].x = Math.max(padding, Math.min(this.canvasWidth - padding, positions[i].x));
                positions[i].y = Math.max(padding, Math.min(this.canvasHeight - padding, positions[i].y));
            }
            
            if (!hasOverlap) break;
            
            if (iter > 20 && maxOverlap < 5) break;
        }
    }
    
    saveState() {
        if (this.isRestoring) return;
        
        const state = {
            nodes: JSON.parse(JSON.stringify(this.nodes)),
            edges: JSON.parse(JSON.stringify(this.edges)),
            timestamp: Date.now()
        };
        
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        this.history.push(state);
        
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        } else {
            this.historyIndex++;
        }
        
        this.updateUndoRedoButtons();
    }
    
    undo() {
        if (this.historyIndex <= 0) {
            this.showStatus('无法后退');
            return;
        }
        
        this.isRestoring = true;
        this.historyIndex--;
        
        const state = this.history[this.historyIndex];
        this.nodes = JSON.parse(JSON.stringify(state.nodes));
        this.edges = JSON.parse(JSON.stringify(state.edges));
        
        this.selectedNode = null;
        this.selectedEdge = null;
        this.selectedNodes = [];
        this.selectedBendPoints = [];
        
        this.render();
        this.updateUndoRedoButtons();
        this.showStatus('已后退');
        
        setTimeout(() => {
            this.isRestoring = false;
        }, 100);
    }
    
    redo() {
        if (this.historyIndex >= this.history.length - 1) {
            this.showStatus('无法前进');
            return;
        }
        
        this.isRestoring = true;
        this.historyIndex++;
        
        const state = this.history[this.historyIndex];
        this.nodes = JSON.parse(JSON.stringify(state.nodes));
        this.edges = JSON.parse(JSON.stringify(state.edges));
        
        this.selectedNode = null;
        this.selectedEdge = null;
        this.selectedNodes = [];
        this.selectedBendPoints = [];
        
        this.render();
        this.updateUndoRedoButtons();
        this.showStatus('已前进');
        
        setTimeout(() => {
            this.isRestoring = false;
        }, 100);
    }
    
    updateUndoRedoButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        
        if (undoBtn) {
            undoBtn.disabled = this.historyIndex <= 0;
            undoBtn.style.opacity = this.historyIndex <= 0 ? '0.5' : '1';
        }
        
        if (redoBtn) {
            redoBtn.disabled = this.historyIndex >= this.history.length - 1;
            redoBtn.style.opacity = this.historyIndex >= this.history.length - 1 ? '0.5' : '1';
        }
    }
    
    async saveAllNodes() {
        try {
            for (const node of this.nodes) {
                await this.apiPut(`/api/nodes/${node.id}`, {
                    x: node.x,
                    y: node.y
                });
            }
        } catch (error) {
            console.error('保存节点位置失败:', error);
        }
    }
    
    async handleManualSave() {
        await this.saveAllNodes();
        this.showStatus('保存成功');
    }
    
    // 根据图表类型切换编辑器
    // 获取图表类型的中文名称
    getDiagramTypeName(type) {
        const typeMap = {
            'relationship': '关系图',
            'flow': '流程图',
            'swimlane': '泳道图',
            'mindmap': '思维导图'
        };
        return typeMap[type] || type;
    }
    
    switchEditorType(type) {
        const canvasContainer = document.querySelector('.canvas-container');
        if (!canvasContainer) return;
        
        // 更新图表类型显示
        const diagramTypeDisplay = document.getElementById('diagramType');
        if (diagramTypeDisplay) {
            diagramTypeDisplay.textContent = this.getDiagramTypeName(type);
        }
        
        // 控制顶部工具栏按钮的显示/隐藏
        const mermaidRenderBtn = document.getElementById('mermaidRenderBtn');
        const mermaidSaveBtn = document.getElementById('mermaidSaveBtn');
        const addNodeBtn = document.getElementById('addNodeBtn');
        const saveGraphBtn = document.getElementById('saveGraphBtn');
        const clearBtn = document.getElementById('clearBtn');
        
        if (type === 'flow' || type === 'swimlane' || type === 'mindmap') {
            // 显示Mermaid相关按钮
            if (mermaidRenderBtn) mermaidRenderBtn.style.display = 'inline-block';
            if (mermaidSaveBtn) mermaidSaveBtn.style.display = 'inline-block';
            // 隐藏关系图相关按钮
            if (addNodeBtn) addNodeBtn.style.display = 'none';
            if (saveGraphBtn) saveGraphBtn.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'none';
        } else {
            // 隐藏Mermaid相关按钮
            if (mermaidRenderBtn) mermaidRenderBtn.style.display = 'none';
            if (mermaidSaveBtn) mermaidSaveBtn.style.display = 'none';
            // 显示关系图相关按钮
            if (addNodeBtn) addNodeBtn.style.display = 'inline-block';
            if (saveGraphBtn) saveGraphBtn.style.display = 'inline-block';
            if (clearBtn) clearBtn.style.display = 'none';
        }
        
        // 清空画布容器
        canvasContainer.innerHTML = '';
        
        switch (type) {
            case 'relationship':
                // 重新创建关系图画布
                this.createRelationshipCanvas(canvasContainer);
                // 注意：这里不再调用loadData()，避免无限循环
                break;
            case 'flow':
            case 'swimlane':
            case 'mindmap':
                // 使用Draw.io创建相应的图表编辑器
                this.createDrawIOEditor(canvasContainer, type);
                break;
            default:
                // 默认显示关系图
                this.createRelationshipCanvas(canvasContainer);
                // 注意：这里不再调用loadData()，避免无限循环
        }
    }
    
    // 创建关系图画布
    createRelationshipCanvas(container) {
        // 创建画布元素
        const canvas = document.createElement('canvas');
        canvas.id = 'graphCanvas';
        canvas.width = this.canvasWidth;
        canvas.height = this.canvasHeight;
        container.appendChild(canvas);
        
        // 重新初始化画布和上下文
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.setupHighDPICanvas();
        
        // 添加缩放控件
        const zoomControls = document.createElement('div');
        zoomControls.className = 'zoom-controls';
        zoomControls.innerHTML = `
            <button id="zoomOutBtn" class="zoom-btn" title="缩小">−</button>
            <span id="zoomLevel" class="zoom-level">100%</span>
            <button id="zoomInBtn" class="zoom-btn" title="放大">+</button>
            <button id="zoomResetBtn" class="zoom-btn zoom-reset" title="重置缩放">⌂</button>
        `;
        container.appendChild(zoomControls);
        
        // 重新绑定事件监听器
        this.setupEventListeners();
    }
    
    // 创建Draw.io编辑器
    createDrawIOEditor(container, type) {
        // 创建Draw.io编辑器容器
        const editorContainer = document.createElement('div');
        editorContainer.className = 'drawio-editor';
        editorContainer.style.display = 'flex';
        editorContainer.style.flexDirection = 'column';
        editorContainer.style.height = '100%';
        
        // 创建编辑区域容器
        const editArea = document.createElement('div');
        editArea.style.display = 'flex';
        editArea.style.flex = '1';
        editArea.style.overflow = 'hidden';
        
        // 创建iframe容器
        const iframeContainer = document.createElement('div');
        iframeContainer.style.flex = '1';
        iframeContainer.style.minWidth = '800px';
        iframeContainer.style.height = '100%';
        
        // 创建Draw.io iframe
        const iframe = document.createElement('iframe');
        iframe.id = 'drawioEditor';
        iframe.src = 'http://localhost:8080';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.allowFullscreen = true;
        iframe.onload = () => {
            console.log('Draw.io iframe 加载完成');
        };
        
        iframeContainer.appendChild(iframe);
        editArea.appendChild(iframeContainer);
        editorContainer.appendChild(editArea);
        container.appendChild(editorContainer);
        
        // 绑定事件
        document.getElementById('mermaidSaveBtn').addEventListener('click', () => {
            this.saveDrawIOChart();
        });
        
        // 隐藏不需要的按钮和属性看板
        console.log('隐藏不需要的按钮和属性看板');
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        const beautifyBtn = document.getElementById('beautifyBtn');
        const settingsBtn = document.getElementById('settingsBtn');
        const propertiesPanel = document.querySelector('.properties-panel');
        
        if (undoBtn) undoBtn.style.display = 'none';
        if (redoBtn) redoBtn.style.display = 'none';
        if (beautifyBtn) beautifyBtn.style.display = 'none';
        if (settingsBtn) settingsBtn.style.display = 'none';
        if (propertiesPanel) propertiesPanel.style.display = 'none';
        
        // 已在iframe创建时添加onload事件处理，加载已保存的图表数据
    }
    
    // 加载Draw.io数据
    loadDrawIOData(data) {
        const iframe = document.getElementById('drawioEditor');
        if (iframe && iframe.contentWindow) {
            // 向Draw.io发送消息，设置图表数据
            iframe.contentWindow.postMessage({ 
                action: 'load', 
                xml: data 
            }, 'https://www.diagrams.net');
        }
    }
    
    // 保存Draw.io图表
    async saveDrawIOChart() {
        const iframe = document.getElementById('drawioEditor');
        if (!iframe || !iframe.contentWindow) {
            this.showStatus('编辑器未加载完成');
            return;
        }
        
        // 向Draw.io发送消息，获取图表数据
        iframe.contentWindow.postMessage({ action: 'getXml' }, 'https://www.diagrams.net');
        
        // 监听Draw.io的响应
        const handleMessage = async (event) => {
            if (event.origin === 'https://www.diagrams.net' && event.data && event.data.xml) {
                const xmlData = event.data.xml;
                
                try {
                    // 保存图表数据到数据库
                    await this.apiPut(`/api/graphs/${this.graphId}`, {
                        code: xmlData
                    });
                    this.showStatus('图表保存成功');
                    
                    // 生成并上传缩略图
                    await this.generateDrawIOThumbnail();
                } catch (error) {
                    console.error('保存图表失败:', error);
                    this.showStatus('保存图表失败: ' + error.message);
                }
                
                // 移除事件监听器
                window.removeEventListener('message', handleMessage);
            }
        };
        
        // 添加事件监听器
        window.addEventListener('message', handleMessage);
        
        // 设置超时，防止Draw.io无响应
        setTimeout(() => {
            window.removeEventListener('message', handleMessage);
            this.showStatus('保存超时，请重试');
        }, 5000);
    }
    
    // 生成Draw.io流程图缩略图
    async generateDrawIOThumbnail() {
        try {
            const iframe = document.getElementById('drawioEditor');
            if (!iframe || !iframe.contentWindow) {
                console.log('编辑器未加载完成，无法生成缩略图');
                return;
            }
            
            // 向Draw.io发送消息，获取图表的SVG
            iframe.contentWindow.postMessage({ action: 'getSvg' }, 'https://www.diagrams.net');
            
            // 监听Draw.io的响应
            const handleMessage = async (event) => {
                if (event.origin === 'https://www.diagrams.net' && event.data && event.data.svg) {
                    const svgData = event.data.svg;
                    
                    // 创建临时div来容纳SVG
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = svgData;
                    document.body.appendChild(tempDiv);
                    
                    // 使用html2canvas生成缩略图
                    const canvas = await html2canvas(tempDiv, {
                        backgroundColor: '#ffffff',
                        scale: 0.5, // 缩小比例，减少文件大小
                        logging: false
                    });
                    
                    // 移除临时div
                    document.body.removeChild(tempDiv);
                    
                    // 转换为base64，使用JPEG格式并设置压缩质量
                    const thumbnailData = canvas.toDataURL('image/jpeg', 0.7);
                    
                    console.log('缩略图生成成功，开始上传');
                    
                    // 上传缩略图
                    await this.uploadThumbnail(thumbnailData);
                    
                    console.log('缩略图上传成功');
                    
                    // 移除事件监听器
                    window.removeEventListener('message', handleMessage);
                }
            };
            
            // 添加事件监听器
            window.addEventListener('message', handleMessage);
            
            // 设置超时，防止Draw.io无响应
            setTimeout(() => {
                window.removeEventListener('message', handleMessage);
                console.error('生成缩略图超时');
            }, 5000);
        } catch (error) {
            console.error('生成Draw.io流程图缩略图失败:', error);
            // 缩略图生成失败不影响主要功能，只记录错误
        }
    }
    
    // 创建Mermaid编辑器
    createMermaidEditor(container, type) {
        // 创建Mermaid编辑器容器
        const editorContainer = document.createElement('div');
        editorContainer.className = 'mermaid-editor';
        editorContainer.style.display = 'flex';
        editorContainer.style.flexDirection = 'column';
        editorContainer.style.height = '100%';
        
        // 不需要工具栏，直接创建代码编辑器
        
        // 创建代码编辑器
        const textarea = document.createElement('textarea');
        textarea.id = 'mermaidCode';
        textarea.placeholder = `请输入Mermaid代码，例如：

${type === 'flow' ? 'graph TD\n    A[开始] --> B[处理]\n    B --> C[结束]' : 
 type === 'swimlane' ? 'flowchart LR\n    subgraph 泳道1\n        A[开始] --> B[处理]\n    end\n    subgraph 泳道2\n        C[审核] --> D[结束]\n    end\n    B --> C' : 
 'graph TD\n    A[中心主题] --> B[子主题1]\n    A --> C[子主题2]\n    B --> D[细节1]\n    B --> E[细节2]'}`;
        
        // 加载已保存的代码内容
        if (this.graphInfo && (this.graphInfo.code || this.graphInfo.description)) {
            textarea.value = this.graphInfo.code || this.graphInfo.description;
        }
        
        // 创建预览容器
        const preview = document.createElement('div');
        preview.className = 'preview';
        preview.id = 'mermaidPreview';
        
        // 创建编辑区域容器（左右布局）
        const editArea = document.createElement('div');
        editArea.style.display = 'flex';
        editArea.style.flex = '1';
        editArea.style.overflow = 'hidden';
        
        // 创建代码编辑器容器
        const textareaContainer = document.createElement('div');
        textareaContainer.style.flex = '1';
        textareaContainer.style.minWidth = '300px';
        textareaContainer.style.padding = '10px';
        textareaContainer.style.borderRight = '1px solid #ddd';
        
        // 设置代码编辑器样式
        textarea.style.width = '100%';
        textarea.style.height = '100%';
        textarea.style.resize = 'none';
        textarea.style.border = 'none';
        textarea.style.fontFamily = 'monospace';
        textarea.style.fontSize = '14px';
        textarea.style.lineHeight = '1.4';
        
        textareaContainer.appendChild(textarea);
        
        // 创建预览容器
        const previewContainer = document.createElement('div');
        previewContainer.style.flex = '4'; // 增加 flex 值，让预览容器更宽
        previewContainer.style.minWidth = '1000px'; // 增加最小宽度
        previewContainer.style.padding = '10px';
        previewContainer.style.overflow = 'auto';
        previewContainer.style.display = 'flex';
        previewContainer.style.justifyContent = 'center'; // 左右居中
        previewContainer.style.alignItems = 'center'; // 垂直居中
        
        // 设置预览容器样式
        preview.style.width = '100%';
        preview.style.height = '100%';
        preview.style.display = 'flex';
        preview.style.justifyContent = 'center'; // 左右居中
        preview.style.alignItems = 'center'; // 垂直居中
        
        previewContainer.appendChild(preview);
        
        // 组装编辑器
        editArea.appendChild(textareaContainer);
        editArea.appendChild(previewContainer);
        
        // 不添加工具栏，直接添加编辑区域
        editorContainer.appendChild(editArea);
        container.appendChild(editorContainer);
        
        // 加载Mermaid.js
        this.loadMermaidJS().then(() => {
            // 绑定事件
            document.getElementById('mermaidRenderBtn').addEventListener('click', () => {
                this.renderMermaidChart();
            });
            
            document.getElementById('mermaidSaveBtn').addEventListener('click', () => {
                this.saveMermaidChart();
            });
            
            // 隐藏不需要的按钮和属性看板
            console.log('隐藏不需要的按钮和属性看板');
            const undoBtn = document.getElementById('undoBtn');
            const redoBtn = document.getElementById('redoBtn');
            const beautifyBtn = document.getElementById('beautifyBtn');
            const settingsBtn = document.getElementById('settingsBtn');
            const propertiesPanel = document.querySelector('.properties-panel');
            
            if (undoBtn) undoBtn.style.display = 'none';
            if (redoBtn) redoBtn.style.display = 'none';
            if (beautifyBtn) beautifyBtn.style.display = 'none';
            if (settingsBtn) settingsBtn.style.display = 'none';
            if (propertiesPanel) propertiesPanel.style.display = 'none';
            
            // 自动渲染图表（页面加载后）
            console.log('自动渲染图表（页面加载后）');
            this.renderMermaidChart();
            
            // 文本数据修改后自动渲染并保存图表
            const textarea = document.getElementById('mermaidCode');
            if (textarea) {
                console.log('添加文本变化事件监听器');
                textarea.addEventListener('input', () => {
                    console.log('文本变化，自动渲染图表');
                    this.renderMermaidChart();
                    
                    // 渲染完成后立即保存图表
                    console.log('自动保存图表');
                    this.saveMermaidChart();
                });
            }
        });
    }
    
    // 加载Mermaid.js
    async loadMermaidJS() {
        return new Promise((resolve) => {
            // 检查Mermaid.js是否已加载
            if (window.mermaid) {
                resolve();
                return;
            }
            
            // 动态加载Mermaid.js
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.2.4/dist/mermaid.min.js';
            script.onload = () => {
                // 初始化Mermaid.js
                mermaid.initialize({
                    startOnLoad: true,
                    theme: 'default'
                });
                resolve();
            };
            document.head.appendChild(script);
        });
    }
    
    // 渲染Mermaid图表
    renderMermaidChart() {
        const code = document.getElementById('mermaidCode').value;
        const preview = document.getElementById('mermaidPreview');
        
        if (!code) {
            preview.innerHTML = '<p>请输入Mermaid代码</p>';
            return;
        }
        
        // 渲染图表
        preview.innerHTML = `<div class="mermaid">${code}</div>`;
        
        // 调用Mermaid.js渲染
        if (window.mermaid) {
            mermaid.init(undefined, preview.querySelector('.mermaid'));
        }
    }
    
    // 保存Mermaid图表
    async saveMermaidChart() {
        const code = document.getElementById('mermaidCode').value;
        if (!code) {
            this.showStatus('请输入图表代码');
            return;
        }
        
        try {
            // 保存图表数据到数据库
            await this.apiPut(`/api/graphs/${this.graphId}`, {
                code: code
            });
            this.showStatus('图表保存成功');
            
            // 生成并上传缩略图
            await this.generateMermaidThumbnail();
        } catch (error) {
            console.error('保存图表失败:', error);
            this.showStatus('保存图表失败: ' + error.message);
        }
    }
    
    // 生成Mermaid流程图缩略图
    async generateMermaidThumbnail() {
        try {
            const preview = document.getElementById('mermaidPreview');
            if (!preview) {
                console.log('找不到预览容器，无法生成缩略图');
                return;
            }
            
            console.log('开始生成Mermaid流程图缩略图');
            
            // 临时保存原始样式并设置为无背景色和边框
            const originalBgColor = preview.style.backgroundColor;
            const originalBorder = preview.style.border;
            preview.style.backgroundColor = '#ffffff';
            preview.style.border = 'none';
            
            // 查找Mermaid生成的图表元素并移除边框
            const mermaidSvg = preview.querySelector('svg');
            let originalSvgStyle = '';
            if (mermaidSvg) {
                originalSvgStyle = mermaidSvg.getAttribute('style') || '';
                mermaidSvg.setAttribute('style', (originalSvgStyle + ';border: none;').trim());
            }
            
            // 使用html2canvas生成缩略图
            const canvas = await html2canvas(preview, {
                backgroundColor: '#ffffff',
                scale: 0.5, // 缩小比例，减少文件大小
                logging: false
            });
            
            // 恢复原始样式
            preview.style.backgroundColor = originalBgColor;
            preview.style.border = originalBorder;
            if (mermaidSvg && originalSvgStyle) {
                mermaidSvg.setAttribute('style', originalSvgStyle);
            }
            
            // 转换为base64，使用JPEG格式并设置压缩质量
            const thumbnailData = canvas.toDataURL('image/jpeg', 0.7);
            
            console.log('缩略图生成成功，开始上传');
            
            // 上传缩略图
            await this.uploadThumbnail(thumbnailData);
            
            console.log('缩略图上传成功');
        } catch (error) {
            console.error('生成Mermaid流程图缩略图失败:', error);
            // 缩略图生成失败不影响主要功能，只记录错误
        }
    }
    
    showSettingsModal() {
        const modal = document.getElementById('settingsModal');
        modal.style.display = 'block';
        
        // 填充当前设置
        document.getElementById('canvasWidth').value = this.canvasWidth;
        document.getElementById('canvasHeight').value = this.canvasHeight;
        document.getElementById('showNodeInfo').checked = this.showNodeInfo;
        
        // 背景图片预览
        const preview = document.getElementById('backgroundImagePreview');
        if (this.backgroundImage) {
            preview.style.backgroundImage = `url(${this.backgroundImage})`;
            preview.classList.add('has-image');
            preview.textContent = '';
        } else {
            preview.style.backgroundImage = '';
            preview.classList.remove('has-image');
            preview.textContent = '预览区域';
        }
        
        // 动态绑定事件（避免重复绑定）
        const saveSettingsBtn = document.getElementById('saveSettings');
        saveSettingsBtn.onclick = this.saveSettings.bind(this);
        
        const cancelSettingsBtn = document.getElementById('cancelSettings');
        cancelSettingsBtn.onclick = this.hideSettingsModal.bind(this);
        
        const clearBackgroundBtn = document.getElementById('clearBackground');
        clearBackgroundBtn.onclick = this.clearBackground.bind(this);
        
        const backgroundImageInput = document.getElementById('backgroundImage');
        backgroundImageInput.onchange = this.handleBackgroundImageUpload.bind(this);
    }
    
    async saveSettings() {
        const canvasWidth = parseInt(document.getElementById('canvasWidth').value);
        const canvasHeight = parseInt(document.getElementById('canvasHeight').value);
        const showNodeInfo = document.getElementById('showNodeInfo').checked;
        
        try {
            await this.apiPut(`/api/graphs/${this.graphId}`, {
                canvasWidth,
                canvasHeight,
                showNodeInfo
            });
            
            this.canvasWidth = canvasWidth;
            this.canvasHeight = canvasHeight;
            this.showNodeInfo = showNodeInfo;
            
            // 更新画布尺寸
            this.canvas.width = canvasWidth;
            this.canvas.height = canvasHeight;
            this.canvas.style.width = canvasWidth + 'px';
            this.canvas.style.height = canvasHeight + 'px';
            
            this.render();
            this.hideSettingsModal();
            this.showStatus('设置已保存');
        } catch (error) {
            console.error('保存设置失败:', error);
            showModal({ title: '保存失败', message: '保存设置失败: ' + error.message, type: 'error' });
        }
    }
    
    hideSettingsModal() {
        const modal = document.getElementById('settingsModal');
        modal.style.display = 'none';
    }
    
    async handleBackgroundImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const imageData = event.target.result;
                
                // 预览
                const preview = document.getElementById('backgroundImagePreview');
                preview.style.backgroundImage = `url(${imageData})`;
                preview.classList.add('has-image');
                preview.textContent = '';
                
                // 保存到数据库
                await this.apiPut(`/api/graphs/${this.graphId}`, {
                    backgroundImage: imageData
                });
                
                this.backgroundImage = imageData;
                this.render();
            };
            reader.readAsDataURL(file);
        } catch (error) {
            console.error('上传背景图片失败:', error);
            showModal({ title: '上传失败', message: '上传背景图片失败: ' + error.message, type: 'error' });
        }
        
        e.target.value = '';
    }
    
    async clearBackground() {
        try {
            await this.apiPut(`/api/graphs/${this.graphId}`, {
                backgroundImage: null
            });
            
            this.backgroundImage = null;
            
            const preview = document.getElementById('backgroundImagePreview');
            preview.style.backgroundImage = '';
            preview.classList.remove('has-image');
            preview.textContent = '预览区域';
            
            this.render();
        } catch (error) {
            console.error('清除背景图片失败:', error);
            showModal({ title: '清除失败', message: '清除背景图片失败: ' + error.message, type: 'error' });
        }
    }
    
    async saveNode(node) {
        try {
            node.graphId = this.graphId;
            // 创建一个不包含 image 字段的节点副本，因为 image 现在存储在单独的表中
            const nodeWithoutImage = { ...node };
            delete nodeWithoutImage.image;
            
            if (node.id) {
                await this.apiPut(`/api/nodes/${node.id}`, nodeWithoutImage);
            } else {
                const result = await this.apiPost('/api/nodes', nodeWithoutImage);
                
                if (result.id) {
                    node.id = result.id;
                }
            }
            this.showStatus('节点已保存');
            // 生成缩略图
            await this.generateAndUploadThumbnail();
        } catch (error) {
            console.error('保存节点失败:', error);
            this.showStatus('保存节点失败: ' + error.message);
        }
    }
    
    async saveNodePartial(nodeData) {
        try {
            const { id, graphId, image, ...updateFields } = nodeData;
            if (id) {
                await this.apiPut(`/api/nodes/${id}`, updateFields);
            }
            this.showStatus('节点已保存');
            // 生成缩略图
            await this.generateAndUploadThumbnail();
        } catch (error) {
            console.error('保存节点失败:', error);
            this.showStatus('保存节点失败: ' + error.message);
        }
    }

    async saveEdge(edge) {
        try {
            edge.graphId = this.graphId;
            if (edge.id) {
                await this.apiPut(`/api/edges/${edge.id}`, edge);
            } else {
                const result = await this.apiPost('/api/edges', edge);
                edge.id = result.id;
            }
            this.showStatus('关系已保存');
            // 生成缩略图
            await this.generateAndUploadThumbnail();
        } catch (error) {
            console.error('保存关系失败:', error);
            this.showStatus('保存关系失败: ' + error.message);
        }
    }
    
    async saveEdgePartial(edgeData) {
        try {
            const { id, graphId, ...updateFields } = edgeData;
            if (id) {
                await this.apiPut(`/api/edges/${id}`, updateFields);
            }
            this.showStatus('关系已保存');
            // 生成缩略图
            await this.generateAndUploadThumbnail();
        } catch (error) {
            console.error('保存关系失败:', error);
            this.showStatus('保存关系失败: ' + error.message);
        }
    }

    async generateAndUploadThumbnail() {
        try {
            // 生成缩略图
            const thumbnailData = await this.generateThumbnail();
            if (!thumbnailData) {
                return;
            }
            // 上传缩略图
            await this.uploadThumbnail(thumbnailData);
        } catch (error) {
            console.error('生成或上传缩略图失败:', error);
        }
    }

    async generateThumbnail() {
        // 如果没有节点和边，不生成缩略图
        if (this.nodes.length === 0 && this.edges.length === 0) {
            return null;
        }

        // 创建临时 canvas 用于生成缩略图
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        // 缩略图尺寸（调整为更适合卡片的比例）
        const thumbnailWidth = 400;
        const thumbnailHeight = 250;
        tempCanvas.width = thumbnailWidth;
        tempCanvas.height = thumbnailHeight;

        // 计算所有节点的边界框（包含文字）
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.nodes.forEach(node => {
            const radius = node.radius || 40;
            // 增加额外的 padding 以容纳文字
            const padding = radius * 0.8;
            minX = Math.min(minX, node.x - radius - padding);
            minY = Math.min(minY, node.y - radius - padding);
            maxX = Math.max(maxX, node.x + radius + padding);
            maxY = Math.max(maxY, node.y + radius + padding);
        });

        // 如果没有节点，使用默认边界
        if (this.nodes.length === 0) {
            minX = 0;
            minY = 0;
            maxX = this.canvas.width;
            maxY = this.canvas.height;
        }

        // 计算缩放比例和偏移
        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;
        const scaleX = (thumbnailWidth - 20) / contentWidth; // 20 是 padding
        const scaleY = (thumbnailHeight - 20) / contentHeight;
        const scale = Math.min(scaleX, scaleY, 1); // 不放大，只缩小

        const offsetX = (thumbnailWidth - contentWidth * scale) / 2 - minX * scale;
        const offsetY = (thumbnailHeight - contentHeight * scale) / 2 - minY * scale;

        // 绘制背景
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, thumbnailWidth, thumbnailHeight);

        // 应用变换
        tempCtx.save();
        tempCtx.translate(offsetX, offsetY);
        tempCtx.scale(scale, scale);

        // 绘制边（与 render 方法一致）
        this.edges.forEach(edge => {
            const sourceNode = this.nodes.find(n => n.id === edge.sourceId);
            const targetNode = this.nodes.find(n => n.id === edge.targetId);
            if (!sourceNode || !targetNode) return;

            tempCtx.strokeStyle = edge.color || '#e74c3c';
            tempCtx.lineWidth = 2;
            tempCtx.beginPath();
            tempCtx.moveTo(sourceNode.x, sourceNode.y);
            tempCtx.lineTo(targetNode.x, targetNode.y);
            tempCtx.stroke();

            // 绘制关系名称
            const label = edge.name || edge.label || '';
            if (label) {
                // 计算边的中点
                const midX = (sourceNode.x + targetNode.x) / 2;
                const midY = (sourceNode.y + targetNode.y) / 2;

                // 根据缩放比例调整字体大小
                const fontSize = Math.max(8, 12 * scale);
                tempCtx.font = `bold ${fontSize}px Arial`;
                tempCtx.fillStyle = '#333333';
                tempCtx.textAlign = 'center';
                tempCtx.textBaseline = 'middle';

                // 绘制文字背景（白色矩形）以提高可读性
                const textWidth = tempCtx.measureText(label).width;
                const bgPadding = 3;
                tempCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                tempCtx.fillRect(
                    midX - textWidth / 2 - bgPadding,
                    midY - fontSize / 2 - bgPadding,
                    textWidth + bgPadding * 2,
                    fontSize + bgPadding * 2
                );

                // 绘制文字
                tempCtx.fillStyle = '#333333';
                tempCtx.fillText(label, midX, midY);
            }
        });

        // 绘制节点（与 render 方法一致）
        this.nodes.forEach(node => {
            const radius = node.radius || 40;

            // 绘制节点圆
            tempCtx.fillStyle = node.color || '#3498db';
            tempCtx.beginPath();
            tempCtx.arc(node.x, node.y, radius, 0, Math.PI * 2);
            tempCtx.fill();

            // 绘制节点名称
            const name = node.name || '';
            if (name) {
                // 根据缩放比例调整字体大小
                const fontSize = Math.max(10, radius * 0.4 * scale);
                tempCtx.font = `bold ${fontSize}px Arial`;
                tempCtx.fillStyle = '#ffffff';
                tempCtx.textAlign = 'center';
                tempCtx.textBaseline = 'middle';
                
                // 如果文字太长，截断并显示省略号
                const maxWidth = radius * 1.8;
                const measuredWidth = tempCtx.measureText(name).width;
                if (measuredWidth > maxWidth) {
                    let truncated = name;
                    while (tempCtx.measureText(truncated + '...').width > maxWidth && truncated.length > 0) {
                        truncated = truncated.slice(0, -1);
                    }
                    tempCtx.fillText(truncated + '...', node.x, node.y);
                } else {
                    tempCtx.fillText(name, node.x, node.y);
                }
            }
        });

        tempCtx.restore();

        // 转换为 base64，使用 JPEG 格式并设置压缩质量以减少数据大小
        return tempCanvas.toDataURL('image/jpeg', 0.5);
    }

    async uploadThumbnail(thumbnailData) {
        try {
            await this.apiPut(`/api/graphs/${this.graphId}/thumbnail`, {
                thumbnail: thumbnailData
            });
        } catch (error) {
            console.error('上传缩略图失败:', error);
            throw error;
        }
    }

    async saveViewSettings() {
        try {
            await this.apiPut(`/api/graphs/${this.graphId}`, {
                zoomLevel: this.zoomLevel,
                panOffsetX: this.panOffset.x,
                panOffsetY: this.panOffset.y
            });
        } catch (error) {
            console.error('保存视图设置失败:', error);
        }
    }
    
    async deleteNode(node) {
        try {
            await this.apiDelete(`/api/nodes/${node.id}`);
            this.nodes = this.nodes.filter(n => n.id !== node.id);
            this.edges = this.edges.filter(e => e.sourceId !== node.id && e.targetId !== node.id);
            this.saveState();
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
            this.saveState();
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
        
        // 移除之前的捕获阶段事件监听器
        document.removeEventListener('wheel', this.handleWheelCapture, { capture: true });
        
        // 移除之前的画布事件监听器
        this.canvas.removeEventListener('wheel', this.handleWheel);
        
        // 只在画布上添加鼠标滚轮事件监听器
        this.handleWheel = (e) => {
            // 检查鼠标位置是否在画布内
            const canvasRect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX;
            const mouseY = e.clientY;
            
            const isMouseInCanvas = mouseX >= canvasRect.left && mouseX <= canvasRect.right && mouseY >= canvasRect.top && mouseY <= canvasRect.bottom;
            
            if (!isMouseInCanvas) {
                return;
            }
            
            e.preventDefault();
            
            // 确保缩放方向正确：向上滚动放大，向下滚动缩小
            const delta = e.deltaY < 0 ? this.zoomStep : -this.zoomStep;
            const newZoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel + delta));
            
            if (newZoomLevel !== this.zoomLevel) {
                this.setZoom(newZoomLevel);
            }
        };
        
        // 移除重复的滚轮事件监听器，保留下面功能更完整的匿名函数监听器
        // this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
        
        // 按钮事件
        document.getElementById('undoBtn').addEventListener('click', () => this.undo());
        document.getElementById('redoBtn').addEventListener('click', () => this.redo());
        document.getElementById('addNodeBtn').addEventListener('click', () => this.showNodeModal());
        document.getElementById('clearBtn').addEventListener('click', this.handleClear.bind(this));
        document.getElementById('beautifyBtn').addEventListener('click', () => this.beautifyGraph());
        document.getElementById('settingsBtn').addEventListener('click', () => this.showSettingsModal());
        document.getElementById('helpBtn').addEventListener('click', () => this.showHelpModal());
        
        // 缩放控件事件
        document.getElementById('zoomInBtn').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoomOutBtn').addEventListener('click', () => this.zoomOut());
        document.getElementById('zoomResetBtn').addEventListener('click', () => this.zoomReset());
        
        // 移除之前的document级别的事件监听器
        // document.removeEventListener('wheel', this.handleWheel);
        
        // 鼠标滚轮缩放（以鼠标位置为中心）- 直接在画布上添加事件监听器
        this.canvas.addEventListener('wheel', (e) => {


            
            // 检查鼠标位置处的元素是否是属性看板或其内部元素
            const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);

            
            const isElementInPropertiesPanel = elementUnderMouse && elementUnderMouse.closest('.properties-panel') !== null;

            
            if (isElementInPropertiesPanel) {

                return;
            }
            
            // 检查鼠标位置是否在属性看板内
            const propertiesPanel = document.querySelector('.properties-panel');
            let isMouseInPropertiesPanel = false;
            if (propertiesPanel) {
                const rect = propertiesPanel.getBoundingClientRect();

                // 检查鼠标是否在属性看板内
                isMouseInPropertiesPanel = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;

            }
            
            if (isMouseInPropertiesPanel) {

                return;
            }
            
            // 检查鼠标位置是否在画布内
            const canvasRect = this.canvas.getBoundingClientRect();

            const isMouseInCanvas = e.clientX >= canvasRect.left && e.clientX <= canvasRect.right && e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom;

            
            if (!isMouseInCanvas) {

                return;
            }
            

            e.preventDefault();
            
            // 确保缩放方向正确：向上滚动放大，向下滚动缩小
            const delta = e.deltaY < 0 ? this.zoomStep : -this.zoomStep;
            const newZoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel + delta));



            
            if (newZoomLevel !== this.zoomLevel) {

                this.setZoom(newZoomLevel);
            }
        }, { passive: false });
        
        this.setupModalListeners();
        this.updateZoomDisplay();
        this.applyZoom(); // 初始化时应用缩放
        
        // 阻止属性看板上的滚动事件冒泡到画布
        const propertiesPanel = document.querySelector('.properties-panel');
        if (propertiesPanel) {

            // 移除之前的事件监听器
            propertiesPanel.removeEventListener('wheel', this.handlePropertiesPanelWheel);
            
            // 添加新的事件监听器
            this.handlePropertiesPanelWheel = (e) => {

                // 只阻止事件冒泡，不阻止默认行为，这样属性看板的滚动条可以正常滚动
                e.stopPropagation();
            };
            
            propertiesPanel.addEventListener('wheel', this.handlePropertiesPanelWheel, { passive: true });
        }
        
        // 更新缩放控件位置和属性面板高度（延迟执行，确保DOM已完全渲染）
        setTimeout(() => {
            this.updateZoomControlsPosition();
            this.updatePropertiesPanelHeight();
        }, 100);
        
        // 图表类型显示（不再需要事件监听，因为它只是一个显示元素）
        const diagramTypeDisplay = document.getElementById('diagramType');
        if (diagramTypeDisplay) {
            // 确保图表类型显示正确
            diagramTypeDisplay.textContent = this.getDiagramTypeName(this.diagramType);
        }

        // 使用防抖优化性能
        let positionUpdateTimer = null;
        const debouncedUpdatePosition = () => {
            if (positionUpdateTimer) {
                clearTimeout(positionUpdateTimer);
            }
            positionUpdateTimer = setTimeout(() => {
                this.updateZoomControlsPosition();
                this.updatePropertiesPanelHeight();
                this.setupHighDPICanvas();
                this.render();
            }, 10);
        };
        
        // 监听窗口大小变化和滚动，更新缩放控件位置和属性面板高度
        window.addEventListener('resize', debouncedUpdatePosition);
        window.addEventListener('scroll', debouncedUpdatePosition, true); // 使用捕获阶段监听所有滚动
        
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            canvasContainer.addEventListener('scroll', debouncedUpdatePosition);
        }
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
        document.getElementById('saveGraphBtn').addEventListener('click', this.handleManualSave.bind(this));
        
        // 设置弹窗事件
        // 这些事件在 showSettingsModal 中动态绑定
        // 因为设置弹窗在 app.js 加载时还不存在于 DOM 中
        
        document.getElementById('propertiesContent').addEventListener('input', (e) => {
            // 处理 textarea 自动高度调整
            if (e.target.classList.contains('task-textarea')) {
                this.autoResizeTextarea(e.target);
            }
            // 只更新数据，不重新渲染，避免干扰 IME
            this.handlePropertyInput(e);
        });
        
        // 初始化全屏切换按钮事件
        const fullscreenBtn = document.getElementById('propertiesFullscreenBtn');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', this.togglePropertiesFullscreen.bind(this));
        }
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

        // 图片上传相关事件（使用事件委托，避免重复绑定）
        document.getElementById('propertiesContent').addEventListener('click', async (e) => {
            if (e.target.id === 'uploadNodeImageBtn') {
                e.stopPropagation();
                document.getElementById('nodeImageInput').click();
            } else if (e.target.id === 'removeNodeImageBtn') {
                e.stopPropagation();
                try {
                    // 使用新的API端点删除图片
                    const response = await fetch(`/api/node-images?nodeId=${this.selectedNode.id}`, {
                        method: 'DELETE'
                    });
                    if (response.ok) {
                        // 更新本地节点的图片数据
                        this.selectedNode.image = '';
                        this.updatePropertiesPanel();
                        this.render();
                    } else {
                        console.error('删除图片失败:', response.statusText);
                        this.showStatus('删除图片失败');
                    }
                } catch (error) {
                    console.error('删除图片失败:', error);
                    this.showStatus('删除图片失败');
                }
            } else if (e.target.closest('#nodeImagePreview') && !this.selectedNode.image) {
                document.getElementById('nodeImageInput').click();
            }
        });

        document.getElementById('propertiesContent').addEventListener('change', (e) => {
            if (e.target.id === 'nodeImageInput') {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                        const imageData = event.target.result;
                        try {
                            // 使用新的API端点保存图片
                            const response = await fetch('/api/node-images', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    nodeId: this.selectedNode.id,
                                    imageData: imageData
                                })
                            });
                            if (response.ok) {
                                // 更新本地节点的图片数据
                                this.selectedNode.image = imageData;
                                this.updatePropertiesPanel();
                                this.render();
                            } else {
                                console.error('保存图片失败:', response.statusText);
                                this.showStatus('保存图片失败');
                            }
                        } catch (error) {
                            console.error('保存图片失败:', error);
                            this.showStatus('保存图片失败');
                        }
                    };
                    reader.readAsDataURL(file);
                }
            }
        });
    }
    
    async handlePropertyChange(e) {
        // 处理节点的事项清单字段
        const nodeTaskField = e.target.dataset.nodeTaskField;
        if (nodeTaskField && this.selectedNode) {
            // 检查事件目标是否属于当前选中的节点
            const itemEl = e.target.closest('.task-item');
            if (!itemEl) return;
            
            // 检查节点ID是否匹配
            const taskNodeId = parseInt(itemEl.dataset.nodeId, 10);
            if (taskNodeId !== this.selectedNode.id) {
                return;
            }
            
            const taskId = parseInt(itemEl.dataset.taskId, 10);
            if (Number.isNaN(taskId)) return;

            try {
                if (nodeTaskField === 'title') {
                    const response = await fetch(`/api/tasks/${taskId}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ title: e.target.value })
                    });
                    
                    if (response.ok) {
                        // 任务更新成功，无需重新渲染面板，数据会在下次加载时自动更新
                    } else {
                        console.error('任务更新失败:', response.statusText);
                    }
                } else if (nodeTaskField === 'done') {
                    const response = await fetch(`/api/tasks/${taskId}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ done: !!e.target.checked })
                    });
                    
                    if (response.ok) {
                        // 任务更新成功，无需重新渲染面板，数据会在下次加载时自动更新
                    } else {
                        console.error('任务更新失败:', response.statusText);
                    }
                }
            } catch (error) {
                console.error('任务更新失败:', error);
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
            // 只发送需要更新的字段，而不是整个节点对象
            const updateData = {
                id: this.selectedNode.id,
                graphId: this.graphId,
                [prop]: e.target.value
            };
            // 如果更新的是任务清单相关字段，需要发送整个tasks数组
            if (prop === 'taskListName') {
                updateData.tasks = this.selectedNode.tasks;
            }
            this.saveNodePartial(updateData);
            this.render();
        } else if (this.selectedEdge) {
            this.selectedEdge[prop] = e.target.value;
            // 只发送需要更新的字段，而不是整个关系对象
            const updateData = {
                id: this.selectedEdge.id,
                graphId: this.graphId,
                [prop]: e.target.value
            };
            // 如果更新的是任务清单相关字段，需要发送整个tasks数组
            if (prop === 'taskListName') {
                updateData.tasks = this.selectedEdge.tasks;
            }
            this.saveEdgePartial(updateData);
            this.render();
        }
    }

    // 处理输入事件（实时更新数据，但不重新渲染，避免干扰 IME）
    handlePropertyInput(e) {
        // 处理节点的事项清单字段
        const nodeTaskField = e.target.dataset.nodeTaskField;
        if (nodeTaskField && this.selectedNode) {
            // 检查事件目标是否属于当前选中的节点
            const itemEl = e.target.closest('.task-item');
            if (!itemEl) return;
            
            // 检查节点ID是否匹配
            const taskNodeId = parseInt(itemEl.dataset.nodeId, 10);
            if (taskNodeId !== this.selectedNode.id) {
                return;
            }
            
            // 这里不需要实时更新，只在blur时更新
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

    async handleTaskClick(e) {
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
                const currentTitle = this.selectedNode.taskListName || '关键事项';
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

        // 点击排序按钮，切换排序方式
        if (e.target.id === 'taskListSortBtn' || e.target.closest('#taskListSortBtn')) {
            this.sortNodeTasks();
            return;
        }

        // 新增节点事项
        if (e.target.id === 'addNodeTaskBtn') {
            const textarea = document.getElementById('newNodeTaskTitle');
            if (!textarea) return;
            const title = textarea.value.trim();
            if (!title) return;

            try {
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        nodeId: this.selectedNode.id,
                        title: title,
                        done: false
                    })
                });
                
                if (response.ok) {
                    // 任务添加成功，更新任务列表
                    const newTask = await response.json();
                    // 将新任务添加到本地任务数组中
                    if (!Array.isArray(this.selectedNode.tasks)) {
                        this.selectedNode.tasks = [];
                    }
                    this.selectedNode.tasks.push(newTask);
                    textarea.value = '';
                    this.updatePropertiesPanel();
                } else {
                    console.error('任务添加失败:', response.statusText);
                }
            } catch (error) {
                console.error('任务添加失败:', error);
            }
            return;
        }

        // 删除节点事项
        if (e.target.dataset.nodeTaskAction === 'delete') {
            const itemEl = e.target.closest('.task-item');
            if (!itemEl) return;
            const taskId = parseInt(itemEl.dataset.taskId, 10);
            if (Number.isNaN(taskId)) return;

            try {
                const response = await fetch(`/api/tasks/${taskId}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    // 任务删除成功，更新任务列表
                    // 从本地任务数组中删除该任务
                    if (Array.isArray(this.selectedNode.tasks)) {
                        this.selectedNode.tasks = this.selectedNode.tasks.filter(task => task.id !== taskId);
                    }
                    this.updatePropertiesPanel();
                } else {
                    console.error('任务删除失败:', response.statusText);
                }
            } catch (error) {
                console.error('任务删除失败:', error);
            }
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
        const { x, y } = this.getCanvasCoordinates(e);
        
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
        
        // 检查是否点击了展开/收起按钮
        for (let node of this.nodes) {
            const tasks = Array.isArray(node.tasks) ? node.tasks : [];
            if (tasks.length === 0) continue;
            
            const lineHeight = 18;
            const padding = 14;
            const maxWidth = 250;
            const minWidth = 80;
            const maxHeight = 200;
            
            let title = node.name;
            if (node.owner) {
                title += ` (${node.owner})`;
            }
            
            const isExpanded = this.nodeInfoExpanded.get(node.id) || false;
            const maxVisibleTasks = isExpanded ? tasks.length : 3;
            const taskItems = tasks.slice(0, maxVisibleTasks).map(t => {
                const prefix = t.done ? '✓' : '○';
                return `${prefix} ${t.title || ''}`;
            });
            
            const allLines = [title, ...taskItems];
            this.ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
            const lineWidths = allLines.map(line => this.ctx.measureText(line).width);
            // 展开状态下使用更大的最大宽度
            const expandedMaxWidth = 400;
            const currentMaxWidth = isExpanded ? expandedMaxWidth : maxWidth;
            const boxWidth = Math.min(Math.max(Math.max(...lineWidths) + padding * 2, minWidth), currentMaxWidth);
            let boxHeight = allLines.length * lineHeight + padding * 2;
            
            const hasMoreTasks = tasks.length > 3;
            
            // 检查是否有文本可能会被截断
            const maxTextWidth = boxWidth - padding * 2;
            let hasTruncatedText = false;
            
            // 检查标题是否可能会被截断
            const titleWidth = this.ctx.measureText(title).width;
            if (titleWidth > maxTextWidth) {
                hasTruncatedText = true;
            }
            
            // 检查任务项是否可能会被截断
            for (const task of tasks) {
                const taskText = `${task.done ? '✓' : '○'} ${task.title || ''}`;
                const taskWidth = this.ctx.measureText(taskText).width;
                if (taskWidth > maxTextWidth) {
                    hasTruncatedText = true;
                    break;
                }
            }
            
            const needsExpandButton = hasMoreTasks || boxHeight > maxHeight || hasTruncatedText;
            
            // 展开状态下，不限制高度
            if (isExpanded) {
                boxHeight = allLines.length * lineHeight + padding * 2;
            } else if (needsExpandButton) {
                boxHeight = Math.min(boxHeight, maxHeight);
            }
            
            const boxX = node.x + node.radius + 10;
            const boxY = node.y - boxHeight / 2;
            
            // 检查是否点击了展开/收起按钮
            // 无论是否展开，都显示按钮，所以需要检查点击
            const buttonX = boxX + boxWidth - 24;
            const buttonY = boxY + 6;
            const buttonSize = 16;
            
            if (x >= buttonX - buttonSize/2 && x <= buttonX + buttonSize/2 && 
                y >= buttonY && y <= buttonY + buttonSize) {
                this.toggleNodeInfoExpand(node.id);
                return;
            }
        }
        
        this.updatePropertiesPanel();
        this.render();
    }
    
    async handleCanvasDoubleClick(e) {
        const { x, y } = this.getCanvasCoordinates(e);

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

        // 检查双击是否发生在边上（添加转折点）
        for (let edge of this.edges) {
            if (this.isPointOnEdge(x, y, edge)) {
                // 选中这条边
                this.selectedEdge = edge;
                this.selectedNode = null;
                this.updatePropertiesPanel();

                // 添加转折点
                if (!Array.isArray(edge.bendPoints)) {
                    edge.bendPoints = [];
                }

                // 计算中点作为新的转折点位置
                const source = this.nodes.find(n => n.id === edge.sourceId);
                const target = this.nodes.find(n => n.id === edge.targetId);
                if (source && target) {
                    const newBendPoint = {
                        x: (source.x + target.x) / 2,
                        y: (source.y + target.y) / 2
                    };
                    edge.bendPoints.push(newBendPoint);
                    this.showStatus('已添加转折点，请拖拽调整位置（双击其他位置完成）');
                    // 立刻保存一次，避免“只添加不拖拽”时刷新丢失
                    try {
                        await this.saveEdge(edge);
                    } catch (err) {
                        console.error('保存转折点失败:', err);
                    }
                    this.render();
                }
                return;
            }
        }
    }
    
    handleMouseDown(e) {
        const { x, y } = this.getCanvasCoordinates(e);

        // 如果正在创建关系模式，不处理节点拖拽（只处理选择目标节点）
        if (this.creatingEdge) {
            // 更新鼠标位置，用于绘制临时线
            this.edgeMousePos = { x, y };
            this.render();
            return;
        }

        // 检查是否点击在转折点上（选中或拖拽转折点）
        if (this.selectedEdge) {
            const bendPointHit = this.isPointOnBendPoint(x, y, this.selectedEdge);
            if (bendPointHit) {
                // 选中转折点
                this.selectedBendPoint = this.selectedEdge;
                this.selectedBendPointIndex = bendPointHit.index;
                this.updatePropertiesPanel();
                
                // 如果是双击，直接删除转折点
                if (e.detail === 2) {
                    this.deleteSelectedBendPoint();
                    return;
                }
                
                // 准备拖拽转折点
                this.draggingBendPoint = this.selectedEdge;
                this.bendPointIndex = bendPointHit.index;
                this.bendPointEdge = this.selectedEdge;
                this.edgeDragOffset = { x: x - bendPointHit.point.x, y: y - bendPointHit.point.y };
                this.render();
                return;
            }
        }

        // 检查是否点击在边上
        for (let edge of this.edges) {
            if (this.isPointOnEdge(x, y, edge)) {
                this.draggingEdge = edge;
                this.edgeDragStartPos = { x, y };
                this.edgeDragTempTarget = null;
                // 选中这条边
                this.selectedEdge = edge;
                this.selectedNode = null;
                this.updatePropertiesPanel();
                this.render();
                return;
            }
        }

        // 检查是否点击在已选中的节点上
        let clickedOnSelectedNode = false;
        for (let node of this.selectedNodes) {
            if (this.isPointInNode(x, y, node)) {
                clickedOnSelectedNode = true;
                this.draggingSelectedNodes = true;
                this.dragStartPos = { x, y }; // 存储拖拽开始时的鼠标位置
                // 存储所有选中节点的初始位置
                this.selectedNodesInitialPos = this.selectedNodes.map(n => ({ x: n.x, y: n.y }));
                // 存储所有选中转折点的初始位置
                this.selectedBendPointsInitialPos = this.selectedBendPoints.map(bp => ({ x: bp.x, y: bp.y }));
                return;
            }
        }

        // 检查是否点击在节点上
        for (let node of this.nodes) {
            if (this.isPointInNode(x, y, node)) {
                this.draggingNode = node;
                this.dragOffset = { x: x - node.x, y: y - node.y };
                // 清除之前的选择
                this.selectedNodes = [];
                this.selectedBendPoints = [];
                this.selectedNode = node;
                this.updatePropertiesPanel();
                return;
            }
        }

        // 如果没有点击到任何元素，根据是否按住 Ctrl 键决定是圈选还是画布平移
        if (e.ctrlKey) {
            // 按住 Ctrl 键，直接进入画布拖拽模式
            this.isPanning = true;
            this.lastPanPosition = { x: e.clientX, y: e.clientY };
            this.canvas.style.cursor = 'grabbing';
        } else {
            // 普通点击，进入圈选模式
            this.selectionStart = { x, y };
            this.selectionEnd = { x, y };
            this.isDraggingSelection = true;
            this.lastPanPosition = { x: e.clientX, y: e.clientY };
            this.canvas.style.cursor = 'crosshair';
        }
        
        this.render();
        
        // 在 window 上监听事件，确保鼠标超出画布范围时仍能继续操作
        this.panMouseMoveHandler = this.handlePanMouseMove.bind(this);
        this.panMouseUpHandler = this.handlePanMouseUp.bind(this);
        window.addEventListener('mousemove', this.panMouseMoveHandler);
        window.addEventListener('mouseup', this.panMouseUpHandler);
    }

    handlePanMouseMove(e) {
        if (this.isDraggingSelection) {
            const { x, y } = this.getCanvasCoordinates(e);
            
            // 检查是否按住空格键，如果是，则切换到画布拖拽模式
            if (e.ctrlKey) {
                this.isDraggingSelection = false;
                this.isPanning = true;
                this.canvas.style.cursor = 'grabbing';
                this.lastPanPosition = { x: e.clientX, y: e.clientY };
                return;
            }
            
            // 更新圈选框结束位置
            this.selectionEnd = { x, y };
            this.render();
            
            return;
        }
        
        if (!this.isPanning) return;
        
        const dx = e.clientX - this.lastPanPosition.x;
        const dy = e.clientY - this.lastPanPosition.y;
        
        this.panOffset.x += dx;
        this.panOffset.y += dy;
        
        this.lastPanPosition = { x: e.clientX, y: e.clientY };
        this.applyZoom();
    }

    handlePanMouseUp() {
        // 处理圈选结束
        if (this.isDraggingSelection) {
            this.isDraggingSelection = false;
            
            // 计算选择矩形的边界
            const minX = Math.min(this.selectionStart.x, this.selectionEnd.x);
            const maxX = Math.max(this.selectionStart.x, this.selectionEnd.x);
            const minY = Math.min(this.selectionStart.y, this.selectionEnd.y);
            const maxY = Math.max(this.selectionStart.y, this.selectionEnd.y);
            
            // 检查哪些节点在选择矩形内
            this.selectedNodes = this.nodes.filter(node => {
                return node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY;
            });
            
            // 检查哪些转折点在选择矩形内
            this.selectedBendPoints = [];
            this.edges.forEach(edge => {
                if (Array.isArray(edge.bendPoints)) {
                    edge.bendPoints.forEach((bp, index) => {
                        if (bp.x >= minX && bp.x <= maxX && bp.y >= minY && bp.y <= maxY) {
                            this.selectedBendPoints.push({
                                edge: edge,
                                index: index,
                                x: bp.x,
                                y: bp.y
                            });
                        }
                    });
                }
            });
            
            // 如果只选中了一个节点，也设置selectedNode
            if (this.selectedNodes.length === 1) {
                this.selectedNode = this.selectedNodes[0];
            } else {
                this.selectedNode = null;
            }
            
            this.updatePropertiesPanel();
            this.render();
        }
        
        // 处理画布拖拽结束
        this.isPanning = false;
        this.canvas.style.cursor = 'crosshair';
        
        // 保存视图设置到数据库
        this.saveViewSettings();
        
        // 移除 window 级别的事件监听器
        if (this.panMouseMoveHandler) {
            window.removeEventListener('mousemove', this.panMouseMoveHandler);
            this.panMouseMoveHandler = null;
        }
        if (this.panMouseUpHandler) {
            window.removeEventListener('mouseup', this.panMouseUpHandler);
            this.panMouseUpHandler = null;
        }
    }

    handleMouseMove(e) {
        const { x, y } = this.getCanvasCoordinates(e);

        // 如果正在创建关系，更新鼠标位置并重绘临时线
        if (this.creatingEdge && this.edgeSourceNode) {
            this.edgeMousePos = { x, y };
            this.render();
            return;
        }

        // 拖拽转折点
        if (this.draggingBendPoint && this.bendPointEdge) {
            const bendPoints = this.bendPointEdge.bendPoints || [];
            if (bendPoints[this.bendPointIndex]) {
                bendPoints[this.bendPointIndex] = { x, y };
            }
            this.render();
            return;
        }

        // 拖拽边时更新预览
        if (this.draggingEdge) {
            // 更新拖拽位置
            this.edgeDragStartPos = { x, y };
            // 检查是否悬停在某个节点上
            this.edgeDragTempTarget = null;
            for (let node of this.nodes) {
                if (this.isPointInNode(x, y, node)) {
                    // 不能连接到边的原始目标节点
                    if (node.id !== this.draggingEdge.targetId && node.id !== this.draggingEdge.sourceId) {
                        this.edgeDragTempTarget = node;
                    }
                }
            }
            this.render();
            return;
        }

        // 拖拽选中的节点
        if (this.draggingSelectedNodes && this.selectedNodes.length > 0) {
            // 计算鼠标总位移（相对于拖拽开始位置）
            const totalDx = x - this.dragStartPos.x;
            const totalDy = y - this.dragStartPos.y;
            
            // 应用位移到所有选中的节点
            for (let i = 0; i < this.selectedNodes.length; i++) {
                const node = this.selectedNodes[i];
                const initialPos = this.selectedNodesInitialPos[i];
                node.x = initialPos.x + totalDx;
                node.y = initialPos.y + totalDy;
            }
            
            // 应用位移到所有选中的转折点
            for (let i = 0; i < this.selectedBendPoints.length; i++) {
                const bp = this.selectedBendPoints[i];
                const initialPos = this.selectedBendPointsInitialPos[i];
                bp.x = initialPos.x + totalDx;
                bp.y = initialPos.y + totalDy;
                bp.edge.bendPoints[bp.index] = { x: bp.x, y: bp.y };
            }
            
            this.render();
            return;
        }

        // 正常的拖拽节点
        if (this.draggingNode) {
            this.draggingNode.x = x - this.dragOffset.x;
            this.draggingNode.y = y - this.dragOffset.y;
            this.render();
            return;
        }

        // 圈选过程中
        if (this.isDraggingSelection) {
            this.selectionEnd = { x, y };
            this.render();
        }
    }
    
    async handleMouseUp(e) {
        // 如果正在创建关系，检查是否释放在目标节点上
        if (this.creatingEdge && this.edgeSourceNode) {
            const { x, y } = this.getCanvasCoordinates(e);

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

        // 拖拽转折点结束
        if (this.draggingBendPoint && this.bendPointEdge) {
            try {
                // 保存转折点数据到后端
                await this.saveEdge(this.bendPointEdge);
                this.saveState();
                this.showStatus('转折点已保存');
            } finally {
                // 无论保存是否成功，都要清理状态，否则会导致无法二次拖拽
                this.draggingBendPoint = null;
                this.bendPointIndex = -1;
                this.bendPointEdge = null;
            }
            return;
        }

        // 拖拽边结束，重连到新目标
        if (this.draggingEdge && this.edgeDragTempTarget) {
            const edge = this.draggingEdge;
            const oldTargetId = edge.targetId;
            const newTargetId = this.edgeDragTempTarget.id;

            // 更新边的目标节点
            edge.targetId = newTargetId;

            // 保存到后端
            await this.saveEdge(edge);
            this.saveState();

            const sourceNode = this.nodes.find(n => n.id === edge.sourceId);
            const newTargetNode = this.nodes.find(n => n.id === newTargetId);

            this.showStatus(`已重连关系：${sourceNode.name} -> ${newTargetNode.name}`);

            // 清除拖拽状态
            this.draggingEdge = null;
            this.edgeDragTempTarget = null;
            this.render();
            return;
        }

        // 清除拖拽边状态（如果没有重连）
        if (this.draggingEdge) {
            this.draggingEdge = null;
            this.edgeDragTempTarget = null;
            this.render();
            return;
        }

        // 拖拽选中的节点结束
        if (this.draggingSelectedNodes) {
            this.draggingSelectedNodes = false;
            // 清除拖拽相关的临时变量
            this.dragStartPos = null;
            this.selectedNodesInitialPos = null;
            this.selectedBendPointsInitialPos = null;
            
            requestAnimationFrame(async () => {
                for (let node of this.selectedNodes) {
                    await this.saveNode(node);
                }
                
                // 保存所有受影响的边（包含选中的转折点）
                const affectedEdges = new Set();
                for (let bp of this.selectedBendPoints) {
                    affectedEdges.add(bp.edge);
                }
                for (let edge of affectedEdges) {
                    await this.saveEdge(edge);
                }
                
                this.saveState();
            });
            return;
        }

        // 正常的拖拽节点结束
        if (this.draggingNode) {
            const nodeToSave = this.draggingNode;
            this.draggingNode = null;
            
            requestAnimationFrame(async () => {
                await this.saveNode(nodeToSave);
                this.saveState();
            });
            return;
        }

        // 圈选结束（只有在没有添加 window 事件监听器时才处理）
        // 如果添加了 window 事件监听器，说明是通过 handleMouseDown 设置的圈选模式
        // 这种情况下，应该由 handlePanMouseUp 来处理圈选结束
        if (this.isDraggingSelection && !this.panMouseMoveHandler) {
            this.isDraggingSelection = false;
            
            // 计算选择矩形的边界
            const minX = Math.min(this.selectionStart.x, this.selectionEnd.x);
            const maxX = Math.max(this.selectionStart.x, this.selectionEnd.x);
            const minY = Math.min(this.selectionStart.y, this.selectionEnd.y);
            const maxY = Math.max(this.selectionStart.y, this.selectionEnd.y);
            
            // 检查哪些节点在选择矩形内
            this.selectedNodes = this.nodes.filter(node => {
                return node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY;
            });
            
            // 如果只选中了一个节点，也设置selectedNode
            if (this.selectedNodes.length === 1) {
                this.selectedNode = this.selectedNodes[0];
            } else {
                this.selectedNode = null;
            }
            
            this.updatePropertiesPanel();
            this.render();
        }

        // 如果当前是创建关系模式，且鼠标松开后没有创建成功，但已经选择了源节点，则可以认为是想切换源节点
        // 但由于双击已经进入了创建模式，所以这里的mouseUp不应该取消，否则会影响双击后的拖拽
        // 如果需要取消，用户可以使用ESC键或单击空白处
    }
    
    handleKeyDown(e) {
        // Ctrl+Z 撤销
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            this.undo();
            return;
        }
        
        // Ctrl+Y 或 Ctrl+Shift+Z 重做
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            this.redo();
            return;
        }
        
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
    
    // 辅助函数：计算点到线段的距离
    pointToLineSegmentDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) {
            param = dot / lenSq;
        }
        
        let xx, yy;
        
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        
        const dx = px - xx;
        const dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

    isPointOnEdge(x, y, edge) {
        const source = this.nodes.find(n => n.id === edge.sourceId);
        const target = this.nodes.find(n => n.id === edge.targetId);
        
        if (!source || !target) return false;
        
        // 获取转折点数组
        const bendPoints = Array.isArray(edge.bendPoints) ? edge.bendPoints : [];
        
        // 如果有转折点，检查是否在折线的任意一段上
        if (bendPoints.length > 0) {
            // 计算起点和终点（在节点边缘）
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const angle = Math.atan2(dy, dx);
            
            const sourceX = source.x + Math.cos(angle) * source.radius;
            const sourceY = source.y + Math.sin(angle) * source.radius;
            const targetX = target.x - Math.cos(angle) * target.radius;
            const targetY = target.y - Math.sin(angle) * target.radius;
            
            // 构建路径点数组
            const pathPoints = [{ x: sourceX, y: sourceY }, ...bendPoints, { x: targetX, y: targetY }];
            
            // 检查点击是否在任意一段线段上
            const hitRadius = 10; // 点击容差
            for (let i = 0; i < pathPoints.length - 1; i++) {
                const p1 = pathPoints[i];
                const p2 = pathPoints[i + 1];
                const distance = this.pointToLineSegmentDistance(x, y, p1.x, p1.y, p2.x, p2.y);
                if (distance < hitRadius) {
                    return true;
                }
            }
            return false;
        }
        
        // 没有转折点时，使用原来的逻辑（直线或弧线）
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

    // 检测点是否在转折点上
    isPointOnBendPoint(x, y, edge) {
        const bendPoints = Array.isArray(edge.bendPoints) ? edge.bendPoints : [];
        const hitRadius = 10;

        for (let i = 0; i < bendPoints.length; i++) {
            const bp = bendPoints[i];
            const dist = Math.sqrt((x - bp.x) ** 2 + (y - bp.y) ** 2);
            if (dist < hitRadius) {
                return { index: i, point: bp };
            }
        }
        return null;
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
            title.textContent = '编辑节点';
            document.getElementById('nodeName').value = node.name;
            document.getElementById('nodeType').value = node.type;
            document.getElementById('nodeColor').value = node.color;
            form.dataset.nodeId = node.id;
        } else {
            title.textContent = '新增节点';
            form.reset();
            // 显式设置为空字符串，确保覆盖之前的值
            form.dataset.nodeId = '';
            form.removeAttribute('data-node-id');
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
        if (e && e.preventDefault) {
            e.preventDefault();
        }
        
        const form = document.getElementById('nodeForm');
        const nodeId = form.dataset.nodeId;
        
        const nodeName = document.getElementById('nodeName').value;
        const nodeType = document.getElementById('nodeType').value;
        const nodeColor = document.getElementById('nodeColor').value;
        
        // 检查是否是有效的编辑模式
        if (nodeId && nodeId !== 'undefined' && nodeId.trim() !== '') {
            const node = this.nodes.find(n => n.id === parseInt(nodeId));
            if (node) {
                Object.assign(node, {
                    name: nodeName,
                    type: nodeType,
                    color: nodeColor
                });
                await this.saveNode(node);
            }
        } else {
            // 支持批量新增，多个名称用逗号或顿号分隔
            const nodeNames = nodeName.split(/[,，、]/).map(name => name.trim()).filter(name => name);
            
            for (let i = 0; i < nodeNames.length; i++) {
                const name = nodeNames[i];
                const newNode = {
                    x: Math.random() * 300 + 150,
                    y: Math.random() * 300 + 150,
                    radius: 40,
                    name: name,
                    type: nodeType,
                    color: nodeColor
                };
                this.nodes.push(newNode);
                await this.saveNode(newNode);
            }
        }
        
        this.saveState();
        
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
        
        this.saveState();
        
        form.reset();
        document.getElementById('edgeModal').style.display = 'none';
        this.updatePropertiesPanel();
        this.render();
    }
    
    async deleteSelectedBendPoint() {
        if (!this.selectedBendPoint || this.selectedBendPointIndex === -1) {
            return;
        }
        
        const edge = this.selectedBendPoint;
        const index = this.selectedBendPointIndex;
        
        showModal({
            title: '确认删除',
            message: '确定要删除这个转折点吗？',
            type: 'warning',
            showCancel: true,
            onConfirm: async () => {
                // 删除转折点
                edge.bendPoints.splice(index, 1);
                await this.saveEdge(edge);
                
                // 清除选中状态
                this.selectedBendPoint = null;
                this.selectedBendPointIndex = -1;
                
                this.updatePropertiesPanel();
                this.render();
                this.showStatus('转折点已删除');
            }
        });
    }

    async handleDelete() {
        // 先检查是否选中了转折点
        if (this.selectedBendPoint && this.selectedBendPointIndex !== -1) {
            await this.deleteSelectedBendPoint();
            return;
        }
        
        if (!this.selectedNode && !this.selectedEdge) {
            this.showStatus('请先选择一个节点或关系');
            return;
        }
        
        if (this.selectedNode) {
            // 删除节点
            const nodeName = this.selectedNode.name;
            showModal({
                title: '确认删除',
                message: `确定要删除节点"${nodeName}"吗？删除节点将同时删除与该节点相关的所有关系。`,
                type: 'warning',
                showCancel: true,
                onConfirm: async () => {
                    await this.deleteNode(this.selectedNode);
                    this.selectedNode = null;
                    this.updatePropertiesPanel();
                    this.render();
                }
            });
        } else if (this.selectedEdge) {
            // 删除关系
            const source = this.nodes.find(n => n.id === this.selectedEdge.sourceId);
            const target = this.nodes.find(n => n.id === this.selectedEdge.targetId);
            const sourceName = source ? source.name : '未知';
            const targetName = target ? target.name : '未知';
            const edgeLabel = this.selectedEdge.label || '关系';
            
            showModal({
                title: '确认删除',
                message: `确定要删除关系"${edgeLabel}"（从"${sourceName}"到"${targetName}"）吗？`,
                type: 'warning',
                showCancel: true,
                onConfirm: async () => {
                    await this.deleteEdge(this.selectedEdge);
                    this.selectedEdge = null;
                    this.updatePropertiesPanel();
                    this.render();
                }
            });
        }
    }
    
    async handleClear() {
        showModal({
            title: '确认清空',
            message: '确定要清空整个画布吗？',
            type: 'warning',
            showCancel: true,
            onConfirm: async () => {
                await this.clearAll();
                this.selectedNode = null;
                this.selectedEdge = null;
                this.updatePropertiesPanel();
                this.render();
            }
        });
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
            showModal({ title: '导入成功', message: '数据库导入成功', type: 'success' });
            this.showStatus('导入成功');
        } catch (error) {
            console.error('导入失败:', error);
            showModal({ title: '导入失败', message: '导入数据库失败: ' + error.message, type: 'error' });
            this.showStatus('导入失败: ' + error.message);
        }
        
        e.target.value = '';
    }
    
    showStatus(message) {
        const statusText = document.getElementById('statusText');
        if (statusText) {
            statusText.textContent = message;
        }
    }
    
    // ==================== 缩放功能 ====================
    
    setZoom(level) {
        // 检查鼠标是否在属性看板内
        if (window.event) {
            const mousePosition = { x: window.event.clientX, y: window.event.clientY };
            const propertiesPanel = document.querySelector('.properties-panel');
            let isInPropertiesPanel = false;
            if (propertiesPanel) {
                const rect = propertiesPanel.getBoundingClientRect();
                isInPropertiesPanel = mousePosition.x >= rect.left && mousePosition.x <= rect.right && mousePosition.y >= rect.top && mousePosition.y <= rect.bottom;

            }
            
            if (isInPropertiesPanel) {

                return;
            }
            
            // 检查鼠标是否在画布内
            const canvasRect = this.canvas.getBoundingClientRect();
            const isMouseInCanvas = mousePosition.x >= canvasRect.left && mousePosition.x <= canvasRect.right && mousePosition.y >= canvasRect.top && mousePosition.y <= canvasRect.bottom;

            
            if (!isMouseInCanvas) {

                return;
            }
        }
        
        // 限制缩放范围
        this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, level));

        // 保存视图设置到数据库
        this.saveViewSettings();

        this.updateZoomDisplay();
        this.applyZoom();
        this.render();
    }
    
    zoomIn() {
        this.setZoom(this.zoomLevel + this.zoomStep);
    }
    
    zoomOut() {
        this.setZoom(this.zoomLevel - this.zoomStep);
    }
    
    zoomReset() {
        this.panOffset = { x: 0, y: 0 };
        this.setZoom(1.0);
    }
    
    updateZoomDisplay() {
        const zoomLevelEl = document.getElementById('zoomLevel');
        if (zoomLevelEl) {
            zoomLevelEl.textContent = Math.round(this.zoomLevel * 100) + '%';
        }
    }
    
    applyZoom() {
        // 使用 CSS transform 来缩放和平移 canvas
        this.canvas.style.transform = `translate(${this.panOffset.x}px, ${this.panOffset.y}px) scale(${this.zoomLevel})`;
        this.canvas.style.transformOrigin = 'top left';
    }
    
    // 更新缩放控件位置，使其固定在画布左下角
    updateZoomControlsPosition() {
        const zoomControls = document.querySelector('.zoom-controls');
        const canvasContainer = document.querySelector('.canvas-container');
        if (zoomControls && canvasContainer) {
            const rect = canvasContainer.getBoundingClientRect();
            // 计算画布容器的左下角位置
            zoomControls.style.left = (rect.left + 20) + 'px';
            zoomControls.style.bottom = (window.innerHeight - rect.bottom + 20) + 'px';
        }
    }
    
    // 更新属性面板高度，使其与画布容器高度一致
    updatePropertiesPanelHeight() {
        const propertiesPanel = document.querySelector('.properties-panel');
        const canvasContainer = document.querySelector('.canvas-container');
        if (propertiesPanel && canvasContainer && !propertiesPanel.classList.contains('collapsed') && !propertiesPanel.classList.contains('fullscreen')) {
            const canvasRect = canvasContainer.getBoundingClientRect();
            const panelRect = propertiesPanel.getBoundingClientRect();
            // 设置属性面板高度与画布容器高度一致
            propertiesPanel.style.height = canvasRect.height + 'px';
        }
    }
    
    // 切换属性面板全屏模式
    togglePropertiesFullscreen() {
        const panelContainer = document.querySelector('.properties-panel');
        if (panelContainer) {
            // 切换全屏状态
            panelContainer.classList.toggle('fullscreen');
            
            // 确保在全屏模式下不处于折叠状态
            if (panelContainer.classList.contains('fullscreen')) {
                panelContainer.classList.remove('collapsed');
                // 全屏模式下设置高度为视口高度
                panelContainer.style.height = '100vh';
            } else {
                // 退出全屏模式后重新计算高度
                this.updatePropertiesPanelHeight();
            }
        }
    }
    
    // 获取考虑缩放后的鼠标坐标
    getCanvasCoordinates(e) {
        const rect = this.canvas.getBoundingClientRect();
        // 由于使用了 CSS transform 平移画布，getBoundingClientRect 返回的是平移后的位置
        // 所以只需要考虑缩放比例，不需要考虑平移偏移
        const x = (e.clientX - rect.left) / this.zoomLevel;
        const y = (e.clientY - rect.top) / this.zoomLevel;
        return { x, y };
    }

    // 自动调整 textarea 高度以适应内容
    autoResizeTextarea(textarea) {
        // 临时将高度设为 0，以获取内容的真实高度
        textarea.style.height = '0';
        // 设置高度为 scrollHeight，自动适应内容
        textarea.style.height = textarea.scrollHeight + 'px';
    }

    sortNodeTasks() {
        if (!this.selectedNode || !Array.isArray(this.selectedNode.tasks)) return;

        const tasks = this.selectedNode.tasks;
        
        if (tasks.length <= 1) return;

        const hasDone = tasks.some(t => t.done);
        
        if (hasDone) {
            tasks.sort((a, b) => {
                if (a.done === b.done) {
                    return 0;
                }
                return a.done ? 1 : -1;
            });
        } else {
            tasks.reverse();
        }

        this.saveNode(this.selectedNode);
        this.updatePropertiesPanel();
    }

    setupTaskDragSort(panel) {
        const taskList = panel.querySelector('#nodeTaskList');
        if (!taskList) {
            return;
        }

        const taskItems = taskList.querySelectorAll('.task-item');
        let draggedItem = null;

        taskItems.forEach(item => {
            const dragHandle = item.querySelector('.task-drag-handle');
            if (!dragHandle) {
                return;
            }

            dragHandle.addEventListener('dragstart', (e) => {
                draggedItem = item;
                e.dataTransfer.setData('text/plain', item.dataset.taskId);
                e.dataTransfer.effectAllowed = 'move';
                setTimeout(() => {
                    item.classList.add('dragging');
                }, 0);
            });

            dragHandle.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                draggedItem = null;
            });
        });

        // 将 dragover 和 drop 事件监听器添加到任务列表的容器上
        taskList.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!draggedItem) return;

            // 找到鼠标位置下方的任务项
            const taskItems = taskList.querySelectorAll('.task-item');
            let targetItem = null;
            let closestDistance = Infinity;

            taskItems.forEach(item => {
                if (item === draggedItem) return;
                
                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const distance = Math.abs(e.clientY - midY);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    targetItem = item;
                }
            });

            if (targetItem) {
                const rect = targetItem.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;

                if (e.clientY < midY) {
                    taskList.insertBefore(draggedItem, targetItem);
                } else {
                    taskList.insertBefore(draggedItem, targetItem.nextSibling);
                }
            }
        });

        taskList.addEventListener('drop', (e) => {
            e.preventDefault();
            this.saveTaskOrder(taskList);
        });
    }

    saveTaskOrder(taskList) {
        if (!this.selectedNode || !Array.isArray(this.selectedNode.tasks)) {
            return;
        }

        const taskItems = taskList.querySelectorAll('.task-item');
        const newOrder = [];

        taskItems.forEach((item, index) => {
            const taskId = parseInt(item.dataset.taskId);
            if (!isNaN(taskId)) {
                // 查找对应的任务
                const task = this.selectedNode.tasks.find(t => t.id === taskId);
                if (task) {
                    // 更新任务的顺序
                    task.sortOrder = index;
                    newOrder.push(task);
                }
            }
        });

        if (newOrder.length === this.selectedNode.tasks.length) {
            // 更新节点对象中的任务数据
            this.selectedNode.tasks = newOrder;
            
            // 保存每个任务的顺序
            newOrder.forEach(task => {
                // 只发送 sortOrder 字段，简化 API 调用
                fetch(`/api/tasks/${task.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ sortOrder: task.sortOrder })
                })
                .then(response => {
                    if (!response.ok) {
                        console.error('任务顺序保存失败:', task.id, response.statusText);
                    }
                })
                .catch(error => {
                    console.error('保存任务顺序失败:', error);
                });
            });

            // 不需要重新加载任务数据，直接更新属性面板
            // 这样可以避免服务器返回的任务顺序与我们保存的不一致
            this.updatePropertiesPanel();
        }
    }

    async updatePropertiesPanel() {
        let panel = document.getElementById('propertiesContent');
        const panelContainer = document.querySelector('.properties-panel');
        const panelTitle = document.getElementById('propertiesPanelTitle');
        
        // 保存当前选中的tab
        let currentActiveTab = null;
        const activeTabBtn = panel.querySelector('.tab-btn.active');
        if (activeTabBtn) {
            currentActiveTab = activeTabBtn.dataset.tab;
        }
        
        // 移除所有子元素的焦点，防止切换节点时内容被覆盖
        if (document.activeElement && panel.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        
        // 显示加载指示器，而不是立即清空面板内容
        panel.innerHTML = '<div style="display: flex; justify-content: center; align-items: center; height: 300px; color: #999;">加载中...</div>';
        
        // 检查是否选中了多个节点
        if (this.selectedNodes.length > 1) {
            if (panelContainer) {
                panelContainer.classList.remove('collapsed');
            }
            
            if (panelTitle) {
                panelTitle.textContent = '对象属性面板';
            }
            
            panel.innerHTML = `
                <div class="property-group">
                    <label>已选择 ${this.selectedNodes.length} 个节点</label>
                    <p style="color: #666; font-size: 13px;">您可以拖拽这些节点进行整体移动</p>
                </div>
                <div class="property-group">
                    <label>选中的节点:</label>
                    <div class="selected-nodes-list">
                        ${this.selectedNodes.map(node => `
                            <div class="selected-node-item">
                                <span class="selected-node-name">${node.name}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (this.selectedNode) {
            if (panelContainer) {
                panelContainer.classList.remove('collapsed');
            }
            
            if (panelTitle) {
                panelTitle.textContent = '对象属性面板';
            }
            // 找出所有从当前节点发出的关系
            const outgoingEdges = this.edges.filter(e => e.sourceId === this.selectedNode.id);
            // 获取节点的清单名称和事项
            const taskListName = this.selectedNode.taskListName || '关键事项';
            const nodeTasks = Array.isArray(this.selectedNode.tasks) ? this.selectedNode.tasks : [];
            
            panel.innerHTML = `
                <div class="property-group">
                    
                    <div class="node-basic-info">
                        <div class="image-preview" id="nodeImagePreview">
                            ${this.selectedNode.image ? `<img src="${this.selectedNode.image}" alt="节点图片">` : '<span class="image-placeholder">暂无图片</span>'}
                            <div class="image-overlay">
                                <button type="button" id="uploadNodeImageBtn" class="overlay-btn">上传</button>
                                ${this.selectedNode.image ? '<button type="button" id="removeNodeImageBtn" class="overlay-btn delete">删除</button>' : ''}
                            </div>
                        </div>
                        <input type="file" id="nodeImageInput" accept="image/*" style="display: none;">
                        <div class="node-info-right">
                            <input type="text" id="propName" class="node-name-input" value="${this.selectedNode.name}" data-prop="name" placeholder="节点名称">
                            <div class="node-info-row">
                                <select id="propType" data-prop="type">
                                    <option value="organization" ${this.selectedNode.type === 'organization' ? 'selected' : ''}>组织</option>
                                    <option value="person" ${this.selectedNode.type === 'person' ? 'selected' : ''}>人物</option>
                                    <option value="location" ${this.selectedNode.type === 'location' ? 'selected' : ''}>地点</option>
                                    <option value="time" ${this.selectedNode.type === 'time' ? 'selected' : ''}>时间</option>
                                    <option value="event" ${this.selectedNode.type === 'event' ? 'selected' : ''}>事件</option>
                                    <option value="concept" ${this.selectedNode.type === 'concept' ? 'selected' : ''}>概念</option>
                                </select>
                                <input type="text" id="propOwner" value="${this.selectedNode.owner || ''}" data-prop="owner" placeholder="负责人" class="inline-text-input">
                                <input type="color" id="propColor" value="${this.selectedNode.color}" data-prop="color" class="inline-color-input">
                            </div>
                        </div>
                    </div>
                </div>
                <div class="tab-container">
                    <div class="tab-header">
                        <button type="button" class="tab-btn active" data-tab="tasks">关键事项</button>
                        <button type="button" class="tab-btn" data-tab="related">相关方</button>
                        <button type="button" class="tab-btn" data-tab="files">文件</button>
                        <button type="button" class="tab-btn" data-tab="notepad">记事本</button>
                    </div>
                    <div class="tab-content active" data-tab-content="tasks">
                        <div class="task-list-header">
                            ${taskListName ? `
                                <span class="task-list-title-label">${taskListName}</span>
                                <button type="button" class="task-list-edit-btn" data-action="edit-task-list-name" title="编辑">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                    </svg>
                                </button>
                                <button type="button" class="task-list-sort-btn" id="taskListSortBtn" title="排序" style="display: none;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M3 6h18M6 12h12M9 18h6"></path>
                                    </svg>
                                </button>
                            ` : `
                                <input type="text" class="task-list-name-input" data-prop="taskListName" placeholder="请输入事项清单名称（如：目标、待办等）" value="">
                            `}
                        </div>
                        <div class="task-list" id="nodeTaskList">
                            <p style="color: #999; font-size: 13px;">加载中...</p>
                        </div>
                        <div class="task-add">
                            <textarea id="newNodeTaskTitle" class="task-textarea task-add-textarea" placeholder="新增事项..."></textarea>
                            <button type="button" id="addNodeTaskBtn" class="task-add-btn">添加</button>
                        </div>
                    </div>
                    <div class="tab-content" data-tab-content="related">
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
                    <div class="tab-content" data-tab-content="files">
                        <div class="file-upload-area" id="fileUploadArea">
                            <div class="file-upload-icon">📁</div>
                            <div class="file-upload-text">点击或拖拽文件到此处上传</div>
                            <input type="file" id="nodeFileInput" multiple style="display: none;">
                        </div>
                        <div class="file-list" id="nodeFileList">
                            <p style="color: #999; font-size: 13px;">加载中...</p>
                        </div>
                    </div>
                    <div class="tab-content" data-tab-content="notepad">
                        <div class="notepad-content">
                            <div class="notepad-editor" id="nodeNotepadEditor" contenteditable="true">
                                ${this.selectedNode.notepad || '<p>在此输入记事本内容...</p>'}
                            </div>
                            <div class="notepad-toolbar">
                                <button type="button" class="notepad-btn" data-command="bold" title="加粗">
                                    <strong>B</strong>
                                </button>
                                <button type="button" class="notepad-btn" data-command="italic" title="斜体">
                                    <em>I</em>
                                </button>
                                <button type="button" class="notepad-btn" data-command="underline" title="下划线">
                                    <u>U</u>
                                </button>
                                <button type="button" class="notepad-btn" data-command="insertUnorderedList" title="无序列表">
                                    • 列表
                                </button>
                                <button type="button" class="notepad-btn" data-command="insertOrderedList" title="有序列表">
                                    1. 列表
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                
            `;

            // 自动调整所有 textarea 的高度
            panel.querySelectorAll('.task-textarea').forEach(textarea => {
                this.autoResizeTextarea(textarea);
            });

            // 任务拖拽排序功能将在任务列表渲染后添加

            // 添加tab切换事件
            this.setupTabSwitching(panel);

            // 恢复之前选中的tab
            if (currentActiveTab) {
                const targetTabBtn = panel.querySelector(`.tab-btn[data-tab="${currentActiveTab}"]`);
                const targetTabContent = panel.querySelector(`[data-tab-content="${currentActiveTab}"]`);
                
                if (targetTabBtn && targetTabContent) {
                    panel.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    panel.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    
                    targetTabBtn.classList.add('active');
                    targetTabContent.classList.add('active');
                }
            }

            // 添加文件上传事件
            this.setupFileUpload(panel);
            
            // 添加记事本编辑功能
            this.setupNotepadEditor(panel);
            
            // 异步加载任务和文件
            try {
                // 使用本地已经更新过的任务数据，而不是重新从服务器加载
                // 这样可以确保拖拽排序后任务顺序立即更新
                let tasks = this.selectedNode.tasks;
                
                // 如果本地没有任务数据，才从服务器加载
                if (!Array.isArray(tasks) || tasks.length === 0) {
                    const tasksResponse = await fetch(`/api/tasks?nodeId=${this.selectedNode.id}`);
                    if (!tasksResponse.ok) {
                        throw new Error(`加载任务失败: ${tasksResponse.statusText}`);
                    }
                    tasks = await tasksResponse.json();
                    // 将任务数据存储到节点对象中，以便drawNodeInfo方法使用
                    this.selectedNode.tasks = tasks;
                }
                
                // 渲染任务列表
                const taskList = panel.querySelector('#nodeTaskList');
                if (taskList) {
                    if (tasks.length === 0) {
                        taskList.innerHTML = '<p style="color: #999; font-size: 13px;">暂无事项</p>';
                    } else {
                        // 直接使用本地任务数据，不需要重新排序
                        // 因为我们已经在 saveTaskOrder 方法中正确更新了任务顺序
                        taskList.innerHTML = tasks.map((task, index) => `
                            <div class="task-item ${task.done ? 'done' : ''}" data-node-id="${this.selectedNode.id}" data-task-id="${task.id}" data-node-task-index="${index}" draggable="false">
                                <span class="task-drag-handle" title="拖拽排序" draggable="true">⋮⋮</span>
                                <label class="task-checkbox">
                                    <input type="checkbox" data-node-task-field="done" ${task.done ? 'checked' : ''}>
                                    <span class="checkmark"></span>
                                </label>
                                <textarea class="task-textarea" data-node-task-field="title" placeholder="事项内容">${task.title || ''}</textarea>
                                <button type="button" class="task-delete-btn" data-node-task-action="delete">删</button>
                            </div>
                        `).join('');
                    }
                }
                
                // 加载文件
                const filesResponse = await fetch(`/api/files?nodeId=${this.selectedNode.id}`);
                if (!filesResponse.ok) {
                    throw new Error(`加载文件失败: ${filesResponse.statusText}`);
                }
                const files = await filesResponse.json();
                
                // 渲染文件列表
                const fileList = panel.querySelector('#nodeFileList');
                if (fileList) {
                    if (files.length === 0) {
                        fileList.innerHTML = '<p style="color: #999; font-size: 13px;">暂无文件</p>';
                    } else {
                        fileList.innerHTML = files.map(file => `
                            <div class="file-item" data-file-id="${file.id}" data-file-url="${encodeURIComponent(file.url || '')}">
                                <div class="file-info">
                                    <div class="file-icon">📄</div>
                                    <div class="file-details">
                                        <div class="file-name">${file.name}</div>
                                        <div class="file-meta">${file.size || ''}</div>
                                    </div>
                                </div>
                                <div class="file-actions">
                                    <button type="button" class="file-action-btn file-download-btn" data-file-action="download">下载</button>
                                    <button type="button" class="file-action-btn file-delete-btn" data-file-action="delete">删除</button>
                                </div>
                            </div>
                        `).join('');
                    }
                }
                
                // 重新设置文件上传事件，因为文件列表已更新
                this.setupFileUpload(panel);
                
                // 自动调整所有 textarea 的高度
                panel.querySelectorAll('.task-textarea').forEach(textarea => {
                    this.autoResizeTextarea(textarea);
                });
                
                // 添加任务拖拽排序功能
                this.setupTaskDragSort(panel);
            } catch (error) {
                console.error('加载任务或文件失败:', error);
                
                // 显示错误信息
                const taskList = panel.querySelector('#nodeTaskList');
                if (taskList) {
                    taskList.innerHTML = '<p style="color: #ff6b6b; font-size: 13px;">加载任务失败</p>';
                }
                
                const fileList = panel.querySelector('#nodeFileList');
                if (fileList) {
                    fileList.innerHTML = '<p style="color: #ff6b6b; font-size: 13px;">加载文件失败</p>';
                }
            }
        } else if (this.selectedEdge) {
            if (panelContainer) {
                panelContainer.classList.remove('collapsed');
            }
            
            if (panelTitle) {
                panelTitle.textContent = '关系属性面板';
            }
            
            const source = this.nodes.find(n => n.id === this.selectedEdge.sourceId);
            const target = this.nodes.find(n => n.id === this.selectedEdge.targetId);
            const tasks = Array.isArray(this.selectedEdge.tasks) ? this.selectedEdge.tasks : [];
            
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
            if (panelContainer) {
                panelContainer.classList.add('collapsed');
            }
            
            if (panelTitle) {
                panelTitle.textContent = '属性面板';
            }
        }
        
        // 更新属性面板高度（延迟执行，确保DOM更新完成）
        setTimeout(() => {
            this.updatePropertiesPanelHeight();
        }, 0);
    }

    setupTabSwitching(panel) {
        const tabBtns = panel.querySelectorAll('.tab-btn');
        const tabContents = panel.querySelectorAll('.tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                e.target.classList.add('active');
                panel.querySelector(`[data-tab-content="${tabName}"]`).classList.add('active');
            });
        });
    }

    renderNodeFiles() {
        if (!this.selectedNode || !this.selectedNode.files) {
            return '<p style="color: #999; font-size: 13px;">暂无文件</p>';
        }

        const files = Array.isArray(this.selectedNode.files) ? this.selectedNode.files : [];
        
        if (files.length === 0) {
            return '<p style="color: #999; font-size: 13px;">暂无文件</p>';
        }

        return files.map((file, index) => `
            <div class="file-item" data-file-index="${index}">
                <div class="file-info">
                    <div class="file-icon">📄</div>
                    <div class="file-details">
                        <div class="file-name">${file.name}</div>
                        <div class="file-meta">${file.size || ''}</div>
                    </div>
                </div>
                <div class="file-actions">
                    <button type="button" class="file-action-btn file-download-btn" data-file-action="download">下载</button>
                    <button type="button" class="file-action-btn file-delete-btn" data-file-action="delete">删除</button>
                </div>
            </div>
        `).join('');
    }

    setupFileUpload(panel) {
        const uploadArea = panel.querySelector('#fileUploadArea');
        const fileInput = panel.querySelector('#nodeFileInput');
        const fileList = panel.querySelector('#nodeFileList');

        if (!uploadArea || !fileInput || !fileList) return;

        uploadArea.addEventListener('click', () => {
            fileInput.click();
        });

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            this.handleFileUpload(files);
        });

        fileInput.addEventListener('change', (e) => {
            const files = e.target.files;
            this.handleFileUpload(files);
        });

        fileList.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.file-delete-btn');
            const downloadBtn = e.target.closest('.file-download-btn');
            
            if (deleteBtn) {
                const fileItem = deleteBtn.closest('.file-item');
                const fileId = parseInt(fileItem.dataset.fileId, 10);
                this.handleFileDelete(fileId);
            } else if (downloadBtn) {
                const fileItem = downloadBtn.closest('.file-item');
                const fileId = parseInt(fileItem.dataset.fileId, 10);
                const fileUrl = decodeURIComponent(fileItem.dataset.fileUrl || '');
                this.handleFileDownload(fileId, fileUrl);
            }
        });
    }

    setupNotepadEditor(panel) {
        const notepadEditor = panel.querySelector('#nodeNotepadEditor');
        const notepadButtons = panel.querySelectorAll('.notepad-btn');

        if (notepadEditor) {
            // 设置工具栏按钮点击事件
            notepadButtons.forEach(button => {
                button.addEventListener('click', () => {
                    const command = button.dataset.command;
                    document.execCommand(command, false, null);
                    notepadEditor.focus();
                });
            });

            // 监听内容变化，自动保存
            let saveTimeout;
            notepadEditor.addEventListener('input', () => {
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(() => {
                    if (this.selectedNode) {
                        this.selectedNode.notepad = notepadEditor.innerHTML;
                        this.saveNode(this.selectedNode);
                        this.saveState();
                    }
                }, 1000); // 1秒后自动保存
            });

            // 初始化编辑器样式
            notepadEditor.style.minHeight = '300px';
        }
    }

    async handleFileUpload(files) {
        if (!this.selectedNode || !files || files.length === 0) return;

        for (const file of files) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('nodeId', this.selectedNode.id);
            formData.append('name', file.name);
            formData.append('size', this.formatFileSize(file.size));
            formData.append('type', file.type);

            try {
                const response = await fetch('/api/files', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    // 文件上传成功，更新文件列表
                    this.updatePropertiesPanel();
                } else {
                    console.error('文件上传失败:', response.statusText);
                }
            } catch (error) {
                console.error('文件上传失败:', error);
            }
        }
    }

    async handleFileDelete(fileId) {
        if (!this.selectedNode || !fileId) return;

        try {
            const response = await fetch(`/api/files/${fileId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                // 文件删除成功，更新文件列表
                this.updatePropertiesPanel();
            } else {
                console.error('文件删除失败:', response.statusText);
            }
        } catch (error) {
            console.error('文件删除失败:', error);
        }
    }

    async handleFileDownload(fileId, fileUrl) {
        if (!this.selectedNode || !fileId) return;

        try {
            // 如果文件是外部链接，直接在新窗口打开
            if (fileUrl && !fileUrl.startsWith('/uploads/')) {
                window.open(fileUrl, '_blank');
                return;
            }

            // 如果是本地上传的文件，通过API下载
            const response = await fetch(`/api/files/${fileId}/download`);
            
            if (response.ok) {
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = ''; // 文件名会由服务器响应头指定
                link.click();
                URL.revokeObjectURL(url);
            } else {
                console.error('文件下载失败:', response.statusText);
            }
        } catch (error) {
            console.error('文件下载失败:', error);
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
        if (this.renderRequested) {
            return;
        }
        
        this.renderRequested = true;
        
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }
        
        this.rafId = requestAnimationFrame(() => {
            this.renderRequested = false;
            this.rafId = null;
            
            this.doRender();
        });
    }
    
    doRender() {
        // 保存当前变换状态
        this.ctx.save();
        
        // 应用缩放变换（如果需要的话，但这里我们用 CSS transform，所以不需要）
        // this.ctx.scale(this.zoomLevel, this.zoomLevel);
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 绘制背景图片
        if (this.backgroundImage) {
            const img = new Image();
            img.src = this.backgroundImage;
            if (img.complete) {
                this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
            } else {
                img.onload = () => {
                    this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
                };
            }
        }
        
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

        // 绘制拖拽边时的预览线
        if (this.draggingEdge && this.edgeDragTempTarget) {
            // 从拖拽边的源节点或目标节点到新目标节点绘制预览线
            const source = this.nodes.find(n => n.id === this.draggingEdge.sourceId);
            const target = this.nodes.find(n => n.id === this.draggingEdge.targetId);
            const newTarget = this.edgeDragTempTarget;

            if (source && newTarget) {
                this.drawTemporaryEdge(source, {
                    x: newTarget.x,
                    y: newTarget.y
                });
            }
        }

        // 绘制节点
        this.nodes.forEach(node => this.drawNode(node));

        // 绘制圈选矩形
        if (this.isDraggingSelection) {
            const minX = Math.min(this.selectionStart.x, this.selectionEnd.x);
            const maxX = Math.max(this.selectionStart.x, this.selectionEnd.x);
            const minY = Math.min(this.selectionStart.y, this.selectionEnd.y);
            const maxY = Math.max(this.selectionStart.y, this.selectionEnd.y);
            
            this.ctx.strokeStyle = '#667eea';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
            this.ctx.setLineDash([]);
        }

        // 绘制选中节点的高亮效果
        this.selectedNodes.forEach(node => {
            if (node !== this.selectedNode) {
                this.ctx.beginPath();
                this.ctx.arc(node.x, node.y, node.radius + 8, 0, Math.PI * 2);
                this.ctx.strokeStyle = '#667eea';
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([5, 5]);
                this.ctx.stroke();
                this.ctx.setLineDash([]);
            }
        });
        
        // 绘制选中转折点的高亮效果
        this.selectedBendPoints.forEach(bp => {
            this.ctx.beginPath();
            this.ctx.arc(bp.x, bp.y, 10, 0, Math.PI * 2);
            this.ctx.fillStyle = '#667eea';
            this.ctx.fill();
            this.ctx.strokeStyle = '#667eea';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        });
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
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
        this.ctx.shadowBlur = 4;
        this.ctx.shadowOffsetX = 2;
        this.ctx.shadowOffsetY = 2;
        this.ctx.fill();
        
        this.ctx.shadowColor = 'transparent';
        this.ctx.shadowBlur = 0;
        this.ctx.shadowOffsetX = 0;
        this.ctx.shadowOffsetY = 0;
        
        if (this.selectedNode === node || this.selectedNodes.includes(node)) {
            this.ctx.strokeStyle = '#667eea';
            this.ctx.lineWidth = 4;
            this.ctx.stroke();
        }
        
        if (node.image) {
            let img = this.nodeImageCache.get(node.image);
            if (!img) {
                img = new Image();
                img.src = node.image;
                img.onload = () => {
                    this.render();
                };
                this.nodeImageCache.set(node.image, img);
            }
            
            if (img.complete) {
                this.ctx.save();
                this.ctx.beginPath();
                this.ctx.arc(node.x, node.y, node.radius - 2, 0, Math.PI * 2);
                this.ctx.clip();
                this.ctx.drawImage(img, node.x - node.radius + 2, node.y - node.radius + 2, (node.radius - 2) * 2, (node.radius - 2) * 2);
                this.ctx.restore();
            }
        } else {
            this.ctx.fillStyle = 'white';
            this.ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.textRendering = 'optimizeLegibility';
            this.ctx.imageSmoothingEnabled = true;
            this.ctx.imageSmoothingQuality = 'high';
            
            this.ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
            this.ctx.shadowBlur = 1;
            this.ctx.shadowOffsetX = 0;
            this.ctx.shadowOffsetY = 1;
            this.ctx.fillText(node.name, node.x, node.y);
            
            this.ctx.shadowColor = 'transparent';
            this.ctx.shadowBlur = 0;
        }
        
        this.drawNodeInfo(node);
        
        if (this.selectedNode === node || this.selectedNodes.includes(node)) {
            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, node.radius + 8, 0, Math.PI * 2);
            this.ctx.strokeStyle = '#667eea';
            this.ctx.lineWidth = 2.5;
            this.ctx.setLineDash([5, 5]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }
    }

    drawNodeInfo(node) {
        if (!this.showNodeInfo) return;
        
        const tasks = Array.isArray(node.tasks) ? node.tasks : [];
        const hasTasks = tasks.length > 0;

        if (!hasTasks) {
            // 如果节点没有任务数据，尝试异步加载
            this.loadNodeTasks(node);
            return;
        }

        const lineHeight = 18;
        const padding = 14;
        const maxWidth = 250;
        const minWidth = 80;
        const maxHeight = 200;

        this.ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        this.ctx.textBaseline = 'top';
        this.ctx.textRendering = 'optimizeLegibility';
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';

        let title = node.name;
        if (node.owner) {
            title += ` (${node.owner})`;
        }
        
        const isExpanded = this.nodeInfoExpanded.get(node.id) || false;
        const maxVisibleTasks = isExpanded ? tasks.length : 3;
        const taskItems = tasks.slice(0, maxVisibleTasks).map(t => {
            const prefix = t.done ? '✓' : '○';
            return `${prefix} ${t.title || ''}`;
        });

        const allLines = [title, ...taskItems];
        const lineWidths = allLines.map(line => this.ctx.measureText(line).width);
        // 展开状态下使用更大的最大宽度
        const expandedMaxWidth = 400;
        const currentMaxWidth = isExpanded ? expandedMaxWidth : maxWidth;
        const boxWidth = Math.min(Math.max(Math.max(...lineWidths) + padding * 2, minWidth), currentMaxWidth);
        let boxHeight = allLines.length * lineHeight + padding * 2;
        
        const hasMoreTasks = tasks.length > 3;
        
        // 检查是否有文本可能会被截断
        const maxTextWidth = boxWidth - padding * 2;
        let hasTruncatedText = false;
        
        // 检查标题是否可能会被截断
        const titleWidth = this.ctx.measureText(title).width;
        if (titleWidth > maxTextWidth) {
            hasTruncatedText = true;
        }
        
        // 检查任务项是否可能会被截断
        for (const task of tasks) {
            const taskText = `${task.done ? '✓' : '○'} ${task.title || ''}`;
            const taskWidth = this.ctx.measureText(taskText).width;
            if (taskWidth > maxTextWidth) {
                hasTruncatedText = true;
                break;
            }
        }
        
        const needsExpandButton = hasMoreTasks || boxHeight > maxHeight || hasTruncatedText;
        
        if (needsExpandButton && !isExpanded) {
            boxHeight = Math.min(boxHeight, maxHeight);
        }
        
        // 展开状态下，不限制高度
        if (isExpanded) {
            boxHeight = allLines.length * lineHeight + padding * 2;
        }

        const boxX = node.x + node.radius + 10;// 信息框左边缘
        const boxY = node.y - boxHeight / 2;// 信息框上边缘

        this.ctx.save();

        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
        this.ctx.shadowBlur = 8;
        this.ctx.shadowOffsetX = 2;
        this.ctx.shadowOffsetY = 2;

        this.ctx.beginPath();
        this.ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 6);
        this.ctx.fill();

        this.ctx.shadowColor = 'transparent';
        this.ctx.shadowBlur = 0;
        this.ctx.shadowOffsetX = 0;
        this.ctx.shadowOffsetY = 0;

        this.ctx.beginPath();
        this.ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 6);
        this.ctx.clip();

        this.ctx.fillStyle = '#333';
         this.ctx.textAlign = 'left';  // 左对齐
        this.ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        
        // 检查标题是否超出信息框宽度
        const maxTitleWidth = boxWidth - padding * 2;
        const displayTitleWidth = this.ctx.measureText(title).width;
        let displayTitle = title;
        
        // 只在收起状态下进行文本截断
        if (!isExpanded && displayTitleWidth > maxTitleWidth) {
            // 截断标题并添加省略号
            let truncatedTitle = title;
            while (this.ctx.measureText(truncatedTitle + '...').width > maxTitleWidth && truncatedTitle.length > 0) {
                truncatedTitle = truncatedTitle.substring(0, truncatedTitle.length - 1);
            }
            displayTitle = truncatedTitle + '...';
        }
        
        this.ctx.fillText(displayTitle, boxX + padding, boxY + padding);// 标题位置

        this.ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        let hasEllipsis = false;
        
        for (let index = 0; index < taskItems.length; index++) {
            const item = taskItems[index];
            const itemY = boxY + padding + lineHeight * (index + 1);
            
            // 检查是否超出信息框高度
            if (itemY > boxY + boxHeight - padding) {
                // 显示省略号
                if (!isExpanded && !hasEllipsis) {
                    const ellipsisY = itemY - lineHeight;
                    const ellipsisX = boxX + padding;
                    this.ctx.fillStyle = '#666';
                    this.ctx.textAlign = 'left';
                    this.ctx.fillText('...', ellipsisX, ellipsisY);
                    hasEllipsis = true;
                }
                break;
            }
            
            // 检查文本是否超出信息框宽度
            const maxTextWidth = boxWidth - padding * 2;
            const textWidth = this.ctx.measureText(item).width;
            let displayText = item;
            
            // 只在收起状态下进行文本截断
            if (!isExpanded && textWidth > maxTextWidth) {
                // 截断文本并添加省略号
                let truncatedText = item;
                while (this.ctx.measureText(truncatedText + '...').width > maxTextWidth && truncatedText.length > 0) {
                    truncatedText = truncatedText.substring(0, truncatedText.length - 1);
                }
                displayText = truncatedText + '...';
            }
            
            if (item.startsWith('✓')) {
                this.ctx.fillStyle = '#27ae60';
            } else {
                this.ctx.fillStyle = '#666';
            }
            this.ctx.textAlign = 'left';  // 左对齐
            this.ctx.fillText(displayText, boxX + padding, itemY);// 任务项位置
        }
        
        // 如果还有更多任务没有显示，在最后显示省略号
        if (!isExpanded && !hasEllipsis && tasks.length > maxVisibleTasks) {
            const ellipsisY = boxY + padding + lineHeight * (taskItems.length + 1);
            if (ellipsisY <= boxY + boxHeight - padding) {
                this.ctx.fillStyle = '#666';
                this.ctx.textAlign = 'left';
                this.ctx.fillText('...', boxX + padding, ellipsisY);
            }
        }

        this.ctx.restore();

        // 检查是否需要显示展开/收起按钮
        // 收起状态下需要显示展开按钮，或者展开状态下需要显示收起按钮
        const shouldShowButton = needsExpandButton || isExpanded;
        
        if (shouldShowButton) {
            const buttonX = boxX + boxWidth - 24;
            const buttonY = boxY + 6;
            const buttonSize = 16;
            
            this.ctx.save();
            this.ctx.fillStyle = '#666';
            this.ctx.font = '10px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(isExpanded ? '收起' : '展开', buttonX, buttonY + buttonSize / 2);
            this.ctx.restore();
        }
    }
    
    async loadNodeTasks(node) {

        // 检查节点是否正在加载任务数据，防止重复调用
        if (node.isLoadingTasks) {

            return;
        }
        // 检查节点是否已经加载过任务数据，防止重复调用
        if (node.hasLoadedTasks) {

            return;
        }
        if ((!node.tasks || !Array.isArray(node.tasks) || node.tasks.length === 0) && node.id) {
            try {
                // 标记节点正在加载任务数据
                node.isLoadingTasks = true;

                const response = await fetch(`/api/tasks?nodeId=${node.id}`);

                if (response.ok) {
                    const tasks = await response.json();

                    node.tasks = tasks;

                    // 标记节点已经加载过任务数据
                    node.hasLoadedTasks = true;
                    // 重新渲染，以显示任务数据

                    this.render();
                } else {

                    // 尝试获取错误响应的详细信息
                    try {
                        const errorData = await response.json();

                    } catch (e) {

                    }
                    // 标记节点已经加载过任务数据，防止重复调用
                    node.hasLoadedTasks = true;
                }
            } catch (error) {
                console.error('加载节点任务失败:', error);
                // 标记节点已经加载过任务数据，防止重复调用
                node.hasLoadedTasks = true;
            } finally {
                // 清除加载标记
                node.isLoadingTasks = false;
            }
        } else {

        }
    }

    async loadNodeImage(node) {
        // 检查节点是否正在加载图片数据，防止重复调用
        if (node.isLoadingImage) {
            return;
        }
        // 检查节点是否已经加载过图片数据，防止重复调用
        if (node.hasLoadedImage) {
            return;
        }
        if (node.id) {
            try {
                // 标记节点正在加载图片数据
                node.isLoadingImage = true;

                const response = await fetch(`/api/node-images?nodeId=${node.id}`);

                if (response.ok) {
                    const imageData = await response.json();

                    if (imageData) {
                        node.image = imageData;
                    }

                    // 标记节点已经加载过图片数据
                    node.hasLoadedImage = true;
                    // 重新渲染，以显示图片数据
                    this.render();
                } else {
                    console.error('加载节点图片失败:', response.statusText);
                }
            } catch (error) {
                console.error('加载节点图片失败:', error);
            } finally {
                // 取消加载标记
                node.isLoadingImage = false;
            }
        }
    }

    toggleNodeInfoExpand(nodeId) {
        const currentState = this.nodeInfoExpanded.get(nodeId) || false;
        this.nodeInfoExpanded.set(nodeId, !currentState);
        this.render();
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

        // 获取转折点数组
        const bendPoints = Array.isArray(edge.bendPoints) ? edge.bendPoints : [];

        // 构建路径点
        const pathPoints = [{ x: sourceX, y: sourceY }, ...bendPoints, { x: targetX, y: targetY }];

        // 绘制折线
        this.ctx.beginPath();
        this.ctx.moveTo(sourceX, sourceY);
        for (const point of bendPoints) {
            this.ctx.lineTo(point.x, point.y);
        }
        this.ctx.lineTo(targetX, targetY);
        this.ctx.strokeStyle = edge.color;
        this.ctx.lineWidth = this.selectedEdge === edge ? 4 : 3;
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
        this.ctx.shadowBlur = 3;
        this.ctx.shadowOffsetX = 1;
        this.ctx.shadowOffsetY = 1;
        this.ctx.stroke();
        this.ctx.shadowColor = 'transparent';
        this.ctx.shadowBlur = 0;

        // 计算终点的箭头角度（最后一段的方向）
        let arrowAngle = angle;
        if (bendPoints.length > 0) {
            const lastBend = bendPoints[bendPoints.length - 1];
            arrowAngle = Math.atan2(targetY - lastBend.y, targetX - lastBend.x);
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
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
        this.ctx.shadowBlur = 2;
        this.ctx.shadowOffsetX = 1;
        this.ctx.shadowOffsetY = 1;
        this.ctx.fill();
        this.ctx.shadowColor = 'transparent';
        this.ctx.shadowBlur = 0;

        // 计算标签位置（第一个转折点位置或中点）
        let labelX, labelY;

        if (bendPoints.length > 0) {
            // 标签在第一个转折点位置
            labelX = bendPoints[0].x;
            labelY = bendPoints[0].y - 15;
        } else {
            // 标签在中心
            labelX = (sourceX + targetX) / 2;
            labelY = (sourceY + targetY) / 2;
        }

        // 构建标签文本：如果有关系事项，显示名称 + 事项数量
        const tasks = Array.isArray(edge.tasks) ? edge.tasks : [];
        let displayLabel = edge.label;
        if (tasks.length > 0) {
            displayLabel = `${edge.label} (${tasks.length})`;
        }

        // 绘制标签背景（白色半透明，提高可读性）
        this.ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        const textMetrics = this.ctx.measureText(displayLabel);
        const textWidth = textMetrics.width;
        const textHeight = 14;
        const padding = 7;

        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
        this.ctx.shadowBlur = 5;
        this.ctx.shadowOffsetX = 0;
        this.ctx.shadowOffsetY = 2;
        this.ctx.beginPath();
        this.ctx.roundRect(
            labelX - textWidth / 2 - padding,
            labelY - textHeight / 2 - padding / 2,
            textWidth + padding * 2,
            textHeight + padding,
            4
        );
        this.ctx.fill();
        this.ctx.shadowColor = 'transparent';
        this.ctx.shadowBlur = 0;

        // 绘制标签文字
        this.ctx.fillStyle = edge.color;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(displayLabel, labelX, labelY);

        // 绘制转折点（始终显示）
        if (bendPoints.length > 0) {
            for (let i = 0; i < bendPoints.length; i++) {
                const bp = bendPoints[i];
                const isDragging = this.draggingBendPoint === edge && this.bendPointIndex === i;
                const isSelected = this.selectedBendPoint === edge && this.selectedBendPointIndex === i;
                const isBendPointSelected = this.selectedBendPoints.some(sbp => sbp.edge === edge && sbp.index === i);
                const pointRadius = isDragging ? 10 : (isSelected || isBendPointSelected ? 9 : 6);

                this.ctx.beginPath();
                this.ctx.arc(bp.x, bp.y, pointRadius, 0, Math.PI * 2);
                this.ctx.fillStyle = isDragging ? '#667eea' : (isSelected || isBendPointSelected ? '#667eea' : '#fff');
                this.ctx.fill();
                this.ctx.strokeStyle = '#667eea';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }
        }

        // 选中效果
        if (this.selectedEdge === edge) {
            this.ctx.beginPath();
            this.ctx.moveTo(sourceX, sourceY);
            for (const point of bendPoints) {
                this.ctx.lineTo(point.x, point.y);
            }
            this.ctx.lineTo(targetX, targetY);
            this.ctx.strokeStyle = '#667eea';
            this.ctx.lineWidth = 6;
            this.ctx.globalAlpha = 0.3;
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;
        }
        
        // 恢复变换状态
        this.ctx.restore();
    }

    // 导出画布为图片
    exportAsImage(format = 'png') {
        // 保存当前状态
        const zoomLevel = this.zoomLevel;
        const panX = this.panX;
        const panY = this.panY;
        const selectedNode = this.selectedNode;
        const selectedEdge = this.selectedEdge;

        try {
            // 重置缩放和偏移以获取完整视图
            this.zoomLevel = 1;
            this.panX = 0;
            this.panY = 0;
            this.selectedNode = null;
            this.selectedEdge = null;

            // 计算画布所需尺寸
            let minX = 0, minY = 0, maxX = this.canvas.width, maxY = this.canvas.height;
            if (this.nodes.length > 0) {
                minX = Math.min(...this.nodes.map(n => n.x - n.radius)) - 50;
                minY = Math.min(...this.nodes.map(n => n.y - n.radius)) - 50;
                maxX = Math.max(...this.nodes.map(n => n.x + n.radius)) + 50;
                maxY = Math.max(...this.nodes.map(n => n.y + n.radius)) + 50;
            }

            const width = Math.max(800, maxX - minX);
            const height = Math.max(600, maxY - minY);

            // 创建临时画布
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = width;
            exportCanvas.height = height;
            const exportCtx = exportCanvas.getContext('2d');

            // 填充白色背景
            exportCtx.fillStyle = '#ffffff';
            exportCtx.fillRect(0, 0, width, height);

            // 绘制所有内容
            this.ctx = exportCtx;
            this.render();

            // 导出为图片
            const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
            const dataUrl = exportCanvas.toDataURL(mimeType, 0.9);

            // 创建下载链接
            const link = document.createElement('a');
            link.download = `graph-${Date.now()}.${format}`;
            link.href = dataUrl;
            link.click();
        } catch (err) {
            console.error('导出失败:', err);
            showModal({ title: '导出失败', message: '导出失败: ' + err.message, type: 'error' });
        } finally {
            // 恢复原始状态
            this.ctx = this.ctx;
            this.zoomLevel = zoomLevel;
            this.panX = panX;
            this.panY = panY;
            this.selectedNode = selectedNode;
            this.selectedEdge = selectedEdge;
            this.render();
        }
    }
}

