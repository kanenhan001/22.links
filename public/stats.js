// 图表类型映射
const chartTypeMap = {
  relationship: { name: '关系图', icon: '⚪' },
  flow: { name: '流程图', icon: '⬅' },
  mindmap: { name: '思维导图', icon: '🌳' }
};

// 模拟数据（当API不可用时使用）
const mockData = {
  users: [
    { id: 1, name: '用户1', graphs: 5 },
    { id: 2, name: '用户2', graphs: 3 },
    { id: 3, name: '用户3', graphs: 8 },
    { id: 4, name: '用户4', graphs: 2 },
    { id: 5, name: '用户5', graphs: 6 }
  ],
  graphs: [
    { id: 1, type: 'relationship', userId: 1 },
    { id: 2, type: 'flow', userId: 1 },
    { id: 3, type: 'mindmap', userId: 1 },
    { id: 4, type: 'relationship', userId: 1 },
    { id: 5, type: 'flow', userId: 1 },
    { id: 6, type: 'relationship', userId: 2 },
    { id: 7, type: 'flow', userId: 2 },
    { id: 8, type: 'mindmap', userId: 2 },
    { id: 9, type: 'relationship', userId: 3 },
    { id: 10, type: 'flow', userId: 3 },
    { id: 11, type: 'mindmap', userId: 3 },
    { id: 12, type: 'relationship', userId: 3 },
    { id: 13, type: 'flow', userId: 3 },
    { id: 14, type: 'mindmap', userId: 3 },
    { id: 15, type: 'relationship', userId: 3 },
    { id: 16, type: 'flow', userId: 3 },
    { id: 17, type: 'relationship', userId: 4 },
    { id: 18, type: 'flow', userId: 4 },
    { id: 19, type: 'relationship', userId: 5 },
    { id: 20, type: 'flow', userId: 5 },
    { id: 21, type: 'mindmap', userId: 5 },
    { id: 22, type: 'relationship', userId: 5 },
    { id: 23, type: 'flow', userId: 5 },
    { id: 24, type: 'mindmap', userId: 5 }
  ]
};

// 初始化页面
async function initStats() {
  try {
    // 显示加载状态
    document.getElementById('userStatsLoading').style.display = 'flex';
    document.getElementById('chartTypeStatsLoading').style.display = 'flex';
    document.getElementById('userStatsList').style.display = 'none';
    document.getElementById('chartTypeStats').style.display = 'none';
    document.getElementById('userStatsEmpty').style.display = 'none';
    document.getElementById('chartTypeStatsEmpty').style.display = 'none';
    
    // 尝试从API获取真实数据
    let usersData, graphsData;
    try {
      const [usersResponse, graphsResponse] = await Promise.all([
        fetch('/api/users', {
          credentials: 'include' // 包含cookie，用于身份验证
        }),
        // 获取全部图表数据，而不只是当前用户的
        fetch('/api/graphs/all', {
          credentials: 'include' // 包含cookie，用于身份验证
        })
      ]);
      
      if (usersResponse.status === 403 || graphsResponse.status === 403) {
        // 403错误表示未登录或登录会话过期，跳转到登录页面
        window.location.href = '/login';
        return;
      }
      
      if (!usersResponse.ok || !graphsResponse.ok) {
        throw new Error('API响应失败');
      }
      
      usersData = await usersResponse.json();
      graphsData = await graphsResponse.json();
    } catch (error) {
      // API请求失败，使用模拟数据
      // 使用模拟数据作为备用
      usersData = mockData.users;
      graphsData = mockData.graphs;
    }
    
    // 处理用户数据，计算每个用户的图表数量
    const users = usersData.map(user => {
      if (user.graphs !== undefined) {
        // 如果用户数据已经包含图表数量（模拟数据）
        return {
          id: user.id,
          name: user.name,
          graphs: user.graphs
        };
      } else {
        // 计算用户的图表数量（真实数据）
        // 尝试不同的字段名匹配用户ID
        let userGraphs = [];
        
        // 尝试使用userId字段匹配
        userGraphs = graphsData.filter(graph => graph.userId === user.id);
        
        // 如果没有匹配到，尝试使用user_id字段匹配
        if (userGraphs.length === 0) {
          userGraphs = graphsData.filter(graph => graph.user_id === user.id);
        }
        
        // 如果没有匹配到，尝试使用user字段匹配
        if (userGraphs.length === 0) {
          userGraphs = graphsData.filter(graph => graph.user === user.id);
        }
        
        return {
          id: user.id,
          name: user.nickname || user.username || `用户${user.id}`,
          graphs: userGraphs.length
        };
      }
    });
    
    // 使用原始图表数据
    const graphs = graphsData;
    
    // 计算总用户数
    const totalUsers = users.length;
    document.getElementById('totalUsers').textContent = totalUsers;
    
    // 计算总图表数
    const totalGraphs = graphs.length;
    document.getElementById('totalGraphs').textContent = totalGraphs;
    
    // 计算平均图表数/用户
    const avgGraphsPerUser = totalUsers > 0 ? (totalGraphs / totalUsers).toFixed(1) : 0;
    document.getElementById('avgGraphsPerUser').textContent = avgGraphsPerUser;
    
    // 显示用户分析
    displayUserStats(users);
    
    // 显示图表类型统计
    displayChartTypeStats(graphs);
    
    // 初始化用户信息
    await initUserInfo();
  } catch (error) {
    // 加载统计数据失败
    // 显示错误信息
    document.getElementById('userStatsLoading').style.display = 'none';
    document.getElementById('chartTypeStatsLoading').style.display = 'none';
    document.getElementById('userStatsEmpty').style.display = 'flex';
    document.getElementById('chartTypeStatsEmpty').style.display = 'flex';
  }
}

// 显示用户分析
function displayUserStats(users) {
  const loadingElement = document.getElementById('userStatsLoading');
  const emptyElement = document.getElementById('userStatsEmpty');
  const listElement = document.getElementById('userStatsList');
  
  loadingElement.style.display = 'none';
  
  if (users.length === 0) {
    emptyElement.style.display = 'flex';
    listElement.style.display = 'none';
  } else {
    emptyElement.style.display = 'none';
    listElement.style.display = 'block';
    
    // 清空列表
    listElement.innerHTML = '';
    
    // 按照图表数量降序排序，并只取前5名
    const topUsers = [...users]
      .sort((a, b) => b.graphs - a.graphs)
      .slice(0, 5);
    
    // 添加用户数据
    topUsers.forEach((user, index) => {
      const item = document.createElement('div');
      item.className = 'user-stats-item';
      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 24px; text-align: center; font-weight: 600; color: #667eea;">
            ${index + 1}
          </div>
          <span class="user-stats-name">${user.name}</span>
        </div>
        <span class="user-stats-count">${user.graphs} 个图表</span>
      `;
      listElement.appendChild(item);
    });
  }
}

// 显示图表类型统计
function displayChartTypeStats(graphs) {
  const loadingElement = document.getElementById('chartTypeStatsLoading');
  const emptyElement = document.getElementById('chartTypeStatsEmpty');
  const statsElement = document.getElementById('chartTypeStats');
  
  loadingElement.style.display = 'none';
  
  if (graphs.length === 0) {
    emptyElement.style.display = 'flex';
    statsElement.style.display = 'none';
  } else {
    emptyElement.style.display = 'none';
    statsElement.style.display = 'grid';
    
    // 计算各类型图表数量
    const typeCounts = {};
    graphs.forEach(graph => {
      // 尝试不同的字段名获取图表类型
      let type = 'unknown';
      
      // 尝试使用diagramType字段（驼峰命名，正确的字段名）
      if (graph.diagramType) {
        type = graph.diagramType;
      }
      // 尝试使用diagramtype字段（全小写）
      else if (graph.diagramtype) {
        type = graph.diagramtype;
      }
      // 尝试使用type字段
      else if (graph.type) {
        type = graph.type;
      }
      // 尝试使用chartType字段
      else if (graph.chartType) {
        type = graph.chartType;
      }
      // 尝试使用graphType字段
      else if (graph.graphType) {
        type = graph.graphType;
      }
      
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    
    // 清空统计区域
    statsElement.innerHTML = '';
    
    // 添加各类型统计卡片
    Object.entries(typeCounts).forEach(([type, count]) => {
      // 映射图表类型名称
      let typeName = type;
      let typeIcon = '📊';
      
      // 检查是否是已知的图表类型
      if (chartTypeMap[type]) {
        typeName = chartTypeMap[type].name;
        typeIcon = chartTypeMap[type].icon;
      }
      
      const card = document.createElement('div');
      card.className = 'chart-type-card';
      card.innerHTML = `
        <div class="chart-type-icon ${type}">
          ${typeIcon}
        </div>
        <div class="chart-type-info">
          <div class="chart-type-name">${typeName}</div>
          <div class="chart-type-count">${count}</div>
        </div>
      `;
      statsElement.appendChild(card);
    });
    
    // 添加所有类型
    Object.entries(chartTypeMap).forEach(([type, info]) => {
      if (!typeCounts[type]) {
        const card = document.createElement('div');
        card.className = 'chart-type-card';
        card.innerHTML = `
          <div class="chart-type-icon ${type}">
            ${info.icon}
          </div>
          <div class="chart-type-info">
            <div class="chart-type-name">${info.name}</div>
            <div class="chart-type-count">0</div>
          </div>
        `;
        statsElement.appendChild(card);
      }
    });
  }
}

// 初始化用户信息
async function initUserInfo() {
  const nicknameElement = document.getElementById('nickname');
  const avatarElement = document.getElementById('avatar');
  
  try {
    const response = await fetch('/api/auth/status', {
      credentials: 'include' // 包含cookie，用于身份验证
    });
    
    if (response.status === 403) {
      // 403错误表示未登录或登录会话过期，跳转到登录页面
      window.location.href = '/login';
      return;
    }
    
    if (!response.ok) {
      throw new Error('获取用户信息失败');
    }
    const data = await response.json();
    
    if (data.loggedIn && data.user) {
      if (nicknameElement) {
        nicknameElement.textContent = data.user.nickname || '用户';
      }
      if (avatarElement) {
        if (data.user.avatarUrl) {
          avatarElement.src = data.user.avatarUrl;
          avatarElement.style.background = 'transparent';
        } else {
          avatarElement.removeAttribute('src');
        }
      }
      
      // 检查是否是 admin 用户
      if (data.user.username === 'admin') {
        document.body.classList.add('admin-user');
      }
    }
  } catch (error) {
    // 获取用户信息失败
    // 从本地存储获取用户信息（备用方案）
    const userInfo = localStorage.getItem('userInfo');
    if (userInfo) {
      try {
        const user = JSON.parse(userInfo);
        if (nicknameElement) {
          nicknameElement.textContent = user.nickname || '用户';
        }
        if (avatarElement && user.avatar) {
          avatarElement.src = user.avatar;
        }
        
        // 检查是否是 admin 用户
        if (user.username === 'admin') {
          document.body.classList.add('admin-user');
        }
      } catch (error) {
        // 解析用户信息失败
      }
    }
  }
}

// 显示即将推出提示
function showComingSoon() {
  alert('该功能即将推出，敬请期待！');
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', initStats);