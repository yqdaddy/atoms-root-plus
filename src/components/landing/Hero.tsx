/**
 * 落地页 Hero 区组件
 * 设计规范: docs/design/landing-page-spec.md 4.2
 * 登录态适配: 未登录 CTA 为「开始创建」（去注册），已登录为「进入工作台」
 */
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

export default function Hero() {
  const user = useAuthStore((state) => state.user);
  return (
    <section className="bg-[var(--color-bg-base)] py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* 左侧文字区 */}
          <div className="order-2 lg:order-1">
            <h1 className="font-display text-[32px] font-semibold leading-tight tracking-[-0.02em] text-[var(--color-text-primary)] lg:text-[42px]">
              把一句需求，
              <br />
              变成能跑的应用。
            </h1>

            <p className="mt-6 max-w-lg text-lg text-[var(--color-text-secondary)] lg:text-xl">
              描述想法，AI 团队生成网页应用，即时预览。
            </p>

            <div className="mt-8">
              <Link
                to={user ? '/workspace' : '/register'}
                className="inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] px-8 py-3 text-sm font-semibold text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-hover)] active:scale-[0.98] transition-all duration-140 min-w-[140px]"
              >
                {user ? '进入工作台' : '开始创建'}
              </Link>
            </div>
          </div>

          {/* 右侧截图区 */}
          <div className="order-1 lg:order-2">
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 lg:p-6">
              {/* 模拟工作台界面 */}
              <div className="flex min-h-[280px] flex-col gap-3 lg:min-h-[320px]">
                {/* 顶部工具栏 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-[var(--color-danger)]" />
                    <div className="h-3 w-3 rounded-full bg-[var(--color-warning)]" />
                    <div className="h-3 w-3 rounded-full bg-[var(--color-success)]" />
                  </div>
                  <div className="h-4 w-24 rounded bg-[var(--color-border-default)]" />
                </div>

                {/* 双栏布局 */}
                <div className="flex flex-1 gap-3 overflow-hidden">
                  {/* 左侧对话区 */}
                  <div className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-inset)] p-3">
                    <div className="space-y-2">
                      <div className="flex justify-end">
                        <div className="h-4 w-20 rounded bg-[var(--color-accent)] opacity-60" />
                      </div>
                      <div className="flex justify-start">
                        <div className="h-12 w-full rounded bg-[var(--color-border-default)]" />
                      </div>
                    </div>
                    <div className="mt-4 h-8 w-full rounded border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)]" />
                  </div>

                  {/* 右侧预览区 */}
                  <div className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-3">
                    <div className="grid gap-2">
                      <div className="h-6 w-1/2 rounded bg-[var(--color-accent)] opacity-40" />
                      <div className="h-4 w-full rounded bg-[var(--color-border-default)]" />
                      <div className="h-4 w-3/4 rounded bg-[var(--color-border-default)]" />
                      <div className="mt-2 h-8 w-24 rounded bg-[var(--color-accent)]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}