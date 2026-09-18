/**
 * 工作台页面。
 * 桌面端（>=768px）：三栏布局（项目侧栏 + 对话面板 + 预览面板）。
 * 移动端（<768px）：单栏布局，对话与预览通过顶部 Tab 切换，侧栏以抽屉展开。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import ProjectSidebar from '../components/ProjectSidebar';
import ChatPanel from '../components/ChatPanel';
import SandboxFrame from '../components/SandboxFrame';
import { useProjectStore } from '../stores/projectStore';
import { useChatStore } from '../stores/chatStore';
import { ENTRY_FILE_PATH } from '../types/project';

/** 移动端主视图 Tab 类型（仅 <768px 断点生效） */
type MobileView = 'chat' | 'preview';

export default function WorkspacePage() {
  const { currentProject, updateProjectName } = useProjectStore();
  const navigate = useNavigate();

  // 移动端主视图与侧栏抽屉状态
  // 挂载时若本会话刚完成一次成功生成（首页 done 分支先置 ready 再跳转，
  // status 转换发生在本组件挂载前），初始即展示预览 Tab；
  // 刷新或打开历史项目时 chatStore.stage 为 idle，保持默认对话 Tab。
  const [mobileView, setMobileView] = useState<MobileView>(() =>
    useChatStore.getState().streamBuffer.stage === 'done' &&
    useProjectStore.getState().currentProject?.status === 'ready'
      ? 'preview'
      : 'chat'
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 获取当前 HTML
  const currentHtml = currentProject?.files[ENTRY_FILE_PATH]?.content ?? '';

  // 生成完成后（generating -> ready）移动端自动切到预览 Tab
  const prevStatusRef = useRef(currentProject?.status);
  useEffect(() => {
    if (prevStatusRef.current === 'generating' && currentProject?.status === 'ready') {
      setMobileView('preview');
    }
    prevStatusRef.current = currentProject?.status;
  }, [currentProject?.status]);

  // Escape 关闭移动端侧栏抽屉
  useEffect(() => {
    if (!sidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  // 导出 HTML
  const handleExport = useCallback(() => {
    const blob = new Blob([currentHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject?.name ?? 'app'}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [currentHtml, currentProject?.name]);

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-base)]">
      {/* Top bar */}
      <header className="h-14 flex items-center justify-between gap-2 px-3 sm:px-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* 移动端：打开侧栏抽屉 */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden flex items-center justify-center w-8 h-8 shrink-0 rounded-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
            title="项目列表"
            aria-label="打开项目列表"
          >
            <Icon icon="lucide:menu" width={16} height={16} />
          </button>
          {/* 桌面端：返回首页 */}
          <button
            onClick={() => navigate('/')}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
            title="返回首页"
            aria-label="返回首页"
          >
            <Icon icon="lucide:arrow-up" width={16} height={16} className="rotate-[-90deg]" />
          </button>
          {/* 项目名称 */}
          <input
            type="text"
            value={currentProject?.name ?? '未命名项目'}
            onChange={(e) => updateProjectName(e.target.value)}
            className="min-w-0 flex-1 md:flex-none text-[14px] font-semibold text-[var(--color-text-primary)] bg-transparent border-none outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] rounded px-2 py-1 -ml-2"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExport}
            className="flex items-center justify-center w-8 h-8 rounded-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
            title="导出 HTML"
          >
            <Icon icon="lucide:download" width={16} height={16} />
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center justify-center w-8 h-8 rounded-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
            title="新建项目"
            aria-label="新建项目"
          >
            <Icon icon="lucide:plus" width={16} height={16} />
          </button>
        </div>
      </header>

      {/* 移动端：对话 / 预览 Tab 切换条 */}
      <div
        className="md:hidden flex items-center gap-1 mx-3 my-2 p-1 rounded-[10px] bg-[var(--color-bg-inset)] border border-[var(--color-border-default)]"
        role="tablist"
        aria-label="工作台视图切换"
      >
        <button
          role="tab"
          aria-selected={mobileView === 'chat'}
          onClick={() => setMobileView('chat')}
          className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-[8px] text-[13px] font-medium transition-all duration-[140ms] ${
            mobileView === 'chat'
              ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)]'
          }`}
        >
          <Icon icon="lucide:message-square" width={14} height={14} />
          <span>对话</span>
        </button>
        <button
          role="tab"
          aria-selected={mobileView === 'preview'}
          onClick={() => setMobileView('preview')}
          className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-[8px] text-[13px] font-medium transition-all duration-[140ms] ${
            mobileView === 'preview'
              ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)]'
          }`}
        >
          <Icon icon="lucide:monitor" width={14} height={14} />
          <span>预览</span>
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* 桌面端：常驻侧栏 */}
        <div className="hidden md:flex md:flex-col">
          <ProjectSidebar />
        </div>

        {/* 移动端：侧栏抽屉 */}
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 z-40">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            <div className="absolute inset-y-0 left-0 flex flex-col bg-[var(--color-bg-surface)] border-r border-[var(--color-border-default)] shadow-xl">
              <ProjectSidebar onClose={() => setSidebarOpen(false)} />
            </div>
          </div>
        )}

        {/* Chat panel */}
        <div
          className={`${mobileView === 'chat' ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-w-0 md:flex-none md:w-[400px] md:min-w-[360px] md:max-w-[480px] border-r border-[var(--color-border-default)] bg-[var(--color-bg-surface)]`}
        >
          {/* Chat header */}
          <div className="h-12 hidden md:flex items-center px-4 border-b border-[var(--color-border-default)]">
            <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">对话</span>
          </div>

          <ChatPanel />
        </div>

        {/* Preview panel */}
        <div
          className={`${mobileView === 'preview' ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-w-0 md:min-w-[480px] bg-[var(--color-bg-surface)]`}
        >
          {currentHtml && currentHtml.includes('<!DOCTYPE html>') ? (
            <SandboxFrame html={currentHtml} />
          ) : (
            <div className="flex-1 flex flex-col">
              {/* Preview toolbar */}
              <div className="h-12 flex items-center justify-between px-3 sm:px-4 border-b border-[var(--color-border-default)]">
                <div className="hidden sm:flex items-center gap-1">
                  <button
                    className="flex items-center justify-center w-8 h-8 rounded-[10px] text-[var(--color-accent)] bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
                    title="桌面"
                  >
                    <Icon icon="lucide:monitor" width={16} height={16} />
                  </button>
                  <button
                    className="flex items-center justify-center w-8 h-8 rounded-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
                    title="平板"
                  >
                    <Icon icon="lucide:tablet" width={16} height={16} />
                  </button>
                  <button
                    className="flex items-center justify-center w-8 h-8 rounded-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
                    title="手机"
                  >
                    <Icon icon="lucide:smartphone" width={16} height={16} />
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="flex items-center justify-center w-8 h-8 rounded-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
                    title="刷新预览"
                  >
                    <Icon icon="lucide:refresh-cw" width={16} height={16} />
                  </button>
                  <button
                    className="flex items-center justify-center w-8 h-8 rounded-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
                    title="全屏"
                  >
                    <Icon icon="lucide:maximize-2" width={16} height={16} />
                  </button>
                </div>
              </div>

              {/* Empty state */}
              <div className="flex-1 flex items-center justify-center p-4">
                <div className="flex flex-col items-center text-center">
                  <Icon icon="lucide:layout-template" width={24} height={24} className="text-[var(--color-text-tertiary)]" />
                  <h3 className="mt-4 text-[20px] font-semibold text-[var(--color-text-primary)]">
                    还没有可以预览的应用
                  </h3>
                  <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
                    在对话面板描述你的第一个想法，生成完成后这里会实时展示。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
