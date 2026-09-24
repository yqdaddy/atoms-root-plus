/**
 * MAJOR-D1 前端兜底测试：病态消息渲染不拖垮对话面板。
 * @vitest-environment jsdom
 *
 * 背景（reality-checker 独立验证结论）：一条畸形/超大 JSON 消息（实测
 * 104,026 字符、字段类型错乱样本）曾让渲染组件崩溃（PriorityBadge 读取
 * 畸形 priority 抛 TypeError）并可能拖垮整个对话面板。
 *
 * 覆盖：
 * 1. MessageErrorBoundary：字段类型错乱的 JSON 触发渲染崩溃时降级为占位
 *    卡片（该消息渲染失败），原始文本可折叠查看，错误日志被记录
 * 2. 超大 payload 防护：超大 JSON（> 50K）默认折叠不全量渲染，手动展开
 *    也被渲染上限截断，全程不崩溃
 * 3. 深嵌套 JSON：解析栈溢出被吞掉，不崩溃
 * 4. 故障隔离：单条消息崩溃不影响同列表其他消息
 * 5. StreamingMessage：完成态病态 JSON 同样被边界兜住，进度信息不受影响
 * 6. LongTextTruncate：超长纯文本默认折叠、展开有渲染上限
 * 7. renderGuard：防护常量与工具函数行为
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MessageErrorBoundary from './MessageErrorBoundary';
import MessageRenderer from './MessageRenderer';
import { StreamingMessage } from './StreamingMessage';
import LongTextTruncate from './LongTextTruncate';
import {
  LARGE_JSON_THRESHOLD,
  RAW_TEXT_RENDER_LIMIT,
  clampRenderText,
  isOversizedJson,
  limitItems,
} from '../lib/renderGuard';

// 图标系统打桩：测试聚焦错误边界与折叠行为，不依赖真实图标渲染
vi.mock('@iconify/react', () => ({
  Icon: () => null,
  addCollection: vi.fn(),
}));

/** 消息渲染挂载方式：与 HomePage MessageBubble 的生产结构一致 */
function renderMessage(content: string) {
  return render(
    <MessageErrorBoundary rawContent={content}>
      <MessageRenderer content={content} />
    </MessageErrorBoundary>,
  );
}

/**
 * 构造字段类型错乱的 feature-list JSON：
 * 字符串字段（name）被塞入嵌套对象，React 渲染时抛
 * "Objects are not valid as a React child"，复现 MAJOR-D1 崩溃路径
 */
function buildMalformedFeatureListJson(): string {
  return JSON.stringify({
    appTitle: '测试应用',
    appType: 'tool',
    summary: '功能清单摘要',
    features: [
      {
        id: 'f1',
        name: { nested: { value: '对象字段' } },
        priority: 'urgent',
        description: '畸形名称',
      },
      {
        id: 'f2',
        name: '正常功能',
        priority: 'must',
        description: '正常描述',
      },
    ],
  });
}

/** 构造超大字符串 JSON（默认大于大 JSON 阈值） */
function buildOversizedJsonJson(length: number): string {
  return JSON.stringify({ message: 'x'.repeat(length) });
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // 静音并捕获错误日志（边界 componentDidCatch 会记录渲染失败）
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
});

describe('MessageErrorBoundary：病态 JSON 消息渲染兜底', () => {
  it('字段类型错乱的 JSON 崩溃后出现降级占位卡片，且不向上抛', () => {
    const malformed = buildMalformedFeatureListJson();

    expect(() => renderMessage(malformed)).not.toThrow();

    // 降级占位卡片出现
    expect(screen.getByTestId('message-fallback')).toBeTruthy();
    expect(screen.getByText('该消息渲染失败')).toBeTruthy();
    // 病态结构化卡片未渲染（渲染已被边界中止）
    expect(screen.queryByText('正常功能')).toBeNull();
    // 错误被边界记录（componentDidCatch 日志通道）
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('降级卡片的原始文本默认折叠，点击后可查看', () => {
    const malformed = buildMalformedFeatureListJson();
    const { container } = renderMessage(malformed);

    // 默认折叠：details 处于关闭状态（jsdom 无布局引擎，用 open 属性断言）
    const details = container.querySelector('details');
    expect(details).toBeTruthy();
    expect(details!.open).toBe(false);

    // 点击"查看原始文本"后展开，可见原始 JSON 片段
    fireEvent.click(screen.getByText('查看原始文本'));
    expect(details!.open).toBe(true);
    expect(screen.getByText(/appTitle/)).toBeTruthy();
  });

  it('单条病态消息崩溃不影响同列表其他消息渲染', () => {
    const malformed = buildMalformedFeatureListJson();
    render(
      <div>
        <MessageErrorBoundary rawContent={malformed}>
          <MessageRenderer content={malformed} />
        </MessageErrorBoundary>
        <MessageErrorBoundary rawContent="正常消息文本">
          <MessageRenderer content="正常消息文本" />
        </MessageErrorBoundary>
      </div>,
    );

    // 正常消息照常渲染，病态消息降级
    expect(screen.getByText('正常消息文本')).toBeTruthy();
    expect(screen.getByTestId('message-fallback')).toBeTruthy();
  });

  it('边界子树渲染失败时降级卡片自身可正常渲染（纯文本路径）', () => {
    const Boom = (): never => {
      throw new TypeError('模拟渲染崩溃');
    };
    render(
      <MessageErrorBoundary rawContent="普通文本原始内容">
        <Boom />
      </MessageErrorBoundary>,
    );

    expect(screen.getByTestId('message-fallback')).toBeTruthy();
    expect(screen.getByText('渲染错误类型：TypeError')).toBeTruthy();
  });
});

describe('超大 payload 渲染防护', () => {
  it('超大 JSON（超过大 JSON 阈值）默认折叠，不触发结构化渲染与崩溃', () => {
    const big = buildOversizedJsonJson(LARGE_JSON_THRESHOLD + 10_000);
    renderMessage(big);

    // 不崩溃、无降级卡片
    expect(screen.queryByTestId('message-fallback')).toBeNull();
    // 默认截断展示：出现"查看全部"入口而非全量文本
    expect(screen.getByText('查看全部')).toBeTruthy();
  });

  it('超大 JSON 手动展开后被渲染上限截断并提示，全程不崩溃', () => {
    const big = buildOversizedJsonJson(RAW_TEXT_RENDER_LIMIT + 4_026);
    renderMessage(big);

    // 模拟实测 104,026 字符样本：手动展开也不全量渲染
    fireEvent.click(screen.getByText('查看全部'));

    expect(screen.queryByTestId('message-fallback')).toBeNull();
    expect(
      screen.getByText(/内容过长，仅显示前 100,000 字符/),
    ).toBeTruthy();
  });

  it('深嵌套 JSON 解析失败被吞掉，消息不崩溃', () => {
    // 3000 层嵌套数组：JSON.parse 栈溢出会抛 RangeError，必须被吞掉
    const deep = '['.repeat(3000) + ']'.repeat(3000);
    expect(() => renderMessage(deep)).not.toThrow();
    expect(screen.queryByTestId('message-fallback')).toBeNull();
  });
});

describe('StreamingMessage 边界挂载', () => {
  it('完成态病态 JSON 被边界兜住，进度信息不受影响', () => {
    const malformed = buildMalformedFeatureListJson();
    render(
      <StreamingMessage
        content={malformed}
        stage="done"
        startTime={Date.now()}
        intentType="create"
      />,
    );

    // 流式进度折叠条照常显示（边界只包内容区，不波及进度信息）
    expect(screen.getByText(/生成完成/)).toBeTruthy();
    // 内容区降级为占位卡片
    expect(screen.getByTestId('message-fallback')).toBeTruthy();
  });
});

describe('LongTextTruncate：超长纯文本折叠', () => {
  it('超过预览阈值的文本默认折叠，点击展开后可见全文', () => {
    const text = '字'.repeat(5000);
    render(<LongTextTruncate text={text} />);

    // 默认只渲染预览片段（2000 字符 + 省略号），不出现完整文本
    expect(screen.getByText(/^字+…$/)).toBeTruthy();
    expect(screen.queryByText(text)).toBeNull();

    // 点击展开后渲染全文（5000 < 渲染上限，无截断提示）
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(/内容过长/)).toBeNull();
  });

  it('展开后超过渲染上限的文本被截断并提示', () => {
    const text = '字'.repeat(5000);
    render(<LongTextTruncate text={text} previewLength={1000} expandLimit={3000} />);

    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));

    expect(screen.getByText(/内容过长，仅显示前 3,000 字符/)).toBeTruthy();
    expect(screen.queryByText(text)).toBeNull();
  });

  it('短文本直接渲染，不出现折叠入口', () => {
    render(<LongTextTruncate text="短文本" />);
    expect(screen.getByText('短文本')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('renderGuard：防护工具函数', () => {
  it('clampRenderText：短文本原样返回，超限文本截断并标记', () => {
    expect(clampRenderText('abc', 10)).toEqual({ text: 'abc', clipped: false });
    const clamped = clampRenderText('abcdef', 3);
    expect(clamped).toEqual({ text: 'abc', clipped: true });
  });

  it('limitItems：超限截断计数，非数组输入返回空列表', () => {
    const view = limitItems([1, 2, 3], 2);
    expect(view.items).toEqual([1, 2]);
    expect(view.hiddenCount).toBe(1);

    expect(limitItems(undefined).items).toEqual([]);
    expect(limitItems(null).items).toEqual([]);
    expect(limitItems([1], 2).hiddenCount).toBe(0);
  });

  it('isOversizedJson：按大 JSON 阈值判定', () => {
    expect(isOversizedJson('x'.repeat(LARGE_JSON_THRESHOLD))).toBe(false);
    expect(isOversizedJson('x'.repeat(LARGE_JSON_THRESHOLD + 1))).toBe(true);
  });
});
