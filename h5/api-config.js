/**
 * API 配置中心
 * 统一管理所有前端API地址，适配TCB/本地/生产环境
 */
(function() {
  // 自动判断环境
  function getApiBase() {
    // 1. 优先读 localStorage（用户手动配置）
    var stored = localStorage.getItem('jasmine_api');
    if (stored) return stored.replace(/\/$/, '');
    
    // 2. 读环境变量
    if (window.API_BASE) return window.API_BASE.replace(/\/$/, '');
    
    // 3. TCB 环境（自动检测）
    if (location.hostname.includes('tcbapp.net') || 
        location.hostname.includes('cloudbaseapp.cn') ||
        location.hostname.includes('tcloudbaseapp.com')) {
      // 云函数默认路径
      return '';
    }
    
    // 4. 开发环境（localhost）
    return 'http://localhost:3001';
  }
  
  window.JASMINE_API = getApiBase();
  
  // 兼容旧代码
  window.API_BASE = window.JASMINE_API;
})();
