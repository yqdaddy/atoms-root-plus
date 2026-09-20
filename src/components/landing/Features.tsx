/**
 * 落地页功能特性区组件
 * 设计规范: docs/design/landing-page-spec.md 4.3
 * 采用"一大两小"非对称布局，避免 AI 套版签名
 */
import { Icon } from '@iconify/react';

const features = [
  {
    id: 'preview',
    title: '生成即预览',
    description: '代码在沙箱中实时运行，修改即刻可见，无需等待部署。',
    icon: 'lucide:eye',
    isMain: true,
  },
  {
    id: 'agents',
    title: 'AI 团队协作',
    description: '需求分析、代码生成、质量审查由不同 Agent 完成，分工明确。',
    icon: 'lucide:users',
    isMain: false,
  },
  {
    id: 'local',
    title: '数据在你手里',
    description: '项目自动保存在浏览器本地，无需注册即可使用，支持导出备份。',
    icon: 'lucide:folder',
    isMain: false,
  },
];

export default function Features() {
  return (
    <section id="features" className="bg-[var(--color-bg-base)] py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-6">
        <h2 className="font-display text-2xl font-semibold text-[var(--color-text-primary)] lg:text-3xl">
          为什么选择 Atoms
        </h2>

        {/* 一大两小非对称布局 */}
        <div className="mt-10 grid gap-6 lg:grid-cols-3 lg:grid-rows-2">
          {/* 主特性卡片（大卡片） */}
          {features
            .filter((f) => f.isMain)
            .map((feature) => (
              <div
                key={feature.id}
                className="lg:col-span-2 lg:row-span-2 rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6 lg:p-8"
              >
                <Icon
                  icon={feature.icon}
                  width={24}
                  height={24}
                  className="text-[var(--color-accent)]"
                />
                <h3 className="mt-4 text-xl font-semibold text-[var(--color-text-primary)]">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)] lg:text-base">
                  {feature.description}
                </p>

                {/* 主特性额外说明 */}
                <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-inset)] p-4 lg:mt-8">
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
                    <span className="text-xs text-[var(--color-text-secondary)]">沙箱环境运行中</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <div className="h-4 w-8 rounded bg-[var(--color-border-default)]" />
                    <div className="h-4 w-12 rounded bg-[var(--color-border-default)]" />
                    <div className="h-4 w-6 rounded bg-[var(--color-accent)] opacity-40" />
                  </div>
                </div>
              </div>
            ))}

          {/* 次要特性卡片（小卡片） */}
          {features
            .filter((f) => !f.isMain)
            .map((feature) => (
              <div
                key={feature.id}
                className="rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6"
              >
                <Icon
                  icon={feature.icon}
                  width={24}
                  height={24}
                  className="text-[var(--color-text-secondary)]"
                />
                <h3 className="mt-4 text-lg font-semibold text-[var(--color-text-primary)]">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  {feature.description}
                </p>
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}