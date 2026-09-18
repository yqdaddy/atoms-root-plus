import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
// 本地图标注册：须在应用渲染前执行，保证 Icon 组件离线可用
import '@/lib/icons';
import App from './App';
import { useAuthStore } from './stores/authStore';

// 应用启动时恢复会话（HttpOnly cookie）
useAuthStore.getState().checkAuth();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/login" element={<App />} />
        <Route path="/register" element={<App />} />
        <Route path="/workspace" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
