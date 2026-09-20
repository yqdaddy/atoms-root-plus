import HomePage from './pages/HomePage';
import AuthPage from './pages/AuthPage';
import ProjectsPage from './pages/ProjectsPage';
import LandingPage from './components/landing/LandingPage';
import { ToastProvider } from './components/Toast';
import { useLocation, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';

function App() {
  const location = useLocation();
  const path = location.pathname;
  const { user, isLoading } = useAuthStore();

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

  if (path === '/login' || path === '/register') {
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

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      {page}
      <ToastProvider />
    </div>
  );
}

export default App;