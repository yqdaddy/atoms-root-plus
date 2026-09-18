import HomePage from './pages/HomePage';
import WorkspacePage from './pages/WorkspacePage';
import AuthPage from './pages/AuthPage';
import { ToastProvider } from './components/Toast';
import { useLocation } from 'react-router-dom';

function App() {
  const location = useLocation();
  const path = location.pathname;

  let page: React.ReactNode;
  if (path === '/login' || path === '/register') {
    page = <AuthPage mode={path === '/register' ? 'register' : 'login'} />;
  } else if (path === '/workspace') {
    page = <WorkspacePage />;
  } else {
    page = <HomePage />;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      {page}
      <ToastProvider />
    </div>
  );
}

export default App;