/**
 * 数据导入面板组件
 * 支持拖拽上传和点击上传 CSV/JSON 文件，并提供数据预览
 */
import { useState, useCallback, useRef } from 'react';
import { Icon } from '@iconify/react';
import Modal from './Modal';
import { importData, inferFormat, type ParsedData, type DataImportResult } from '../services/data';
import { toast } from './Toast';

interface DataImportPanelProps {
  /** 是否显示面板 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 确认导入回调 */
  onImport: (data: ParsedData) => void;
}

export default function DataImportPanel({ open, onClose, onImport }: DataImportPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 处理文件解析
  const handleFileParse = useCallback((file: File) => {
    const format = inferFormat(file.name);
    if (!format) {
      setError('仅支持 CSV 和 JSON 格式');
      return;
    }

    setFileName(file.name);
    setError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) {
        setError('文件读取失败');
        return;
      }

      const result: DataImportResult = importData(content, format, { fileName: file.name });

      if (result.ok && result.data) {
        setParsedData(result.data);
      } else if (result.error) {
        setError(result.error.message);
        setParsedData(null);
      }
    };

    reader.onerror = () => {
      setError('文件读取失败');
      setParsedData(null);
    };

    reader.readAsText(file);
  }, []);

  // 点击上传
  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // 文件选择
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileParse(file);
    }
    e.target.value = '';
  }, [handleFileParse]);

  // 拖拽事件
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileParse(file);
    }
  }, [handleFileParse]);

  // 确认导入
  const handleConfirm = useCallback(() => {
    if (!parsedData) return;

    onImport(parsedData);
    toast.success(`已导入 ${parsedData.rows.length} 行数据`);
    handleClose();
  }, [parsedData, onImport]);

  // 关闭面板
  const handleClose = useCallback(() => {
    setParsedData(null);
    setFileName('');
    setError(null);
    onClose();
  }, [onClose]);

  // 预览行数（最多 10 行）
  const previewRows = parsedData?.rows.slice(0, 10) ?? [];

  return (
    <Modal open={open} onClose={handleClose} title="导入数据" maxWidth="800px">
      <div className="space-y-4">
        {/* 上传区域 */}
        <div
          onClick={handleClick}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`relative flex flex-col items-center justify-center h-40 rounded-lg border-2 border-dashed cursor-pointer transition-all duration-[140ms] ${
            isDragging
              ? 'border-[var(--color-accent)] bg-[var(--color-bg-elevated)]'
              : 'border-[var(--color-border-default)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-elevated)]'
          }`}
        >
          <Icon
            icon="lucide:upload"
            width={24}
            height={24}
            className={`mb-2 ${isDragging ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-tertiary)]'}`}
          />
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            拖拽文件到此处，或点击上传
          </p>
          <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
            支持 CSV 和 JSON 格式
          </p>

          {/* 隐藏的文件输入 */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[#fef2f2] border border-[#fecaca]">
            <Icon icon="lucide:x" width={14} height={14} className="text-[#ef4444] mt-0.5" />
            <div>
              <p className="text-[13px] font-medium text-[#ef4444]">导入失败</p>
              <p className="text-[13px] text-[var(--color-text-primary)]">{error}</p>
            </div>
          </div>
        )}

        {/* 数据预览 */}
        {parsedData && (
          <div className="space-y-3">
            {/* 文件信息 */}
            <div className="flex items-center gap-2">
              <Icon icon="lucide:check" width={14} height={14} className="text-[#22c55e]" />
              <span className="text-[13px] text-[var(--color-text-primary)]">
                {fileName}
              </span>
              <span className="text-[12px] text-[var(--color-text-tertiary)]">
                ({parsedData.meta?.rowCount ?? parsedData.rows.length} 行, {parsedData.meta?.colCount ?? parsedData.headers.length} 列)
              </span>
            </div>

            {/* 表格预览 */}
            <div className="overflow-x-auto rounded-lg border border-[var(--color-border-default)]">
              <table className="w-full text-[13px]">
                <thead className="bg-[var(--color-bg-elevated)]">
                  <tr>
                    <th className="px-3 py-2 text-left text-[12px] font-medium text-[var(--color-text-secondary)] border-b border-[var(--color-border-default)]">
                      #
                    </th>
                    {parsedData.headers.map((header, idx) => (
                      <th
                        key={idx}
                        className="px-3 py-2 text-left text-[12px] font-medium text-[var(--color-text-secondary)] border-b border-[var(--color-border-default)]"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, rowIdx) => (
                    <tr key={rowIdx} className="hover:bg-[var(--color-bg-elevated)]">
                      <td className="px-3 py-2 text-[var(--color-text-tertiary)] border-b border-[var(--color-border-default)]">
                        {rowIdx + 1}
                      </td>
                      {parsedData.headers.map((header, colIdx) => (
                        <td
                          key={colIdx}
                          className="px-3 py-2 text-[var(--color-text-primary)] border-b border-[var(--color-border-default)]"
                        >
                          {String(row[header] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {parsedData.rows.length > 10 && (
              <p className="text-[12px] text-[var(--color-text-tertiary)]">
                仅显示前 10 行，共 {parsedData.rows.length} 行
              </p>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-[10px] text-[14px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[80ms]"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!parsedData}
            className="px-5 py-2 rounded-[10px] text-[14px] text-[var(--color-text-on-accent)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] active:scale-[0.98] transition-all duration-[80ms] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            确认导入
          </button>
        </div>
      </div>
    </Modal>
  );
}