
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


