async function fetchJson(url, opts) {
      const res = await fetch(url, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    }

    function fmtTime(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleString();
      } catch (_) {
        return iso || '';
      }
    }

    async function ensureLogin() {
      const s = await fetchJson('/api/auth/status');
      if (!s.loggedIn) {
        window.location.href = '/login';
        return null;
      }
      document.getElementById('nickname').textContent = s.user?.nickname || '用户';
      const avatar = document.getElementById('avatar');
      if (s.user?.avatarUrl) {
        avatar.src = s.user.avatarUrl;
        avatar.style.background = 'transparent';
      } else {
        avatar.removeAttribute('src');
      }
      
      // 检查是否是 admin 用户
      if (s.user?.username === 'admin') {
        document.body.classList.add('admin-user');
      }
      
      return s.user;
    }

    // 用户管理相关函数
    function openUserManagementModal() {
      document.getElementById('userManagementModal').classList.remove('hidden');
      loadUsers();
    }

    function closeUserManagementModal() {
      document.getElementById('userManagementModal').classList.add('hidden');
    }

    async function loadUsers() {
      try {
        const users = await fetchJson('/api/users');
        renderUserList(users);
      } catch (err) {
        Sweetalert2.fire({
          title: '加载失败',
          text: '加载用户列表失败：' + err.message,
          icon: 'error',
          confirmButtonColor: '#667eea',
          width: '320px'
        });
      }
    }

    function renderUserList(users) {
      const userList = document.getElementById('userList');
      userList.innerHTML = '';
      
      if (!users || users.length === 0) {
        userList.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">暂无用户</div>';
        return;
      }
      
      for (const user of users) {
        const userItem = document.createElement('div');
        userItem.className = 'user-item';
        userItem.innerHTML = `
          <div class="user-item-info">
            <div class="user-item-name">${user.nickname && user.nickname !== 'None' ? user.nickname : '未命名用户'}</div>
          </div>
          <div class="user-item-username">${user.username}</div>
          <div class="user-item-time">${formatDate(user.createdAt)}</div>
          <div class="user-item-status ${user.isActive ? 'active' : 'disabled'}">
            ${user.isActive ? '正常' : '已停用'}
          </div>
          <div class="user-item-actions">
            <button class="user-item-btn" onclick="openEditUserModal(${user.id})">编辑</button>
            <button class="user-item-btn" onclick="openResetPasswordModal(${user.id})">重置密码</button>
            ${user.username !== 'admin' ? `<button class="user-item-btn danger" onclick="toggleUserStatus(${user.id}, ${user.isActive ? 0 : 1})">${user.isActive ? '停用' : '启用'}</button>` : ''}
            ${user.username !== 'admin' ? `<button class="user-item-btn danger" onclick="deleteUser(${user.id})">删除</button>` : ''}
          </div>
        `;
        userList.appendChild(userItem);
      }
    }

    function formatDate(dateString) {
      if (!dateString) return '-';
      const date = new Date(dateString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    }

    function openAddUserModal() {
      document.getElementById('userFormTitle').textContent = '新增用户';
      document.getElementById('userId').value = '';
      document.getElementById('username').value = '';
      document.getElementById('userNickname').value = '';
      document.getElementById('password').value = '';
      document.getElementById('confirmPassword').value = '';
      document.getElementById('userFormModal').classList.remove('hidden');
    }

    function openEditUserModal(userId) {
      document.getElementById('userFormTitle').textContent = '编辑用户';
      document.getElementById('userId').value = userId;
      
      fetchJson('/api/users/' + userId).then(user => {
        document.getElementById('username').value = user.username;
        document.getElementById('userNickname').value = (user.nickname && user.nickname !== 'None') ? user.nickname : '';
        document.getElementById('password').value = '';
        document.getElementById('confirmPassword').value = '';
        document.getElementById('userFormModal').classList.remove('hidden');
      }).catch(err => {
        Sweetalert2.fire({
          title: '加载失败',
          text: '加载用户信息失败：' + err.message,
          icon: 'error',
          confirmButtonColor: '#667eea',
          width: '320px'
        });
      });
    }

    function closeUserFormModal() {
      document.getElementById('userFormModal').classList.add('hidden');
    }

    async function handleSaveUser() {
      const userId = document.getElementById('userId').value;
      const username = document.getElementById('username').value.trim();
      const nickname = document.getElementById('userNickname').value.trim();
      const password = document.getElementById('password').value.trim();
      const confirmPassword = document.getElementById('confirmPassword').value.trim();
      
      if (!username) {
        Sweetalert2.fire({
          title: '验证失败',
          text: '用户名不能为空',
          icon: 'error',
          confirmButtonColor: '#667eea',
          width: '320px'
        });
        return;
      }
      
      if (password && password !== confirmPassword) {
        Sweetalert2.fire({
          title: '验证失败',
          text: '两次输入的密码不一致',
          icon: 'error',
          confirmButtonColor: '#667eea',
          width: '320px'
        });
        return;
      }
      
      if (userId && !password) {
        Sweetalert2.fire({
          title: '验证失败',
          text: '编辑用户时必须输入密码',
          icon: 'error',
          confirmButtonColor: '#667eea',
          width: '320px'
        });
        return;
      }
      
      try {
        const userData = {
          username: username,
          nickname: nickname
        };
      if (password) {
          userData.password = password;
        }
      if (userId) {
          await fetchJson('/api/users/' + userId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
          });
        } else {
          await fetchJson('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
          });
        }
        
        closeUserFormModal();
        loadUsers();
        
        Sweetalert2.fire({
          title: '保存成功',
          text: userId ? '用户信息已更新' : '用户已创建',
          icon: 'success',
          confirmButtonColor: '#667eea',
          width: '320px'
        });
      } catch (err) {
        Sweetalert2.fire({
          title: '保存失败',
          text: err.message,
          icon: 'error',
          confirmButtonColor: '#667eea',
          width: '320px'
        });
      }
    }

    async function deleteUser(userId) {
      Sweetalert2.fire({
        title: '确认删除',
        text: '确定要删除该用户吗？此操作不可恢复。',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        confirmButtonColor: '#e53935',
        cancelButtonColor: '#666',
        width: '320px'
      }).then(async (result) => {
        if (result.isConfirmed) {
          try {
            await fetchJson('/api/users/' + userId, {
              method: 'DELETE'
            });
            loadUsers();
            
            Sweetalert2.fire({
              title: '删除成功',
              text: '用户已删除',
              icon: 'success',
              confirmButtonColor: '#667eea',
              width: '320px'
            });
          } catch (err) {
            Sweetalert2.fire({
              title: '删除失败',
              text: err.message,
              icon: 'error',
              confirmButtonColor: '#667eea',
              width: '320px'
            });
          }
        }
      });
    }

    async function toggleUserStatus(userId, isActive) {
      try {
        await fetchJson('/api/users/' + userId + '/status', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive })
        });
        loadUsers();
        
        Sweetalert2.fire({
          title: '操作成功',
          text: isActive ? '用户已启用' : '用户已停用',
          icon: 'success',
          confirmButtonColor: '#667eea',
          width: '320px'
        });
      } catch (err) {
        Sweetalert2.fire({
          title: '操作失败',
          text: err.message,
          icon: 'error',
          confirmButtonColor: '#667eea',
          width: '320px'
        });
      }
    }

    async function openResetPasswordModal(userId) {
      Sweetalert2.fire({
        title: '重置密码',
        text: '确定要重置该用户的密码吗？',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        confirmButtonColor: '#667eea',
        cancelButtonColor: '#666',
        width: '320px'
      }).then(async (result) => {
        if (result.isConfirmed) {
          try {
            await fetchJson('/api/users/' + userId + '/reset-password', {
              method: 'POST'
            });
            
            Sweetalert2.fire({
              title: '重置成功',
              text: '密码已重置为：123456',
              icon: 'success',
              confirmButtonColor: '#667eea',
              width: '320px'
            });
          } catch (err) {
            Sweetalert2.fire({
              title: '重置失败',
              text: err.message,
              icon: 'error',
              confirmButtonColor: '#667eea',
              width: '320px'
            });
          }
        }
      });
    }

    // 图表类型选择面板交互
    function initChartTypePanel() {
      console.log('initChartTypePanel function called');
      const btnCreate = document.getElementById('btnCreate');
      const chartTypePanel = document.getElementById('chartTypePanel');
      
      console.log('btnCreate element:', btnCreate);
      console.log('chartTypePanel element:', chartTypePanel);
      
      // 移除现有的点击事件监听器
      const newBtnCreate = btnCreate.cloneNode(true);
      btnCreate.parentNode.replaceChild(newBtnCreate, btnCreate);
      
      // 点击新建按钮显示/隐藏面板
      newBtnCreate.addEventListener('click', (e) => {
        console.log('New chart button clicked!');
        e.stopPropagation();
        // 切换图表类型面板的显示/隐藏
        chartTypePanel.classList.toggle('hidden');
        console.log('Chart type panel visibility:', !chartTypePanel.classList.contains('hidden'));
      });
      
      // 使用事件委托绑定图表类型项的点击事件
      console.log('Adding click event listener to chartTypePanel');
      chartTypePanel.addEventListener('click', (e) => {
        console.log('Click inside chartTypePanel:', e.target);
        const chartTypeItem = e.target.closest('.chart-type-item');
        console.log('Closest chart-type-item:', chartTypeItem);
        if (chartTypeItem) {
          console.log('Chart type item clicked:', chartTypeItem.dataset.type);
          e.stopPropagation();
          const diagramType = chartTypeItem.dataset.type;
          chartTypePanel.classList.add('hidden');
          console.log('Calling openCreateModal with diagramType:', diagramType);
          openCreateModal(diagramType);
        }
      });
      
      // 点击页面其他地方隐藏面板
      document.addEventListener('click', (e) => {
        if (!newBtnCreate.contains(e.target) && !chartTypePanel.contains(e.target)) {
          chartTypePanel.classList.add('hidden');
        }
      });
    }
    
    // 打开创建图表模态框
    async function openCreateModal(diagramType) {
      console.log('openCreateModal function called with diagramType:', diagramType);
      const result = await Swal.fire({
        title: '新建图表',
        html: `
          <div style="width: 100%; max-width: 100%; overflow: hidden;">
            <div style="margin-bottom: 10px;">
              <label style="font-size: 13px; font-weight: 500; color: #333; display: block; margin-bottom: 5px; text-align: left;">图名</label>
              <input type="text" id="graphName" placeholder="请输入图表名称" style="width: 100%; box-sizing: border-box; padding: 8px; font-size: 13px; border: 1px solid #ddd; border-radius: 4px;">
            </div>
            <div style="margin-bottom: 10px;">
              <label style="font-size: 13px; font-weight: 500; color: #333; display: block; margin-bottom: 5px; text-align: left;">图表类型</label>
              <select id="graphType" style="width: 100%; box-sizing: border-box; padding: 8px; font-size: 13px; border: 1px solid #ddd; border-radius: 4px;">
                <option value="relationship" ${diagramType === 'relationship' ? 'selected' : ''}>关系图</option>
                <option value="flow" ${diagramType === 'flow' ? 'selected' : ''}>流程图</option>
                <option value="swimlane" ${diagramType === 'swimlane' ? 'selected' : ''}>泳道图</option>
                <option value="mindmap" ${diagramType === 'mindmap' ? 'selected' : ''}>思维导图</option>
              </select>
            </div>
            <div>
              <label style="font-size: 13px; font-weight: 500; color: #333; display: block; margin-bottom: 5px; text-align: left;">描述</label>
              <textarea id="graphDescription" placeholder="请输入图表描述（可选）" style="width: 100%; box-sizing: border-box; padding: 8px; font-size: 13px; min-height: 60px; resize: vertical; border: 1px solid #ddd; border-radius: 4px;"></textarea>
            </div>
          </div>
        `,
        showCancelButton: true,
        confirmButtonColor: '#667eea',
        cancelButtonColor: '#666',
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        customClass: {
          popup: 'swal2-popup-wide',
          title: 'swal2-title-sm',
          confirmButton: 'swal2-btn-sm',
          cancelButton: 'swal2-btn-sm'
        },
        preConfirm: () => {
          const name = document.getElementById('graphName').value.trim();
          const diagramType = document.getElementById('graphType').value;
          const description = document.getElementById('graphDescription').value.trim();
          if (!name) {
            Swal.showValidationMessage('请输入图表名称');
            return false;
          }
          return { name, diagramType, description };
        }
      });

      const formValues = result.value;
      if (formValues) {
        try {
          const g = await fetchJson('/api/graphs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: formValues.name, diagramType: formValues.diagramType, description: formValues.description })
          });
          // 刷新关系图列表
          loadGraphs();
          // 显示成功提示
          Swal.fire({
            title: '创建成功',
            text: '图表已创建',
            icon: 'success',
            confirmButtonColor: '#667eea',
            width: '280px',
            customClass: {
              title: 'swal2-title-sm',
              content: 'swal2-content-sm',
              confirmButton: 'swal2-btn-sm'
            }
          });
        } catch (err) {
          Swal.fire({
            title: '创建失败',
            text: err.message,
            icon: 'error',
            confirmButtonColor: '#667eea',
            width: '280px',
            customClass: {
              title: 'swal2-title-sm',
              content: 'swal2-content-sm',
              confirmButton: 'swal2-btn-sm'
            }
          });
        }
      }
    }
    
    // 页面加载时检查登录状态
    document.addEventListener('DOMContentLoaded', async () => {
      await ensureLogin();
      initChartTypePanel();
      loadGraphs();
    });

    // 拖拽排序相关变量
    let draggedGraphId = null;
    let draggedElement = null;
    let originalGraphs = [];
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let currentIndicator = null;
    let insertBeforeId = null;

    function renderCards(list) {
      const grid = document.getElementById('grid');
      const empty = document.getElementById('empty');
      grid.innerHTML = '';
      originalGraphs = list;
      if (!list || list.length === 0) {
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      for (const g of list) {
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.graphId = g.id;
        card.dataset.sortOrder = g.sort_order;
        // 阻止点击菜单时触发卡片跳转
        card.addEventListener('click', (e) => {
          if (isDragging) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (!e.target.closest('.card-more') && !e.target.closest('.dropdown-menu') && !e.target.closest('.drag-handle')) {
            window.location.href = '/g/' + g.id;
          }
        });
        const first = (g.name || 'G').trim().slice(0,1).toUpperCase();
        const thumbHtml = (g.thumbnail && g.thumbnail.startsWith('data:image'))
          ? `<img src="${g.thumbnail}" style="width:100%;height:180px;object-fit:contain;display:block;background:#fff;" alt="">`
          : `<div class="thumb">${first}</div>`;
        card.innerHTML = `
          ${thumbHtml}
          <!-- 拖拽手柄 -->
          <div class="drag-handle" data-graph-id="${g.id}" title="拖拽排序">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
          </div>
          <!-- 更多按钮 -->
          <button class="card-more" data-graph-id="${g.id}" title="更多操作">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="6" r="2"/>
              <circle cx="12" cy="12" r="2"/>
              <circle cx="12" cy="18" r="2"/>
            </svg>
          </button>
          <div class="card-body">
            <div class="name">${g.name || '未命名关系图'}</div>
            <div class="meta">创建时间：${fmtTime(g.createdAt)}</div>
            ${g.description && g.description !== 'None' ? `<div class="description">${g.description}</div>` : ''}
          </div>
        `;

        // 添加拖拽事件
        const dragHandle = card.querySelector('.drag-handle');
        dragHandle.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          dragStartX = e.clientX;
          dragStartY = e.clientY;
          setTimeout(() => startDrag(g.id, card), 0);
        });

        grid.appendChild(card);
      }
    }

    function createDragIndicator() {
      const indicator = document.createElement('div');
      indicator.className = 'drag-indicator';
      return indicator;
    }

    function showInsertIndicator(card, position) {
      if (!isDragging) {
        return;
      }
  
      // 移除之前的指示器
      if (currentIndicator) {
    currentIndicator.remove();
    currentIndicator = null;
  }

  if (!card) {
    insertBeforeId = null;
    return;
  }

  // 创建新的指示器
  currentIndicator = createDragIndicator();
  card.style.position = 'relative';
  
  if (position === 'left') {
    currentIndicator.classList.add('drag-indicator-left');
    insertBeforeId = parseInt(card.dataset.graphId);
  } else {
    currentIndicator.classList.add('drag-indicator-right');
    insertBeforeId = parseInt(card.dataset.graphId) + 10000;
  }
  
  card.appendChild(currentIndicator);
  setTimeout(() => {
    if (currentIndicator) {
      currentIndicator.classList.add('show');
    }
  }, 10);
}

    function startDrag(graphId, element) {
      isDragging = true;
      draggedGraphId = graphId;
      draggedElement = element;
      element.classList.add('dragging');

      function onMouseMove(e) {
        if (!isDragging) return;
        
        element.style.position = 'fixed';
        element.style.zIndex = '10000';
        element.style.left = (e.clientX - element.offsetWidth / 2) + 'px';
        element.style.top = (e.clientY - element.offsetHeight / 2) + 'px';

        // 计算拖拽距离
        const dragDistance = Math.sqrt(
          Math.pow(e.clientX - dragStartX, 2) + 
          Math.pow(e.clientY - dragStartY, 2)
        );

        // 只有当拖拽距离超过10px时才显示插入位置
        if (dragDistance > 10) {
          const cards = document.querySelectorAll('.card:not(.dragging)');
          let targetCard = null;
          let insertPosition = 'top';

          // 找到鼠标下方的卡片
          cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
              targetCard = card;
              // 根据鼠标在卡片中的位置决定插入左边还是右边
              const cardCenterX = rect.left + rect.width / 2;
              insertPosition = e.clientX < cardCenterX ? 'left' : 'right';
            }
          });

          showInsertIndicator(targetCard, insertPosition);
        }
      }

      function onMouseUp(e) {
        if (!isDragging) return;
        
        // 阻止事件传播，防止触发点击事件
        e.preventDefault();
        e.stopPropagation();
        
        // 延迟设置 isDragging 为 false，确保点击事件处理程序能够检查到
        setTimeout(() => {
          isDragging = false;
        }, 100);
        
        // 先移除事件监听器
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('mouseleave', onMouseUp);

        // 恢复卡片样式
        element.classList.remove('dragging');
        element.style.position = '';
        element.style.zIndex = '';
        element.style.left = '';
        element.style.top = '';

        // 移除指示器
        if (currentIndicator) {
          currentIndicator.remove();
          currentIndicator = null;
        }

        // 计算拖拽距离
        const dragDistance = Math.sqrt(
          Math.pow(e.clientX - dragStartX, 2) + 
          Math.pow(e.clientY - dragStartY, 2)
        );

        // 如果拖拽距离小于10px，认为是点击，不执行排序
        if (dragDistance < 10) {
          insertBeforeId = null;
          return;
        }

        // 执行排序
        if (insertBeforeId !== null) {
          const allCards = Array.from(document.querySelectorAll('.card'));
          
          if (insertBeforeId > 1000) {
            // 插入到目标卡片后面
            const targetCardId = insertBeforeId - 10000;
            const targetCard = allCards.find(card => parseInt(card.dataset.graphId) === targetCardId);
            if (targetCard) {
              const targetIndex = allCards.findIndex(card => card === targetCard);
              reorderGraphs(draggedGraphId, targetIndex + 1);
            }
          } else {
            // 插入到目标卡片前面
            const targetCard = allCards.find(card => parseInt(card.dataset.graphId) === insertBeforeId);
            if (targetCard) {
              const targetIndex = allCards.findIndex(card => card === targetCard);
              reorderGraphs(draggedGraphId, targetIndex);
            }
          }
          
          insertBeforeId = null;
        }
      }

      // 添加事件监听器
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('mouseleave', onMouseUp); // 防止鼠标移出窗口
    }

    async function reorderGraphs(movedGraphId, newIndex) {
      // 从DOM获取当前所有卡片的顺序
      const cards = Array.from(document.querySelectorAll('.card'));
      
      // 找到移动的图在当前列表中的位置
      const oldIndex = cards.findIndex(card => parseInt(card.dataset.graphId) === movedGraphId);
      if (oldIndex === -1 || oldIndex === newIndex) return;

      // 创建新的排序数组
      const newList = [...cards];
      const [movedCard] = newList.splice(oldIndex, 1);
      newList.splice(newIndex, 0, movedCard);

      // 更新排序值
      const updatedGraphs = newList.map((card, index) => ({
        id: parseInt(card.dataset.graphId),
        sort_order: index
      }));

      try {
        await fetchJson('/api/graphs/sort-orders', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graphs: updatedGraphs })
        });

        // 刷新列表
        loadGraphs();
      } catch (err) {
        console.error('更新排序失败:', err);
        Swal.fire({
          title: '排序失败',
          text: '更新关系图排序失败，请重试',
          icon: 'error',
          confirmButtonColor: '#667eea',
          width: '280px',
          customClass: {
            title: 'swal2-title-sm',
            content: 'swal2-content-sm',
            confirmButton: 'swal2-btn-sm'
          }
        });
      }
    }

    async function loadGraphs() {
      const list = await fetchJson('/api/graphs');
      renderCards(list);
    }

    // 菜单相关逻辑
    let activeMenuId = null;
    let activeMenuButton = null;

    function closeMenu() {
      const container = document.getElementById('dropdownMenuContainer');
      container.innerHTML = '';
      activeMenuId = null;
      activeMenuButton = null;
    }

    function showMenu(graphId, button) {
      closeMenu();
      const btn = button || document.querySelector('.card-more[data-graph-id="' + graphId + '"]');
      if (btn) {
        // 创建菜单
        const container = document.getElementById('dropdownMenuContainer');
        container.innerHTML = `
          <div class="dropdown-menu show" id="menu-${graphId}">
            <div class="dropdown-item" onclick="event.stopPropagation(); handleMenuAction('rename', ${graphId})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              编辑
            </div>
            <div class="dropdown-item" onclick="event.stopPropagation(); handleMenuAction('copy', ${graphId})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              复制
            </div>
            <div class="dropdown-item dropdown-with-select" onclick="event.stopPropagation();">
              <div class="dropdown-select-wrapper">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>导出图片</span>
              </div>
              <select class="export-format-select" id="format-${graphId}" onchange="event.stopPropagation();">
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
              </select>
              <button class="export-btn" onclick="event.stopPropagation(); handleExport(${graphId})">导出</button>
            </div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-item danger" onclick="event.stopPropagation(); handleMenuAction('delete', ${graphId})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              删除
            </div>
          </div>
        `;

        // 计算菜单位置
        const menu = document.getElementById('menu-' + graphId);
        const rect = btn.getBoundingClientRect();
        menu.style.left = rect.right - 150 + 'px';
        menu.style.top = rect.bottom + 5 + 'px';
        activeMenuId = graphId;
        activeMenuButton = btn;
      }
    }

    // 点击事件处理
    document.addEventListener('click', (e) => {
      // 处理更多按钮点击
      const moreBtn = e.target.closest('.card-more');
      if (moreBtn) {
        e.stopPropagation();
        const graphId = moreBtn.dataset.graphId;
        showMenu(graphId, moreBtn);
        return;
      }

      // 处理菜单内的点击
      if (activeMenuId) {
        const menu = document.getElementById('menu-' + activeMenuId);
        // 如果点击不在菜单内，关闭菜单
        if (menu && !menu.contains(e.target)) {
          closeMenu();
        }
      }
    });

    // ESC键关闭菜单
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activeMenuId) {
        closeMenu();
      }
    });



    // 全局菜单操作处理函数
    window.handleMenuAction = function(action, graphId) {
      console.log('handleMenuAction called:', action, graphId);
      // 删除操作先不关闭菜单，等确认后再关闭
      if (action !== 'delete') {
        closeMenu();
      }

      if (action === 'delete') {
        Swal.fire({
          title: '确认删除',
          text: '确定要删除这个关系图吗？此操作不可恢复。',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonColor: '#667eea',
          cancelButtonColor: '#666',
          confirmButtonText: '确定删除',
          cancelButtonText: '取消',
          width: '300px',
          customClass: {
            title: 'swal2-title-sm',
            content: 'swal2-content-sm',
            confirmButton: 'swal2-btn-sm',
            cancelButton: 'swal2-btn-sm'
          }
        }).then((result) => {
          if (result.isConfirmed) {
            closeMenu();
            fetchJson('/api/graphs/' + graphId, { method: 'DELETE' })
              .then(() => {
                loadGraphs();
                Swal.fire({
                  title: '删除成功',
                  text: '关系图已成功删除',
                  icon: 'success',
                  confirmButtonColor: '#667eea',
                  width: '280px',
                  customClass: {
                    title: 'swal2-title-sm',
                    content: 'swal2-content-sm',
                    confirmButton: 'swal2-btn-sm'
                  }
                });
              })
              .catch(err => {
                Swal.fire({
                  title: '删除失败',
                  text: err.message,
                  icon: 'error',
                  confirmButtonColor: '#667eea',
                  width: '280px',
                  customClass: {
                    title: 'swal2-title-sm',
                    content: 'swal2-content-sm',
                    confirmButton: 'swal2-btn-sm'
                  }
                });
              });
          } else {
            closeMenu();
          }
        });
      } else if (action === 'rename') {
        Swal.fire({
          title: '编辑关系图',
          html: `
            <div style="width: 100%; max-width: 100%; overflow: hidden;">
              <div style="margin-bottom: 10px;">
                <label style="font-size: 13px; font-weight: 500; color: #333; display: block; margin-bottom: 5px; text-align: left;">图名</label>
                <input type="text" id="graphName" placeholder="请输入关系图名称" style="width: 100%; box-sizing: border-box; padding: 8px; font-size: 13px; border: 1px solid #ddd; border-radius: 4px;">
              </div>
              <div>
                <label style="font-size: 13px; font-weight: 500; color: #333; display: block; margin-bottom: 5px; text-align: left;">描述</label>
                <textarea id="graphDescription" placeholder="请输入关系图描述（可选）" style="width: 100%; box-sizing: border-box; padding: 8px; font-size: 13px; min-height: 60px; resize: vertical; border: 1px solid #ddd; border-radius: 4px;"></textarea>
              </div>
            </div>
          `,
          showCancelButton: true,
          confirmButtonColor: '#667eea',
          cancelButtonColor: '#666',
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          customClass: {
            popup: 'swal2-popup-wide',
            title: 'swal2-title-sm',
            confirmButton: 'swal2-btn-sm',
            cancelButton: 'swal2-btn-sm'
          },
          didOpen: () => {
            const card = document.querySelector(`.card[data-graph-id="${graphId}"]`);
            if (card) {
              const name = card.querySelector('.name')?.textContent;
              const description = card.querySelector('.description')?.textContent;
              document.getElementById('graphName').value = name || '';
              document.getElementById('graphDescription').value = description || '';
            }
          },
          preConfirm: () => {
            const name = document.getElementById('graphName').value.trim();
            const description = document.getElementById('graphDescription').value.trim();
            if (!name) {
              Swal.showValidationMessage('请输入关系图名称');
              return false;
            }
            return { name, description };
          }
        }).then((result) => {
          if (result.isConfirmed && result.value) {
            fetchJson('/api/graphs/' + graphId, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(result.value)
            }).then(() => {
              loadGraphs();
              Swal.fire({
                title: '编辑成功',
                text: '关系图信息已更新',
                icon: 'success',
                confirmButtonColor: '#667eea',
                width: '280px',
                customClass: {
                  title: 'swal2-title-sm',
                  content: 'swal2-content-sm',
                  confirmButton: 'swal2-btn-sm'
                }
              });
            }).catch(err => {
              Swal.fire({
                title: '编辑失败',
                text: err.message,
                icon: 'error',
                confirmButtonColor: '#667eea',
                width: '280px',
                customClass: {
                  title: 'swal2-title-sm',
                  content: 'swal2-content-sm',
                  confirmButton: 'swal2-btn-sm'
                }
              });
            });
          }
        });
      } else if (action === 'copy') {
        Swal.fire({
          title: '复制关系图',
          input: 'text',
          inputPlaceholder: '请输入复制后的名称',
          showCancelButton: true,
          confirmButtonColor: '#667eea',
          cancelButtonColor: '#666',
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          width: '300px',
          customClass: {
            title: 'swal2-title-sm',
            confirmButton: 'swal2-btn-sm',
            cancelButton: 'swal2-btn-sm'
          },
          didOpen: () => {
            const card = document.querySelector(`.card[data-graph-id="${graphId}"]`);
            if (card) {
              const name = card.querySelector('.name')?.textContent;
              Swal.getInput().value = name + ' - 副本';
            }
          }
        }).then((result) => {
          if (result.isConfirmed && result.value && result.value.trim()) {
            fetchJson('/api/graphs/' + graphId + '/duplicate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: result.value.trim() })
            }).then(() => {
              loadGraphs();
              Swal.fire({
                title: '复制成功',
                text: '关系图已复制',
                icon: 'success',
                confirmButtonColor: '#667eea',
                width: '280px',
                customClass: {
                  title: 'swal2-title-sm',
                  content: 'swal2-content-sm',
                  confirmButton: 'swal2-btn-sm'
                }
              });
            }).catch(err => {
              Swal.fire({
                title: '复制失败',
                text: err.message,
                icon: 'error',
                confirmButtonColor: '#667eea',
                width: '280px',
                customClass: {
                  title: 'swal2-title-sm',
                  content: 'swal2-content-sm',
                  confirmButton: 'swal2-btn-sm'
                }
              });
            });
          }
        });
      }
    };

    // 导出图片函数 - 静默导出，不打开新窗口
    window.handleExport = async function(graphId) {
      const format = document.getElementById('format-' + graphId)?.value || 'png';

      try {
        // 获取关系图数据
        const [nodes, edges] = await Promise.all([
          fetchJson('/api/nodes?graphId=' + graphId),
          fetchJson('/api/edges?graphId=' + graphId)
        ]);

        // 在隐藏画布上渲染并导出
        const canvas = document.getElementById('exportCanvas');
        const ctx = canvas.getContext('2d');

        // 计算画布范围
        let minX = 50, minY = 50, maxX = 800, maxY = 600;
        if (nodes.length > 0) {
          minX = Math.min(...nodes.map(n => n.x - (n.radius || 20))) - 50;
          minY = Math.min(...nodes.map(n => n.y - (n.radius || 20))) - 50;
          maxX = Math.max(...nodes.map(n => n.x + (n.radius || 20))) + 50;
          maxY = Math.max(...nodes.map(n => n.y + (n.radius || 20))) + 50;
        }
        const width = Math.max(800, maxX - minX);
        const height = Math.max(600, maxY - minY);
        canvas.width = width;
        canvas.height = height;

        // 填充背景 - PNG使用透明背景，JPG使用白色背景
        if (format === 'jpg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }

        // 缩放和平移
        ctx.translate(-minX, -minY);

        // 绘制边
        edges.forEach(edge => {
          const source = nodes.find(n => n.id === edge.sourceId);
          const target = nodes.find(n => n.id === edge.targetId);
          if (source && target) {
            ctx.beginPath();
            ctx.moveTo(source.x, source.y);
            const bendPoints = Array.isArray(edge.bendPoints) ? edge.bendPoints : [];
            bendPoints.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.lineTo(target.x, target.y);
            ctx.strokeStyle = edge.color || '#999';
            ctx.lineWidth = 2;
            ctx.stroke();

            // 绘制标签
            if (edge.label) {
              ctx.font = '12px sans-serif';
              ctx.fillStyle = edge.color || '#666';
              const midX = bendPoints.length > 0 ? bendPoints[0].x : (source.x + target.x) / 2;
              const midY = bendPoints.length > 0 ? bendPoints[0].y : (source.y + target.y) / 2;
              ctx.fillText(edge.label, midX - 20, midY - 5);
            }
          }
        });

        // 绘制节点
        nodes.forEach(node => {
          const radius = node.radius || 30;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = node.color || '#667eea';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();

          // 绘制文字
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 14px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText((node.name || '').slice(0, 4), node.x, node.y);
        });

        // 导出图片
        const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
        const dataUrl = canvas.toDataURL(mimeType, 0.9);
        const link = document.createElement('a');
        link.download = `graph-${graphId}-${Date.now()}.${format}`;
        link.href = dataUrl;
        link.click();

        closeMenu();
      } catch (err) {
        console.error('导出失败:', err);
        Swal.fire({
          title: '导出失败',
          text: err.message,
          icon: 'error',
          confirmButtonColor: '#667eea',
          width: '280px',
          customClass: {
            title: 'swal2-title-sm',
            content: 'swal2-content-sm',
            confirmButton: 'swal2-btn-sm'
          }
        });
        closeMenu();
      }
    };

    // 处理用户下拉菜单
    const userInfo = document.getElementById('userInfo');
    const userDropdown = document.getElementById('userDropdown');
    // 切换用户下拉菜单
    userInfo.addEventListener('click', (e) => {
      console.log('User info clicked!');
      e.stopPropagation();
      // 直接切换显示状态，不依赖于当前值的判断
      if (userDropdown.classList.contains('hidden')) {
        // 计算用户信息的位置，将下拉菜单定位到用户信息的下方
        const rect = userInfo.getBoundingClientRect();
        
        const topPosition = rect.bottom + window.scrollY + 8;
        const rightPosition = window.innerWidth - rect.right + window.scrollX;
        
        userDropdown.style.top = topPosition + 'px';
        userDropdown.style.right = rightPosition + 'px';
        
        // 强制设置下拉菜单的样式，确保它可见
        userDropdown.style.display = 'block';
        userDropdown.style.opacity = '1';
        userDropdown.style.visibility = 'visible';
        
        userDropdown.classList.remove('hidden');
      } else {
        userDropdown.classList.add('hidden');
        // 强制设置下拉菜单的样式，确保它被隐藏
        userDropdown.style.display = 'none';
        userDropdown.style.opacity = '0';
        userDropdown.style.visibility = 'hidden';
      }
    });

    // 点击页面其他地方关闭下拉菜单
    document.addEventListener('click', () => {
      if (!userDropdown.classList.contains('hidden')) {
        console.log('Hiding dropdown on document click');
        userDropdown.classList.add('hidden');
        // 强制设置下拉菜单的样式，确保它被隐藏
        userDropdown.style.display = 'none';
        userDropdown.style.opacity = '0';
        userDropdown.style.visibility = 'hidden';
      }
    });

    // 个人中心导航
    window.navigateToProfile = () => {
      userDropdown.classList.add('hidden');
      // 强制设置下拉菜单的样式，确保它被隐藏
      userDropdown.style.display = 'none';
      userDropdown.style.opacity = '0';
      userDropdown.style.visibility = 'hidden';
      // 这里可以添加个人中心页面的导航逻辑
      Swal.fire({
        title: '个人中心',
        text: '个人中心功能正在开发中',
        icon: 'info',
        confirmButtonColor: '#667eea',
        width: '280px',
        customClass: {
          title: 'swal2-title-sm',
          content: 'swal2-content-sm',
          confirmButton: 'swal2-btn-sm'
        }
      });
    };

    // 退出登录处理
    window.handleLogout = async () => {
      userDropdown.classList.add('hidden');
      // 强制设置下拉菜单的样式，确保它被隐藏
      userDropdown.style.display = 'none';
      userDropdown.style.opacity = '0';
      userDropdown.style.visibility = 'hidden';
      await fetchJson('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    };

    function openChangePasswordModal() {
      document.getElementById('changePasswordModal').classList.remove('hidden');
    }

    function closeChangePasswordModal() {
      document.getElementById('changePasswordModal').classList.add('hidden');
      // 清空表单
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
    }

    async function handleChangePassword() {
      const currentPassword = document.getElementById('currentPassword').value.trim();
      const newPassword = document.getElementById('newPassword').value.trim();
      const confirmPassword = document.getElementById('changeConfirmPassword').value.trim();
      
      if (!currentPassword || !newPassword || !confirmPassword) {
        Sweetalert2.fire({
          title: '修改失败',
          text: '所有密码字段不能为空',
          icon: 'error',
          confirmButtonColor: '#667eea',
          width: '320px'
        });
        return;
      }
      
      if (newPassword !== confirmPassword) {
        Sweetalert2.fire({
          title: '修改失败',
          text: '两次输入的新密码不一致',
          icon: 'error',
          confirmButtonColor: '#667eea',
          width: '320px'
        });
        return;
      }
      
      try {
        await fetchJson('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword })
        });
        
        Sweetalert2.fire({
          title: '修改成功',
          text: '密码已成功修改',
          icon: 'success',
          confirmButtonColor: '#667eea',
          width: '320px'
        }).then(() => {
          closeChangePasswordModal();
        });
      } catch (err) {
        Sweetalert2.fire({
          title: '修改失败',
          text: err.message,
          icon: 'error',
          confirmButtonColor: '#667eea',
          width: '320px'
        });
      }
    }

    // 搜索功能
    document.addEventListener('DOMContentLoaded', () => {
      const searchInput = document.getElementById('searchInput');
      const searchIcon = document.getElementById('searchIcon');
      if (!searchInput || !searchIcon) {
        return;
      }
      
      // 执行搜索
      function performSearch() {
        const searchTerm = searchInput.value.trim().toLowerCase();
        
        // 获取所有关系图卡片
        const graphCards = document.querySelectorAll('.card');
        
        graphCards.forEach(card => {
          // 获取卡片标题
          const titleElement = card.querySelector('.name');
          if (titleElement) {
            const title = titleElement.textContent.trim().toLowerCase();
            
            // 模糊匹配
            if (title.includes(searchTerm)) {
              card.style.display = 'block';
            } else {
              card.style.display = 'none';
            }
          }
        });
      }
      
      // 回车搜索
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          performSearch();
        }
      });
      
      // 点击搜索图标搜索
      searchIcon.addEventListener('click', () => {
        performSearch();
      });
    });

    ensureLogin().then(u => {
      if (u) loadGraphs();
    });
    
    // 图表类型选择面板交互
    const btnCreate = document.getElementById('btnCreate');
    const chartTypePanel = document.getElementById('chartTypePanel');
    
    // 移除现有的点击事件监听器
    const newBtnCreate = btnCreate.cloneNode(true);
    btnCreate.parentNode.replaceChild(newBtnCreate, btnCreate);
    
    // 点击新建按钮显示/隐藏面板
    newBtnCreate.addEventListener('click', (e) => {
      e.stopPropagation();
      chartTypePanel.classList.toggle('hidden');
    });
    
    // 点击图表类型项
    document.querySelectorAll('.chart-type-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const diagramType = item.dataset.type;
        chartTypePanel.classList.add('hidden');
        openCreateModal(diagramType);
      });
    });
    
    // 点击页面其他地方隐藏面板
    document.addEventListener('click', (e) => {
      if (!newBtnCreate.contains(e.target) && !chartTypePanel.contains(e.target)) {
        chartTypePanel.classList.add('hidden');
      }
    });
    
    // 打开创建图表模态框
    async function openCreateModal(diagramType) {
      // 弹出输入框让用户输入图表名称和描述
      const { value: formValues } = await Swal.fire({
        title: '新建图表',
        html: `
          <div style="width: 100%; max-width: 100%; overflow: hidden;">
            <div style="margin-bottom: 10px;">
              <label style="font-size: 13px; font-weight: 500; color: #333; display: block; margin-bottom: 5px; text-align: left;">图名</label>
              <input type="text" id="graphName" placeholder="请输入图表名称" style="width: 100%; box-sizing: border-box; padding: 8px; font-size: 13px; border: 1px solid #ddd; border-radius: 4px;">
            </div>
            <div style="margin-bottom: 10px;">
              <label style="font-size: 13px; font-weight: 500; color: #333; display: block; margin-bottom: 5px; text-align: left;">图表类型</label>
              <input type="text" id="graphType" value="${getChartTypeName(diagramType)}" disabled style="width: 100%; box-sizing: border-box; padding: 8px; font-size: 13px; border: 1px solid #ddd; border-radius: 4px; background: #f9fafb;">
              <input type="hidden" id="graphTypeValue" value="${diagramType}">
            </div>
            <div>
              <label style="font-size: 13px; font-weight: 500; color: #333; display: block; margin-bottom: 5px; text-align: left;">描述</label>
              <textarea id="graphDescription" placeholder="请输入图表描述（可选）" style="width: 100%; box-sizing: border-box; padding: 8px; font-size: 13px; min-height: 60px; resize: vertical; border: 1px solid #ddd; border-radius: 4px;"></textarea>
            </div>
          </div>
        `,
        showCancelButton: true,
        confirmButtonColor: '#667eea',
        cancelButtonColor: '#666',
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        customClass: {
          popup: 'swal2-popup-wide',
          title: 'swal2-title-sm',
          confirmButton: 'swal2-btn-sm',
          cancelButton: 'swal2-btn-sm'
        },
        preConfirm: () => {
          const name = document.getElementById('graphName').value.trim();
          const diagramType = document.getElementById('graphTypeValue').value;
          const description = document.getElementById('graphDescription').value.trim();
          if (!name) {
            Swal.showValidationMessage('请输入图表名称');
            return false;
          }
          return { name, diagramType, description };
        }
      });

      if (formValues) {
        try {
          const g = await fetchJson('/api/graphs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: formValues.name, diagramType: formValues.diagramType, description: formValues.description })
          });
          // 刷新图表列表
          loadGraphs();
          // 显示成功提示
          Swal.fire({
            title: '创建成功',
            text: '图表已创建',
            icon: 'success',
            confirmButtonColor: '#667eea',
            width: '280px',
            customClass: {
              title: 'swal2-title-sm',
              content: 'swal2-content-sm',
              confirmButton: 'swal2-btn-sm'
            }
          });
        } catch (err) {
          Swal.fire({
            title: '创建失败',
            text: err.message,
            icon: 'error',
            confirmButtonColor: '#667eea',
            width: '280px',
            customClass: {
              title: 'swal2-title-sm',
              content: 'swal2-content-sm',
              confirmButton: 'swal2-btn-sm'
            }
          });
        }
      }
    }
    
    // 获取图表类型名称
    function getChartTypeName(type) {
      const typeNames = {
        'relationship': '关系图',
        'flow': '流程图',
        'swimlane': '泳道图',
        'mindmap': '思维导图'
      };
      return typeNames[type] || type;
    }