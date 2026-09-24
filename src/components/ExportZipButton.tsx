/**
 * ZIP 导出按钮（预览工具栏）与导出 hook。
 *
 * 职责分离：
 * - useZipExport：导出流程（动态加载导出服务、防重复点击、错误提示），
 *   按钮点击与 Ctrl+E 快捷键共用同一实例，状态（加载态）全局一致
 * - ExportZipButton：纯展示，禁用态由外部（生成进行中）与内部（导出进行中）共同决定
 *
 * 样式与相邻工具栏图标按钮一致（atom 绿强调色体系、lucide 图标、
 * 加载态复用 loader-circle 旋转的唯一动机动画）。
 */
import { useState, useCallback } from 'react';
import { Icon } from '@iconify/react';
import type { Project } from '../types/project';
import { toast } from './Toast';

export interface ZipExportState {
  /** 导出流程进行中（含 dist 物化），用于按钮加载态与防重复触发 */
  isExporting: boolean;
  /** 触发一次导出；结果经 toast 反馈 */
  exportNow: () => Promise<void>;
}

/**
 * ZIP 导出流程 hook。
 * @param project 当前项目；为 null 时触发导出仅提示错误
 */
export function useZipExport(project: Project | null): ZipExportState {
  const [isExporting, setIsExporting] = useState(false);

  const exportNow = useCallback(async () => {
    if (!project) {
      toast.error('没有可导出的项目');
      return;
    }
    if (isExporting) return;
    setIsExporting(true);
    try {
      // 动态导入：仅在导出时加载 jszip（约 95KB）
      const { exportProjectAsZip } = await import('../services/export/zipExporter');
      await exportProjectAsZip(project);
      toast.success('ZIP 包已开始下载');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '导出失败，请稍后重试';
      toast.error(msg);
    } finally {
      setIsExporting(false);
    }
  }, [project, isExporting]);

  return { isExporting, exportNow };
}

interface ExportZipButtonProps {
  /** 导出流程状态（来自 useZipExport，与快捷键共享同一实例） */
  isExporting: boolean;
  /** 外部禁用（生成进行中）；导出进行中组件自身也会禁用 */
  disabled?: boolean;
  /** 点击回调（调用方接 useZipExport().exportNow） */
  onExport: () => void;
}

/** 预览工具栏的 ZIP 导出图标按钮 */
export default function ExportZipButton({
  isExporting,
  disabled = false,
  onExport,
}: ExportZipButtonProps) {
  const isDisabled = disabled || isExporting;
  const label = isExporting
    ? '正在打包下载'
    : disabled
      ? '生成中，暂不能导出'
      : '导出代码为 ZIP';

  return (
    <button
      onClick={onExport}
      disabled={isDisabled}
      className="p-1.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] disabled:opacity-50 transition-colors"
      title={label}
      aria-label={label}
    >
      <Icon
        icon={isExporting ? 'lucide:loader-circle' : 'lucide:download'}
        width={16}
        height={16}
        className={isExporting ? 'animate-spin' : ''}
      />
    </button>
  );
}
