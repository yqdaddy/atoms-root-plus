/**
 * 落地页 Footer 组件
 * 设计规范: docs/design/landing-page-spec.md 4.5
 */
import { Link } from 'react-router-dom';

const footerLinks = {
  product: {
    title: '产品',
    links: [
      { label: '功能', to: '#features' },
      { label: '定价', to: '#' },
    ],
  },
  resources: {
    title: '资源',
    links: [
      { label: '文档', to: '#' },
      { label: 'API', to: '#' },
    ],
  },
  about: {
    title: '关于',
    links: [
      { label: 'GitHub', to: '#' },
      { label: '反馈', to: '#' },
    ],
  },
};

export default function Footer() {
  return (
    <footer className="border-t border-[var(--color-border-default)] bg-[var(--color-bg-base)] py-12">
      <div className="mx-auto max-w-7xl px-6 lg:px-6">
        <div className="grid gap-8 lg:grid-cols-4">
          {/* Logo 和简介 */}
          <div>
            <Link
              to="/"
              className="font-display text-xl font-semibold text-[var(--color-text-primary)]"
            >
              Litpp Demo
            </Link>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              AI 驱动的应用生成平台
            </p>
          </div>

          {/* 链接组 */}
          {Object.entries(footerLinks).map(([key, section]) => (
            <div key={key}>
              <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {section.title}
              </h4>
              <ul className="mt-4 space-y-3">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-[var(--ease-standard)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 版权 */}
        <div className="mt-12 border-t border-[var(--color-border-default)] pt-8">
          <p className="text-center text-xs text-[var(--color-text-tertiary)]">
            © 2024 Litpp Demo. 本项目为 ROOT AI Native 笔试作品。
          </p>
        </div>
      </div>
    </footer>
  );
}