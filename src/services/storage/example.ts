/**
 * 导出/导入功能使用示例。
 *
 * 这个文件展示如何在 React 组件中使用导出/导入功能。
 * 实际集成时，可以将这些函数绑定到 UI 按钮。
 */

import { exportAllProjects, downloadExport, importProjects, validateExportFile } from './index';
import type { ImportOptions } from './types';

/**
 * 导出所有项目并触发下载。
 * 绑定到"导出项目"按钮。
 */
export function handleExportAll(): void {
  try {
    const json = exportAllProjects();
    const filename = `atoms-projects-${new Date().toISOString().split('T')[0]}.json`;
    downloadExport(json, filename);
    console.log('导出成功');
  } catch (err) {
    console.error('导出失败:', err);
  }
}

/**
 * 导入项目文件。
 * 绑定到文件选择器的 onChange 事件。
 *
 * @param file 用户选择的 JSON 文件
 * @param options 导入选项
 */
export async function handleImport(
  file: File,
  options: ImportOptions = { merge: true, skipDuplicates: true }
): Promise<{ success: boolean; message: string }> {
  try {
    // 1. 读取文件内容
    const json = await file.text();

    // 2. 预检验证
    const validation = validateExportFile(json);
    if (!validation.valid) {
      return {
        success: false,
        message: `文件验证失败: ${validation.errors.join(', ')}`,
      };
    }

    // 3. 导入项目
    const result = importProjects(json, options);

    if (result.success) {
      return {
        success: true,
        message: `成功导入 ${result.imported} 个项目，跳过 ${result.skipped} 个`,
      };
    } else {
      return {
        success: false,
        message: `导入失败: ${result.errors.join(', ')}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      message: `导入失败: ${err}`,
    };
  }
}

/**
 * 示例：React 组件中使用导出按钮。
 *
 * ```tsx
 * import { handleExportAll } from './services/storage/example';
 *
 * function ExportButton() {
 *   return (
 *     <button onClick={handleExportAll}>
 *       导出所有项目
 *     </button>
 *   );
 * }
 * ```
 */

/**
 * 示例：React 组件中使用文件上传。
 *
 * ```tsx
 * import { handleImport } from './services/storage/example';
 *
 * function ImportButton() {
 *   const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
 *     const file = e.target.files?.[0];
 *     if (!file) return;
 *
 *     const result = await handleImport(file, { merge: true, skipDuplicates: true });
 *     alert(result.message);
 *
 *     // 刷新项目列表
 *     // useProjectStore.getState().initialize();
 *   };
 *
 *   return (
 *     <input type="file" accept=".json" onChange={handleFileChange} />
 *   );
 * }
 * ```
 */

/**
 * 示例：拖拽上传。
 *
 * ```tsx
 * import { handleImport } from './services/storage/example';
 *
 * function DropZone() {
 *   const handleDrop = async (e: React.DragEvent) => {
 *     e.preventDefault();
 *     const file = e.dataTransfer.files[0];
 *     if (!file || !file.name.endsWith('.json')) return;
 *
 *     const result = await handleImport(file);
 *     console.log(result.message);
 *   };
 *
 *   return (
 *     <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
 *       拖拽 JSON 文件到此处导入
 *     </div>
 *   );
 * }
 * ```
 */