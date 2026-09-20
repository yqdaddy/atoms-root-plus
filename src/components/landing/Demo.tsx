/**
 * 落地页演示截图区组件
 * 设计规范: docs/design/landing-page-spec.md 4.4
 */
import { Icon } from '@iconify/react';

export default function Demo() {
  return (
    <section className="bg-[var(--color-bg-base)] py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-6">
        <h2 className="font-display text-2xl font-semibold text-[var(--color-text-primary)] lg:text-3xl">
          看看它长什么样
        </h2>

        {/* 截图容器 */}
        <div className="mt-10 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 lg:p-6">
          {/* 设备边框 */}
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-inset)] p-2 lg:p-3">
            {/* 工具栏 */}
            <div className="mb-3 flex items-center justify-between">
              <div
                className="flex items-center gap-1.5"
              >
                <div className="h-2.5 w-2.5 rounded-full bg-[var(--color-danger)]" />
                <div className="h-2.5 w-2.5 rounded-full bg-[var(--color-warning)]" />
                <div className="h-2.5 w-2.5 rounded-full bg-[var(--color-success)]" />
              </div>
              <Icon
                icon="lucide:monitor"
                width={20}
                height={20}
                className="text-[var(--color-text-tertiary)]"
              />
            </div>

            {/* 工作台界面 */}
            <div className="flex min-h-[300px] gap-3 lg:min-h-[400px] lg:gap-4">
              {/* 左侧对话面板 */}
              <div className="w-1/3 rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-3 lg:p-4">
                <div className="mb-4 h-5 w-16 rounded bg-[var(--color-text-secondary)] opacity-50" />
                <div className="space-y-3">
                  {/* 用户消息 */}
                  <div className="flex justify-end">
                    <div className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 py-1.5 text-xs text-[var(--color-text-on-accent)] opacity-80">
                      做一个番茄钟
                    </div>
                  </div>
                  {/* AI 消息 */}
                  <div className="flex justify-start">
                    <div className="space-y-2">
                      <div className="h-3 w-full rounded bg-[var(--color-border-default)]" />
                      <div className="h-3 w-4/5 rounded bg-[var(--color-border-default)]" />
                      <div className="h-3 w-3/5 rounded bg-[var(--color-border-default)]" />
                    </div>
                  </div>
                </div>
                {/* 输入框 */}
                <div className="mt-auto h-10 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-bg-inset)]" />
              </div>

              {/* 右侧预览面板 */}
              <div className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-base)] p-4 lg:p-6">
                {/* 番茄钟应用预览 */}
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="font-mono text-4xl font-medium text-[var(--color-text-primary)] lg:text-5xl">
                    25:00
                  </div>
                  <div className="mt-4 flex gap-2">
                    <div className="h-8 w-20 rounded-[var(--radius-md)] bg-[var(--color-accent)]" />
                    <div className="h-8 w-20 rounded-[var(--radius-md)] border border-[var(--color-border-default)]" />
                  </div>
                  <div className="mt-6 text-xs text-[var(--color-text-tertiary)]">专注中</div>
                </div>
              </div>
            </div>
          </div>

          {/* 说明文字 */}
          <p className="mt-4 text-center text-sm text-[var(--color-text-secondary)]">
            左侧对话描述需求，右侧实时预览结果。
          </p>
        </div>
      </div>
    </section>
  );
}