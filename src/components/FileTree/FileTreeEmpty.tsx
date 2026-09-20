/**
 * 文件树空状态组件。
 * 当项目无文件时显示引导提示。
 */
import { Icon } from '@iconify/react';

export function FileTreeEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="w-10 h-10 rounded-full bg-[var(--color-bg-elevated)] flex items-center justify-center mb-3">
        <Icon
          icon="lucide:folder-open"
          width={20}
          height={20}
          className="text-[var(--color-text-tertiary)]"
          aria-hidden="true"
        />
      </div>
      <p className="text-[13px] text-[var(--color-text-tertiary)]">暂无文件</p>
      <p className="text-[12px] text-[var(--color-text-tertiary)] mt-1">描述你的需求开始生成</p>
    </div>
  );
}