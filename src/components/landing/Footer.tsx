/**
 * 落地页 Footer 组件
 * 设计规范: docs/design/landing-page-spec.md 4.5
 */
import { Icon } from '@iconify/react';

export default function Footer() {
  return (
    <footer className="border-t border-[var(--color-border-default)] bg-[var(--color-bg-base)]">
      {/* 产品说明区域 */}
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
        <div className="text-center">
          {/* 产品名称与标语 */}
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            码孖造
          </h2>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            AI 驱动的应用生成平台
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
            让每个人都能用自然语言创造应用
          </p>
        </div>

        {/* 技术栈信息 */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-xs text-[var(--color-text-tertiary)]">
          <span className="flex items-center gap-1.5">
            <Icon icon="lucide:cpu" width={14} height={14} />
            <span>Built with React + TypeScript + Tailwind CSS</span>
          </span>
          <span className="text-[var(--color-border-default)]">|</span>
          <span className="flex items-center gap-1.5">
            <Icon icon="lucide:sparkles" width={14} height={14} />
            <span>Powered by Agnes AI</span>
          </span>
        </div>

        {/* 开发者信息 */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs text-[var(--color-text-tertiary)]">
          <a
            href="https://github.com/yqdaddy/atoms-root-plus"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-[var(--color-text-secondary)] transition-colors"
          >
            <Icon icon="lucide:github" width={14} height={14} />
            <span>GitHub</span>
          </a>
          <span className="text-[var(--color-border-default)]">|</span>
          <span>ROOT AI Native 笔试作品</span>
        </div>
      </div>

      {/* 版权和法律链接区域 */}
      <div className="border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
        <div className="mx-auto max-w-7xl px-6 py-4 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row sm:gap-4">
            {/* 版权声明 */}
            <p className="text-xs text-[var(--color-text-tertiary)]">
              © 2024 码孖造. All rights reserved.
            </p>

            {/* 法律链接 */}
            <div className="flex items-center gap-4 text-xs">
              <a
                href="#"
                className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
              >
                服务条款
              </a>
              <span className="text-[var(--color-border-default)]">·</span>
              <a
                href="#"
                className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
              >
                隐私政策
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}