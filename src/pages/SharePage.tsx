/**
 * 分享预览页
 * 从 URL 参数读取分享 ID，从 localStorage 恢复 HTML 并渲染
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { loadShare, type ShareData } from '../utils/share';

export default function SharePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setError('无效的分享链接');
      setLoading(false);
      return;
    }

    const data = loadShare(id);
    if (!data) {
      setError('分享链接不存在或已过期');
      setLoading(false);
      return;
    }

    setShareData(data);
    setLoading(false);
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Icon icon="lucide:loader-2" width={32} height={32} className="animate-spin text-[var(--color-accent)]" />
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
            分享链接仅在 7 天内有效，且需要在同一浏览器中打开。
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
    <div className="min-h-screen bg-[var(--color-bg-base)] flex flex-col">
      {/* 顶部提示栏 */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
        <div className="flex items-center gap-2">
          <Icon icon="lucide:share-2" width={16} height={16} className="text-[var(--color-accent)]" />
          <span className="text-sm text-[var(--color-text-secondary)]">
            {shareData?.projectName || '分享预览'}
          </span>
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
      <div className="flex-1">
        {shareData?.html && (
          <iframe
            srcDoc={shareData.html}
            title="分享预览"
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-modals allow-forms allow-same-origin"
          />
        )}
      </div>
    </div>
  );
}
