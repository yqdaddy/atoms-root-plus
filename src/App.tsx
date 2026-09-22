import { lazy, Suspense } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import PermissionDialog from './components/PermissionDialog';
import { usePermissionStore } from './stores/permissionStore';
import { useState, useEffect } from 'react';
import { ToastProvider } from './components/Toast';
import { VersionFooter } from './components/VersionFooter';

// 路由级懒加载：只有访问时才加载对应页面的代码
const HomePage = lazy(() => import('./pages/HomePage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const LandingPage = lazy(() => import('./components/landing/LandingPage'));
const SharePage = lazy(() => import('./pages/SharePage'));

/** 全屏加载占位符 */
function PageLoader() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />
        <span className="text-sm text-[var(--color-text-secondary)]">加载中...</span>
      </div>
    </div>
  );
}

function App() {
  const location = useLocation();
  const path = location.pathname;
  const { user, isLoading } = useAuthStore();
  const pendingRequest = usePermissionStore((s) => s.pendingRequest);
  const dismissRequest = usePermissionStore((s) => s.dismissRequest);
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);

  // 监听权限请求，自动显示弹窗
  useEffect(() => {
    setShowPermissionDialog(!!pendingRequest);
  }, [pendingRequest]);

  // 加载中显示空白页面（避免闪烁）
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
        <ToastProvider />
      </div>
    );
  }

  let page: React.ReactNode;

  // 路由守卫：需要登录的路由
  const protectedRoutes = ['/workspace', '/projects'];
  if (protectedRoutes.includes(path) && !user) {
    // 未登录访问受保护路由，跳转到登录页
    return <Navigate to={`/login?redirect=${encodeURIComponent(path)}`} replace />;
  }

  // 分享预览路由（无需登录）
  if (path.startsWith('/share/')) {
    page = <SharePage />;
  } else if (path === '/login' || path === '/register') {
    page = <AuthPage mode={path === '/register' ? 'register' : 'login'} />;
  } else if (path === '/workspace') {
    // 工作台独立路由（HomePage），需登录
    page = <HomePage />;
  } else if (path === '/projects') {
    page = <ProjectsPage />;
  } else {
    // 首页（落地页）任何时候都可直接访问，不区分登录态
    page = <LandingPage />;
  }

  const handlePermissionDialogClose = () => {
    setShowPermissionDialog(false);
    dismissRequest();
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      {/* 懒加载包裹：页面加载时显示占位符 */}
      <Suspense fallback={<PageLoader />}>
        {page}
      </Suspense>
      <ToastProvider />
      {/* 权限确认弹窗：全局挂载，监听 pendingRequest 自动显示 */}
      <PermissionDialog
        open={showPermissionDialog}
        onClose={handlePermissionDialogClose}
      />
      {/* 版本标识：右下角显示 Git SHA */}
      <VersionFooter />
    </div>
  );
}

export default App;