/**
 * 分享预览页
 * 从 URL 参数读取分享 ID，从服务器获取 HTML 并渲染
 * 支持多文件项目：将 CSS/JS 内容注入为内联标签
 */
import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { loadShare, type ShareData, type SharedFile } from '../utils/share';
import { buildSandboxAttribute, buildPreviewCsp, DEFAULT_CDN_HOSTS } from '../types/sandbox';

/**
 * 将多文件内容注入到 HTML 中
 * - CSS 文件注入为 <style> 标签
 * - JS 文件注入为 <script> 标签
 * - 移除对应的外部引用
 */
function injectFilesIntoHtml(html: string, files: Record<string, SharedFile> | null | undefined): string {
  if (!files || Object.keys(files).length === 0) {
    return html;
  }

  let result = html;

  // 收集需要注入的 CSS 和 JS
  const cssFiles: Array<{ path: string; content: string }> = [];
  const jsFiles: Array<{ path: string; content: string }> = [];

  for (const [path, file] of Object.entries(files)) {
    // 跳过入口文件（已经在 html 中）
    if (path === '/index.html' || path === 'index.html') continue;

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    if (normalizedPath.endsWith('.css')) {
      cssFiles.push({ path: normalizedPath, content: file.content });
    } else if (normalizedPath.endsWith('.js')) {
      jsFiles.push({ path: normalizedPath, content: file.content });
    }
  }

  // 注入 CSS：移除外部 link，添加内联 style
  for (const cssFile of cssFiles) {
    // 匹配 <link rel="stylesheet" href="styles/main.css"> 或类似引用
    // 前缀兼容 ./、../、/ 与无前缀四种形式
    const relPath = escapeRegExp(cssFile.path.slice(1));
    const patterns = [
      new RegExp(`<link[^>]*href=["'](?:\\./|\\.\\./|/)?${relPath}["'][^>]*>`, 'g'),
      new RegExp(`<link[^>]*href=["']${escapeRegExp(cssFile.path)}["'][^>]*>`, 'g'),
    ];

    let matched = false;
    for (const pattern of patterns) {
      if (pattern.test(result)) {
        result = result.replace(pattern, `<style>\n${cssFile.content}\n</style>`);
        matched = true;
      }
    }

    // 兜底：引用形式未匹配到 link 标签时，直接注入到 </head> 前
    if (!matched && result.includes('</head>')) {
      const styleTag = `<style>\n${cssFile.content}\n</style>`;
      result = result.replace('</head>', `${styleTag}\n</head>`);
    }
  }

  // 注入 JS：移除外部 script src，添加内联 script
  for (const jsFile of jsFiles) {
    // 前缀兼容 ./、../、/ 与无前缀四种形式
    const relPath = escapeRegExp(jsFile.path.slice(1));
    const patterns = [
      new RegExp(`<script[^>]*src=["'](?:\\./|\\.\\./|/)?${relPath}["'][^>]*>\\s*</script>`, 'g'),
      new RegExp(`<script[^>]*src=["']${escapeRegExp(jsFile.path)}["'][^>]*>\\s*</script>`, 'g'),
    ];

    let matched = false;
    for (const pattern of patterns) {
      if (pattern.test(result)) {
        result = result.replace(pattern, `<script>\n${jsFile.content}\n</script>`);
        matched = true;
      }
    }

    // 兜底：引用形式未匹配到 script 标签时，直接注入到 </body> 前
    if (!matched && result.includes('</body>')) {
      const scriptTag = `<script>\n${jsFile.content}\n</script>`;
      result = result.replace('</body>', `${scriptTag}\n</body>`);
    }
  }

  return result;
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function SharePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchShare() {
      if (!id) {
        setError('无效的分享链接');
        setLoading(false);
        return;
      }

      const data = await loadShare(id);
      if (cancelled) return;

      if (!data) {
        setError('分享链接不存在或已过期');
        setLoading(false);
        return;
      }

      setShareData(data);
      setLoading(false);
    }

    fetchShare();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 注入多文件内容后的 HTML
  const injectedHtml = useMemo(() => {
    if (!shareData?.html) return '';
    let html = injectFilesIntoHtml(shareData.html, shareData.files);

    // 注入 CSP meta 标签（限制外部资源访问，只允许默认 CDN 域名，不允许 eval）
    const csp = buildPreviewCsp(DEFAULT_CDN_HOSTS, false);
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${cspMeta}`);
    } else if (html.includes('<html>')) {
      html = html.replace('<html>', `<html><head>${cspMeta}</head>`);
    } else {
      // 最小化 HTML 包装
      html = `<!DOCTYPE html><html><head>${cspMeta}</head><body>${html}</body></html>`;
    }

    return html;
  }, [shareData]);

  // 构建安全的 sandbox 属性（移除 allow-same-origin，与主预览沙箱一致）
  const sandboxAttr = useMemo(() => buildSandboxAttribute(['allow-forms', 'allow-modals']), []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Icon icon="lucide:loader-circle" width={32} height={32} className="animate-spin text-[var(--color-accent)]" />
          <p className="text-[var(--color-text-secondary)]">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <Icon icon="lucide:alert-circle" width={48} height={48} className="text-[var(--color-error)]" />
          <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">{error}</h1>
          <p className="text-[var(--color-text-secondary)]">
            分享链接有效期 7 天，任何设备均可打开。
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[var(--color-bg-base)] flex flex-col">
      {/* 顶部提示栏 */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)] shrink-0">
        <div className="flex items-center gap-2">
          <Icon icon="lucide:share-2" width={16} height={16} className="text-[var(--color-accent)]" />
          <span className="text-sm text-[var(--color-text-secondary)]">
            {shareData?.projectName || '分享预览'}
          </span>
          {shareData?.files && Object.keys(shareData.files).length > 1 && (
            <span className="text-xs text-[var(--color-text-tertiary)] ml-2">
              ({Object.keys(shareData.files).length} 个文件)
            </span>
          )}
        </div>
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-base)] transition-colors"
        >
          <Icon icon="lucide:home" width={14} height={14} />
          返回首页
        </button>
      </div>

      {/* 预览内容 */}
      <div className="flex-1 min-h-0">
        {injectedHtml && (
          <iframe
            srcDoc={injectedHtml}
            title="分享预览"
            className="w-full h-full border-0"
            sandbox={sandboxAttr}
          />
        )}
      </div>
    </div>
  );
}