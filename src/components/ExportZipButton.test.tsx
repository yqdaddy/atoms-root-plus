/**
 * ExportZipButton 与 useZipExport 冒烟测试（P1 批次 3）
 * @vitest-environment jsdom
 *
 * 覆盖：
 * 1. 按钮视图：默认态 / 生成中禁用态 / 导出中加载态的禁用与文案
 * 2. useZipExport 流程：点击触发服务、成功与失败经 toast 反馈、
 *    导出进行中防重复触发、结束后状态复位
 *
 * 说明：导出服务与 toast 打桩，按钮视图与导出流程分开验证。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act, cleanup } from '@testing-library/react';
import ExportZipButton, { useZipExport } from './ExportZipButton';
import { exportProjectAsZip } from '../services/export/zipExporter';
import { toast } from './Toast';
import type { Project } from '../types/project';

vi.mock('../services/export/zipExporter', () => ({
  exportProjectAsZip: vi.fn(),
}));

vi.mock('./Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

function buildProject(): Project {
  return {
    id: 'proj-1',
    name: '计数器',
    description: '',
    status: 'ready',
    framework: 'html',
    files: {
      '/index.html': {
        path: '/index.html',
        content: '<!DOCTYPE html><html><body>ok</body></html>',
        language: 'html',
        updatedAt: '2026-09-24T00:00:00.000Z',
      },
    },
    chat: [],
    preview: { extraSandboxFlags: [], sizeMode: 'autoHeight' },
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.mocked(exportProjectAsZip).mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
});

afterEach(cleanup);

describe('ExportZipButton 视图', () => {
  it('默认态：可点击，文案为导出', () => {
    render(<ExportZipButton isExporting={false} onExport={() => {}} />);
    const button = screen.getByRole('button', { name: '导出代码为 ZIP' });
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('生成中禁用：disabled 生效且文案切换', () => {
    render(<ExportZipButton isExporting={false} disabled onExport={() => {}} />);
    const button = screen.getByRole('button', { name: '生成中，暂不能导出' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('导出中：禁用并切换为打包中文案', () => {
    render(<ExportZipButton isExporting onExport={() => {}} />);
    const button = screen.getByRole('button', { name: '正在打包下载' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('点击触发 onExport 回调', () => {
    const onExport = vi.fn();
    render(<ExportZipButton isExporting={false} onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: '导出代码为 ZIP' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});

describe('useZipExport 流程', () => {
  it('导出成功：调用服务、成功提示、状态复位', async () => {
    let resolveExport!: () => void;
    vi.mocked(exportProjectAsZip).mockImplementation(
      () => new Promise<void>((resolve) => { resolveExport = resolve; })
    );

    const project = buildProject();
    const { result } = renderHook(() => useZipExport(project));

    await act(async () => {
      void result.current.exportNow();
    });
    expect(result.current.isExporting).toBe(true);

    await act(async () => {
      resolveExport();
    });
    expect(exportProjectAsZip).toHaveBeenCalledWith(project);
    expect(toast.success).toHaveBeenCalledWith('ZIP 包已开始下载');
    expect(result.current.isExporting).toBe(false);
  });

  it('导出失败：错误提示携带服务端错误信息，状态复位', async () => {
    vi.mocked(exportProjectAsZip).mockRejectedValueOnce(new Error('项目暂无可导出的文件'));

    const { result } = renderHook(() => useZipExport(buildProject()));
    await act(async () => {
      await result.current.exportNow();
    });

    expect(toast.error).toHaveBeenCalledWith('项目暂无可导出的文件');
    expect(result.current.isExporting).toBe(false);
  });

  it('无项目：仅提示错误，不调用服务', async () => {
    const { result } = renderHook(() => useZipExport(null));
    await act(async () => {
      await result.current.exportNow();
    });

    expect(exportProjectAsZip).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('没有可导出的项目');
  });

  it('导出进行中重复触发：第二次不生效', async () => {
    let resolveExport!: () => void;
    vi.mocked(exportProjectAsZip).mockImplementation(
      () => new Promise<void>((resolve) => { resolveExport = resolve; })
    );

    const { result } = renderHook(() => useZipExport(buildProject()));
    await act(async () => {
      void result.current.exportNow();
      void result.current.exportNow(); // 进行中的第二次触发应被忽略
    });
    expect(exportProjectAsZip).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveExport();
    });
    expect(exportProjectAsZip).toHaveBeenCalledTimes(1);
  });
});
