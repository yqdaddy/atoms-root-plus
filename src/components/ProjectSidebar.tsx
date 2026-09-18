/**
 * 项目侧栏组件。
 * 显示项目历史列表，支持切换、新建、导出、导入和清除数据。
 * 桌面端常驻显示；移动端（<768px）由父级以抽屉容器承载，传入 onClose 时
 * 在头部渲染收起按钮。
 */
import { useCallback, useState, useRef } from 'react';
import { Icon } from '@iconify/react';
import { useProjectStore } from '../stores/projectStore';
import { exportAllProjects, downloadExport, importProjects, validateExportFile } from '../services/storage';
import Modal from './Modal';
import { toast } from './Toast';
import SettingsPanel from './SettingsPanel';
import DataImportPanel from './DataImportPanel';
import { SidebarAuthControls } from './AuthControls';
import type { ParsedData } from '../services/data';

interface ProjectSidebarProps {
  /** 抽屉模式下的收起回调（移动端传入，桌面端省略） */
  onClose?: () => void;
}

export default function ProjectSidebar({ onClose }: ProjectSidebarProps) {
  const { summaries, currentId, createProject, switchProject, deleteProject } = useProjectStore();

  // 弹窗状态
  const [showSettings, setShowSettings] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [showDataImport, setShowDataImport] = useState(false);

  // 导入预览数据
  const [importPreview, setImportPreview] = useState<{
    projectCount: number;
    fileContent: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 新建项目
  const handleNewProject = useCallback(() => {
    createProject();
  }, [createProject]);

  // 切换项目
  const handleSwitchProject = useCallback(
    (id: string) => {
      switchProject(id);
    },
    [switchProject]
  );

  // 删除项目
  const handleDeleteProject = useCallback(
    (id: string) => {
      if (window.confirm('确定删除此项目？此操作不可撤销。')) {
        deleteProject(id);
      }
    },
    [deleteProject]
  );

  // 导出项目
  const handleExport = useCallback(() => {
    if (summaries.length === 0) {
      toast.info('没有可导出的项目');
      return;
    }

    try {
      const json = exportAllProjects();
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadExport(json, `atoms-projects-${timestamp}.json`);
      toast.success(`已导出 ${summaries.length} 个项目`);
    } catch (error) {
      toast.error('导出失败，请重试');
    }
  }, [summaries.length]);

  // 导入文件选择
  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // 处理文件上传
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) {
        toast.error('文件读取失败');
        return;
      }

      const validation = validateExportFile(content);

      if (!validation.valid) {
        toast.error(`文件格式错误: ${validation.errors[0]}`);
        return;
      }

      // 显示预览
      setImportPreview({
        projectCount: validation.projectCount,
        fileContent: content,
      });
      setShowImportConfirm(true);
    };

    reader.onerror = () => {
      toast.error('文件读取失败');
    };

    reader.readAsText(file);

    // 清空 input，允许重复选择同一文件
    e.target.value = '';
  }, []);

  // 确认导入
  const handleConfirmImport = useCallback(() => {
    if (!importPreview) return;

    const result = importProjects(importPreview.fileContent, {
      merge: true,
      skipDuplicates: true,
    });

    if (result.success) {
      toast.success(`已导入 ${result.imported} 个项目${result.skipped > 0 ? `，跳过 ${result.skipped} 个重复项` : ''}`);
      // 刷新项目列表
      window.location.reload();
    } else {
      toast.error(`导入失败: ${result.errors[0] ?? '未知错误'}`);
    }

    setShowImportConfirm(false);
    setImportPreview(null);
  }, [importPreview]);

  // 清除所有数据
  const handleClearAll = useCallback(() => {
    try {
      // 清除所有项目
      for (const summary of summaries) {
        deleteProject(summary.id);
      }
      toast.success('已清除所有项目');
      setShowClearConfirm(false);
    } catch (error) {
      toast.error('清除失败，请重试');
    }
  }, [summaries, deleteProject]);

  // 处理数据导入（结果 toast 由 DataImportPanel 统一发出，此处不重复提示）
  const handleDataImport = useCallback((data: ParsedData) => {
    // TODO: 将导入的数据传递给当前项目或图表
    console.log('Imported data:', data);
  }, []);

  // 格式化时间
  const formatTime = (iso: string) => {
    const date = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return '今天';
    } else if (days === 1) {
      return '昨天';
    } else if (days < 7) {
      return `${days} 天前`;
    } else {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
  };

  return (
    <>
      <aside className="w-[260px] min-w-[200px] max-w-[320px] border-r border-[var(--color-border-default)] bg-[var(--color-bg-surface)] flex flex-col">
        {/* 新建按钮（抽屉模式额外提供收起按钮） */}
        <div className="p-3 border-b border-[var(--color-border-default)] flex items-center gap-2">
          <button
            onClick={handleNewProject}
            className="flex-1 flex items-center gap-2 min-w-0 px-3 py-2 rounded-[10px] text-[14px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
          >
            <Icon icon="lucide:plus" width={16} height={16} />
            <span>新建项目</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center justify-center w-8 h-8 shrink-0 rounded-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
              title="收起"
              aria-label="收起项目列表"
            >
              <Icon icon="lucide:x" width={16} height={16} />
            </button>
          )}
        </div>

        {/* 项目列表 */}
        <div className="flex-1 overflow-y-auto p-2">
          {summaries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Icon icon="lucide:folder" width={20} height={20} className="text-[var(--color-text-tertiary)]" />
              <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">还没有项目。</p>
              <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">从一句话开始你的第一个应用。</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {summaries.map((project) => (
                <li key={project.id} className="group relative">
                  <button
                    onClick={() => handleSwitchProject(project.id)}
                    className={`w-full flex items-start justify-between p-2 pr-8 rounded-[10px] text-left transition-all duration-[140ms] ${
                      currentId === project.id
                        ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium truncate">{project.name}</div>
                      <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
                        {formatTime(project.updatedAt)}
                        {' · '}
                        {(project.entryBytes / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(project.id);
                    }}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-all duration-[140ms]"
                    title="删除项目"
                  >
                    <Icon icon="lucide:trash-2" width={14} height={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 底部工具栏 */}
        <div className="p-3 border-t border-[var(--color-border-default)] space-y-1">
          <button
            onClick={handleExport}
            disabled={summaries.length === 0}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-[10px] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon icon="lucide:download" width={15} height={15} />
            <span>导出项目</span>
          </button>

          <button
            onClick={handleImportClick}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-[10px] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
          >
            <Icon icon="lucide:upload" width={15} height={15} />
            <span>导入项目</span>
          </button>

          <button
            onClick={() => setShowDataImport(true)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-[10px] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
          >
            <Icon icon="lucide:folder" width={15} height={15} />
            <span>导入数据</span>
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-[10px] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
          >
            <Icon icon="lucide:settings" width={15} height={15} />
            <span>设置</span>
          </button>

          <button
            onClick={() => setShowClearConfirm(true)}
            disabled={summaries.length === 0}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-[10px] text-[13px] text-[#ef4444] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon icon="lucide:trash-2" width={15} height={15} />
            <span>清除所有数据</span>
          </button>

          {/* 分隔线 + 认证区 */}
          <div className="h-px bg-[var(--color-border-default)] my-2" />
          <SidebarAuthControls />
        </div>

        {/* 隐藏的文件输入 */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </aside>

      {/* 设置面板 */}
      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />

      {/* 清除确认弹窗 */}
      <Modal
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        title="确认清除"
        maxWidth="400px"
      >
        <div className="space-y-3">
          <p className="text-[14px] text-[var(--color-text-primary)] leading-[1.5]">
            确定要清除所有项目数据吗？
          </p>
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-[1.5]">
            此操作将删除 {summaries.length} 个项目，且不可撤销。建议先导出备份。
          </p>
        </div>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={() => setShowClearConfirm(false)}
            className="px-4 py-2 rounded-[10px] text-[14px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[80ms]"
          >
            取消
          </button>
          <button
            onClick={handleClearAll}
            className="px-4 py-2 rounded-[10px] text-[14px] text-white bg-[#ef4444] hover:bg-[#dc2626] active:scale-[0.98] transition-all duration-[80ms]"
          >
            确认清除
          </button>
        </div>
      </Modal>

      {/* 导入确认弹窗 */}
      <Modal
        open={showImportConfirm}
        onClose={() => {
          setShowImportConfirm(false);
          setImportPreview(null);
        }}
        title="导入项目"
        maxWidth="400px"
      >
        {importPreview && (
          <div className="space-y-3">
            <p className="text-[14px] text-[var(--color-text-primary)] leading-[1.5]">
              检测到 {importPreview.projectCount} 个项目。
            </p>
            <p className="text-[13px] text-[var(--color-text-secondary)] leading-[1.5]">
              将与现有项目合并，重复项目会被跳过。
            </p>
          </div>
        )}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={() => {
              setShowImportConfirm(false);
              setImportPreview(null);
            }}
            className="px-4 py-2 rounded-[10px] text-[14px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[80ms]"
          >
            取消
          </button>
          <button
            onClick={handleConfirmImport}
            className="px-5 py-2 rounded-[10px] text-[14px] text-[var(--color-text-on-accent)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] active:scale-[0.98] transition-all duration-[80ms]"
          >
            确认导入
          </button>
        </div>
      </Modal>

      {/* 数据导入面板 */}
      <DataImportPanel
        open={showDataImport}
        onClose={() => setShowDataImport(false)}
        onImport={handleDataImport}
      />
    </>
  );
}