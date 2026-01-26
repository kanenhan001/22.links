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
        this.draggingSelectedNodes = false;
        // 缩放相关状态
        // 默认缩放级别，稍后会尝试从本地缓存恢复
        this.zoomLevel = 1.0; // 当前缩放级别，1.0 = 100%
        this.minZoom = 0.25; // 最小缩放 25%
        this.maxZoom = 3.0; // 最大缩放 300%
        this.zoomStep = 0.1; // 每次缩放步长

        // 当前关系图ID（来自 URL /g/:id）
        this.graphId = this.getGraphIdFromUrl();

        // 节点图片缓存
        this.nodeImageCache = new Map();
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

        // 在初始化时尝试从 localStorage 恢复缩放比例
        try {
            const storedZoom = window.localStorage.getItem('graphEditor.zoomLevel');
            if (storedZoom) {
                const parsed = parseFloat(storedZoom);
                if (!Number.isNaN(parsed) && parsed > 0) {
                    editor.zoomLevel = Math.max(editor.minZoom, Math.min(editor.maxZoom, parsed));
                }
            }
        } catch (err) {
            console.warn('读取缩放缓存失败:', err);
        }

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
            this.showStatus(`已加载 ${nodes.length} 个节点, ${edges.length} 个关系`);
            this.render();
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
    
    async saveNode(node) {
        console.log('saveNode 被调用, id:', node.id);
        try {
            node.graphId = this.graphId;
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
            // 生成缩略图
            await this.generateAndUploadThumbnail();
        } catch (error) {
            console.error('保存节点失败:', error);
            this.showStatus('保存节点失败: ' + error.message);
        }
    }
    
    async saveNodePartial(nodeData) {
        console.log('saveNodePartial 被调用, 更新字段:', Object.keys(nodeData));
        try {
            const { id, graphId, ...updateFields } = nodeData;
            if (id) {
                console.log('部分更新节点:', id);
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
        console.log('saveEdgePartial 被调用, 更新字段:', Object.keys(edgeData));
        try {
            const { id, graphId, ...updateFields } = edgeData;
            if (id) {
                console.log('部分更新关系:', id);
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
                console.log('未生成缩略图（画布为空）');
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
        
        // 缩放控件事件
        document.getElementById('zoomInBtn').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoomOutBtn').addEventListener('click', () => this.zoomOut());
        document.getElementById('zoomResetBtn').addEventListener('click', () => this.zoomReset());
        
        // 鼠标滚轮缩放
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -this.zoomStep : this.zoomStep;
            this.setZoom(this.zoomLevel + delta);
        }, { passive: false });
        
        this.setupModalListeners();
        this.updateZoomDisplay();
        this.applyZoom(); // 初始化时应用缩放
        
        // 更新缩放控件位置和属性面板高度（延迟执行，确保DOM已完全渲染）
        setTimeout(() => {
            this.updateZoomControlsPosition();
            this.updatePropertiesPanelHeight();
        }, 100);
        
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

        // 图片上传相关事件（使用事件委托，避免重复绑定）
        document.getElementById('propertiesContent').addEventListener('click', (e) => {
            if (e.target.id === 'uploadNodeImageBtn') {
                e.stopPropagation();
                document.getElementById('nodeImageInput').click();
            } else if (e.target.id === 'removeNodeImageBtn') {
                e.stopPropagation();
                this.selectedNode.image = '';
                this.saveNode(this.selectedNode);
                this.updatePropertiesPanel();
                this.render();
            } else if (e.target.closest('#nodeImagePreview') && !this.selectedNode.image) {
                document.getElementById('nodeImageInput').click();
            }
        });

        document.getElementById('propertiesContent').addEventListener('change', (e) => {
            if (e.target.id === 'nodeImageInput') {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const imageData = event.target.result;
                        this.selectedNode.image = imageData;
                        this.saveNode(this.selectedNode);
                        this.updatePropertiesPanel();
                        this.render();
                    };
                    reader.readAsDataURL(file);
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
                this.dragOffset = { x: x - node.x, y: y - node.y };
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
                this.selectedNode = node;
                this.updatePropertiesPanel();
                return;
            }
        }

        // 开始圈选
        this.isDraggingSelection = true;
        this.selectionStart = { x, y };
        this.selectionEnd = { x, y };
        // 清除之前的选择
        this.selectedNodes = [];
        this.selectedNode = null;
        this.selectedEdge = null;
        this.updatePropertiesPanel();
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
            // 计算第一个节点的新位置
            const firstNodeNewX = x - this.dragOffset.x;
            const firstNodeNewY = y - this.dragOffset.y;
            
            // 计算位移量
            const dx = firstNodeNewX - this.selectedNodes[0].x;
            const dy = firstNodeNewY - this.selectedNodes[0].y;
            
            // 应用位移到所有选中的节点
            for (let node of this.selectedNodes) {
                node.x += dx;
                node.y += dy;
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
            
            requestAnimationFrame(async () => {
                for (let node of this.selectedNodes) {
                    await this.saveNode(node);
                }
            });
            return;
        }

        // 正常的拖拽节点结束
        if (this.draggingNode) {
            const nodeToSave = this.draggingNode;
            this.draggingNode = null;
            
            requestAnimationFrame(async () => {
                await this.saveNode(nodeToSave);
            });
            return;
        }

        // 圈选结束
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
        
        const nodeName = document.getElementById('nodeName').value;
        const nodeType = document.getElementById('nodeType').value;
        const nodeColor = document.getElementById('nodeColor').value;
        
        // 检查是否是有效的编辑模式
        if (nodeId && nodeId !== 'undefined' && nodeId.trim() !== '') {
            console.log('编辑模式, nodeId =', nodeId);
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
            console.log('新增模式');
            // 支持批量新增，多个名称用逗号或顿号分隔
            const nodeNames = nodeName.split(/[,，、]/).map(name => name.trim()).filter(name => name);
            
            for (let i = 0; i < nodeNames.length; i++) {
                const name = nodeNames[i];
                const newNode = {
                    x: Math.random() * (this.canvas.width - 200) + 100,
                    y: Math.random() * (this.canvas.height - 200) + 100,
                    radius: 40,
                    name: name,
                    type: nodeType,
                    color: nodeColor
                };
                this.nodes.push(newNode);
                await this.saveNode(newNode);
            }
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
            console.log('Frontend: Attempting to delete selected edge with id:', this.selectedEdge.id);
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
        console.log(message);
    }
    
    // ==================== 缩放功能 ====================
    
    setZoom(level) {
        // 限制缩放范围
        this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, level));

        // 缓存当前缩放比例到 localStorage，便于刷新后恢复
        try {
            window.localStorage.setItem('graphEditor.zoomLevel', String(this.zoomLevel));
        } catch (err) {
            console.warn('保存缩放缓存失败:', err);
        }

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
        this.setZoom(1.0);
    }
    
    updateZoomDisplay() {
        const zoomLevelEl = document.getElementById('zoomLevel');
        if (zoomLevelEl) {
            zoomLevelEl.textContent = Math.round(this.zoomLevel * 100) + '%';
        }
    }
    
    applyZoom() {
        // 使用 CSS transform 来缩放 canvas
        this.canvas.style.transform = `scale(${this.zoomLevel})`;
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
        if (propertiesPanel && canvasContainer && !propertiesPanel.classList.contains('collapsed')) {
            const canvasRect = canvasContainer.getBoundingClientRect();
            const panelRect = propertiesPanel.getBoundingClientRect();
            // 设置属性面板高度与画布容器高度一致
            propertiesPanel.style.height = canvasRect.height + 'px';
        }
    }
    
    // 获取考虑缩放后的鼠标坐标
    getCanvasCoordinates(e) {
        const rect = this.canvas.getBoundingClientRect();
        // CSS transform scale 会影响 getBoundingClientRect，所以需要除以缩放比例
        // 但实际测试发现，getBoundingClientRect 返回的是原始尺寸，所以直接除以缩放比例即可
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
        if (!taskList) return;

        const taskItems = taskList.querySelectorAll('.task-item');
        let draggedItem = null;

        taskItems.forEach(item => {
            const dragHandle = item.querySelector('.task-drag-handle');
            if (!dragHandle) return;

            dragHandle.addEventListener('dragstart', (e) => {
                draggedItem = item;
                e.dataTransfer.setData('text/plain', item.dataset.nodeTaskIndex);
                e.dataTransfer.effectAllowed = 'move';
                setTimeout(() => {
                    item.classList.add('dragging');
                }, 0);
            });

            dragHandle.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                draggedItem = null;
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (!draggedItem || draggedItem === item) return;

                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;

                if (e.clientY < midY) {
                    taskList.insertBefore(draggedItem, item);
                } else {
                    taskList.insertBefore(draggedItem, item.nextSibling);
                }
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                this.saveTaskOrder(taskList);
            });
        });
    }

    saveTaskOrder(taskList) {
        if (!this.selectedNode || !Array.isArray(this.selectedNode.tasks)) return;

        const taskItems = taskList.querySelectorAll('.task-item');
        const newOrder = [];

        taskItems.forEach(item => {
            const index = parseInt(item.dataset.nodeTaskIndex);
            if (!isNaN(index) && this.selectedNode.tasks[index]) {
                newOrder.push(this.selectedNode.tasks[index]);
            }
        });

        if (newOrder.length === this.selectedNode.tasks.length) {
            this.selectedNode.tasks = newOrder;
            this.saveNode(this.selectedNode);
            this.updatePropertiesPanel();
        }
    }

    updatePropertiesPanel() {
        const panel = document.getElementById('propertiesContent');
        const panelContainer = document.querySelector('.properties-panel');
        
        // 检查是否选中了多个节点
        if (this.selectedNodes.length > 1) {
            if (panelContainer) {
                panelContainer.classList.remove('collapsed');
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
                                <input type="color" id="propColor" value="${this.selectedNode.color}" data-prop="color" class="inline-color-input">
                            </div>
                        </div>
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
                        ${nodeTasks.map((task, index) => `
                            <div class="task-item ${task.done ? 'done' : ''}" data-node-task-index="${index}" draggable="false">
                                <span class="task-drag-handle" title="拖拽排序" draggable="true">⋮⋮</span>
                                <label class="task-checkbox">
                                    <input type="checkbox" data-node-task-field="done" ${task.done ? 'checked' : ''}>
                                    <span class="checkmark"></span>
                                </label>
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

            // 添加任务拖拽排序功能
            this.setupTaskDragSort(panel);
        } else if (this.selectedEdge) {
            if (panelContainer) {
                panelContainer.classList.remove('collapsed');
            }
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
            if (panelContainer) {
                panelContainer.classList.add('collapsed');
            }
        }
        
        // 更新属性面板高度（延迟执行，确保DOM更新完成）
        setTimeout(() => {
            this.updatePropertiesPanelHeight();
        }, 0);
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
        
        this.ctx.strokeStyle = (this.selectedNode === node || this.selectedNodes.includes(node)) ? '#667eea' : '#333';
        this.ctx.lineWidth = (this.selectedNode === node || this.selectedNodes.includes(node)) ? 4 : 2.5;
        this.ctx.stroke();
        
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
            this.ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            
            this.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            this.ctx.shadowBlur = 3;
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
        const tasks = Array.isArray(node.tasks) ? node.tasks : [];
        const hasTasks = tasks.length > 0;

        if (!hasTasks) return;

        const lineHeight = 18;
        const padding = 14;
        const maxWidth = 180;
        const minWidth = 80;

        this.ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        this.ctx.textBaseline = 'top';

        const title = node.name;
        const taskItems = tasks.slice(0, 3).map(t => {
            const prefix = t.done ? '✓' : '○';
            return `${prefix} ${t.title || ''}`;
        });

        const allLines = [title, ...taskItems];
        const lineWidths = allLines.map(line => this.ctx.measureText(line).width);
        const boxWidth = Math.max(Math.max(...lineWidths) + padding * 2, minWidth);
        const boxHeight = allLines.length * lineHeight + padding * 2;

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
        this.ctx.fillText(title, boxX + padding, boxY + padding);// 标题位置

        this.ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        taskItems.forEach((item, index) => {
            const itemY = boxY + padding + lineHeight * (index + 1);
            if (item.startsWith('✓')) {
                this.ctx.fillStyle = '#27ae60';
            } else {
                this.ctx.fillStyle = '#666';
            }
            this.ctx.textAlign = 'left';  // 左对齐
            this.ctx.fillText(item, boxX + padding, itemY);// 任务项位置
        });

        this.ctx.restore();
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

        // 绘制转折点（选中边时才显示）
        if (this.selectedEdge === edge && bendPoints.length > 0) {
            for (let i = 0; i < bendPoints.length; i++) {
                const bp = bendPoints[i];
                const isDragging = this.draggingBendPoint === edge && this.bendPointIndex === i;
                const isSelected = this.selectedBendPoint === edge && this.selectedBendPointIndex === i;
                const pointRadius = isDragging ? 10 : (isSelected ? 9 : 8);

                this.ctx.beginPath();
                this.ctx.arc(bp.x, bp.y, pointRadius, 0, Math.PI * 2);
                this.ctx.fillStyle = isDragging ? '#667eea' : (isSelected ? '#667eea' : '#fff');
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

            console.log('图片导出成功');
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

let editor;
(async () => {
    editor = await GraphEditor.create();
    // 检查是否为导出模式
    const urlParams = new URLSearchParams(window.location.search);
    const exportFormat = urlParams.get('export');
    if (exportFormat === 'png' || exportFormat === 'jpg') {
        setTimeout(() => {
            editor.exportAsImage(exportFormat);
            // 清除 URL 参数
            window.history.replaceState({}, document.title, window.location.pathname);
        }, 500);
    }
})();

// SweetAlert2 弹窗函数
function showModal(options) {
  const {
    title = '提示',
    message = '',
    type = 'info',
    onConfirm = null,
    showCancel = false
  } = options || {};

  // 映射类型到 SweetAlert2 图标
  const iconMap = {
    'success': 'success',
    'error': 'error',
    'warning': 'warning',
    'info': 'info'
  };

  const swalOptions = {
    title: title,
    text: message,
    icon: iconMap[type] || 'info',
    confirmButtonText: '确定',
    customClass: {
      title: 'swal2-title-sm',
      content: 'swal2-content-sm',
      confirmButton: 'swal2-btn-sm'
    }
  };

  // 如果需要取消按钮
  if (showCancel) {
    swalOptions.showCancelButton = true;
    swalOptions.cancelButtonText = '取消';
    swalOptions.cancelButtonColor = '#666';
    swalOptions.customClass.cancelButton = 'swal2-btn-sm';
  }

  Swal.fire(swalOptions).then((result) => {
    if (result.isConfirmed && onConfirm) {
      onConfirm();
    }
  });
}
