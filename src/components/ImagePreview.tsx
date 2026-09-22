/**
 * 图片预览组件。
 * 显示已粘贴/拖拽的图片列表，支持删除操作。
 */
import { useState } from 'react';
import { Icon } from '@iconify/react';

export interface ImagePreviewProps {
  /** Base64 Data URL 数组 */
  images: string[];
  /** 删除图片回调 */
  onRemove: (index: number) => void;
}

/**
 * 图片预览组件
 * - 圆角缩略图
 * - 悬停显示删除按钮
 * - 加载失败显示占位图
 */
export function ImagePreview({ images, onRemove }: ImagePreviewProps) {
  if (images.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {images.map((image, index) => (
        <ImageThumbnail
          key={`${image.slice(0, 50)}-${index}`}
          image={image}
          index={index}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

interface ImageThumbnailProps {
  image: string;
  index: number;
  onRemove: (index: number) => void;
}

function ImageThumbnail({ image, index, onRemove }: ImageThumbnailProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [hasError, setHasError] = useState(false);

  return (
    <div
      className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--color-border-default)] bg-[var(--color-bg-base)]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {hasError ? (
        <div className="w-full h-full flex items-center justify-center text-[var(--color-text-tertiary)]">
          <Icon icon="lucide:image" width={24} height={24} />
        </div>
      ) : (
        <img
          src={image}
          alt={`附件图片 ${index + 1}`}
          className="w-full h-full object-cover"
          onError={() => setHasError(true)}
        />
      )}

      {/* 删除按钮 */}
      {isHovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(index);
          }}
          className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
          title="移除图片"
        >
          <Icon icon="lucide:x" width={14} height={14} />
        </button>
      )}

      {/* 图片序号 */}
      <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">
        {index + 1}
      </div>
    </div>
  );
}