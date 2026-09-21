/**
 * 项目空间页面：展示所有历史项目。
 * 类似秒哒的项目管理界面，支持查看、打开、删除项目。
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { useProjectStore } from '../stores/projectStore';
import { useAuthStore } from '../stores/authStore'; // F-002: 项目列表页守卫
import type { ProjectSummary } from '../types/project';

/** 格式化时间 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;

  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });
}

/** 状态标签 */
function StatusBadge({ status }: { status: ProjectSummary['status'] }) {
  const config = {
    draft: { label: '草稿', color: 'text-[var(--color-text-tertiary)] bg-[var(--color-bg-base)]' },
    generating: { label: '生成中', color: 'text-amber-500 bg-amber-500/10' },
    ready: { label: '已完成', color: 'text-green-500 bg-green-500/10' },
    error: { label: '出错', color: 'text-red-500 bg-red-500/10' },
  };
  const c = config[status] || config.draft;
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full ${c.color}`}>
      {c.label}
    </span>
  );
}

/** 项目卡片 */
function ProjectCard({
  summary,
  onOpen,
  onDelete,
  onRename,
}: {
  summary: ProjectSummary;
  onOpen: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div
      className="group relative bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-xl hover:border-[var(--color-border-strong)] transition-all cursor-pointer"
      onClick={onOpen}
    >
      {/* 预览缩略图 */}
      <div className="aspect-[4/3] bg-[var(--color-bg-base)] flex items-center justify-center">
        <Icon icon="lucide:file-code-2" width={32} height={32} className="text-[var(--color-text-tertiary)]" />
      </div>

      {/* 信息区 */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[14px] font-medium text-[var(--color-text-primary)] truncate flex-1">
            {summary.name || '未命名项目'}
          </h3>
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="p-1 rounded hover:bg-[var(--color-bg-base)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <Icon icon="lucide:more-horizontal" width={16} height={16} />
            </button>
            {showMenu && (
              <div
                className="absolute right-0 top-full mt-1 bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-lg shadow-lg py-1 min-w-[100px] z-10"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen();
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-base)] hover:text-[var(--color-text-primary)]"
                >
                  <Icon icon="lucide:external-link" width={14} height={14} />
                  打开
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename();
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-base)] hover:text-[var(--color-text-primary)]"
                >
                  <Icon icon="lucide:pencil" width={14} height={14} />
                  重命名
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-red-500 hover:bg-red-500/10"
                >
                  <Icon icon="lucide:trash-2" width={14} height={14} />
                  删除
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={summary.status} />
          <span className="text-[12px] text-[var(--color-text-tertiary)]">
            {formatTime(summary.updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuthStore(); // F-002: 获取登录状态
  const summaries = useProjectStore((state) => state.summaries);
  const switchProject = useProjectStore((state) => state.switchProject);
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const updateProjectName = useProjectStore((state) => state.updateProjectName);
  const newProject = useProjectStore((state) => state.newProject);
  const initialize = useProjectStore((state) => state.initialize);

  const [isLoading, setIsLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // F-002: 项目列表页守卫 - 未登录时跳转到登录页
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login?redirect=%2Fprojects', { replace: true });
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    initialize().finally(() => setIsLoading(false));
  }, [initialize]);

  // F-002: 认证加载中或未登录时显示加载状态
  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] flex items-center justify-center">
        <Icon icon="lucide:loader-2" width={24} height={24} className="animate-spin text-[var(--color-text-tertiary)]" />
      </div>
    );
  }

  const handleOpenProject = (id: string) => {
    switchProject(id);
    navigate('/workspace');
  };

  const handleDeleteProject = (id: string, name: string) => {
    if (confirm(`确定删除项目「${name}」吗？此操作不可恢复。`)) {
      deleteProject(id);
    }
  };

  const handleRenameProject = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName || '未命名项目');
  };

  const handleRenameSubmit = (id: string) => {
    // 先切换到该项目，然后更新名称
    switchProject(id);
    const trimmedName = renameValue.trim();
    if (trimmedName) {
      updateProjectName(trimmedName);
    }
    setRenamingId(null);
  };

  const handleRenameCancel = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const handleNewProject = () => {
    // 清空工作台状态：工作台回到干净欢迎界面，提交首个需求时才创建新项目记录
    newProject();
    navigate('/workspace');
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      {/* Header */}
      <header className="sticky top-0 z-10 h-14 flex items-center justify-between px-6 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/workspace')}
            className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <Icon icon="lucide:arrow-left" width={18} height={18} />
          </button>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">我的项目</h1>
          <span className="text-[13px] text-[var(--color-text-tertiary)]">
            {summaries.length} 个项目
          </span>
        </div>
        <button
          onClick={handleNewProject}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-[14px] font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <Icon icon="lucide:plus" width={16} height={16} />
          新建项目
        </button>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Icon icon="lucide:loader-2" width={24} height={24} className="animate-spin text-[var(--color-text-tertiary)]" />
          </div>
        ) : summaries.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-full bg-[var(--color-bg-surface)] flex items-center justify-center mx-auto mb-4">
              <Icon icon="lucide:folder-open" width={28} height={28} className="text-[var(--color-text-tertiary)]" />
            </div>
            <h2 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">暂无项目</h2>
            <p className="text-[14px] text-[var(--color-text-secondary)] mb-6">
              描述你想做的应用，AI 会帮你生成代码
            </p>
            <button
              onClick={handleNewProject}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[var(--color-accent)] text-white text-[14px] font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              <Icon icon="lucide:plus" width={16} height={16} />
              创建第一个项目
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {summaries.map((summary) => (
              <ProjectCard
                key={summary.id}
                summary={summary}
                onOpen={() => handleOpenProject(summary.id)}
                onDelete={() => handleDeleteProject(summary.id, summary.name)}
                onRename={() => handleRenameProject(summary.id, summary.name)}
              />
            ))}
          </div>
        )}
      </main>

      {/* 重命名对话框 */}
      {renamingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className="bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-xl p-6 w-full max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">重命名项目</h2>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameSubmit(renamingId);
                } else if (e.key === 'Escape') {
                  handleRenameCancel();
                }
              }}
              className="w-full px-4 py-3 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] outline-none transition-colors"
              placeholder="输入项目名称"
              autoFocus
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={handleRenameCancel}
                className="px-4 py-2 rounded-lg text-[14px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-base)] transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleRenameSubmit(renamingId)}
                className="px-4 py-2 rounded-lg text-[14px] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}