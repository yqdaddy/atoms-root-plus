/**
 * 首页：全屏智能体界面（类 atoms.dev 风格）。
 * 左侧 AI 对话 + 文件生成面板，右侧实时预览 + 代码查看。
 * 支持批准流程：分析完成后显示计划，用户批准后继续生成。
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { useProjectStore } from '../stores/projectStore';
import { useChatStore, getCurrentPhaseText } from '../stores/chatStore';
import type { FileGenerationStatus } from '../stores/chatStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore'; // F-001: 首页登录守卫
import { saveShare, getShareUrl } from '../utils/share';
import { deployProject } from '../utils/deploy';
import { ApiError } from '../services/apiClient';
import { getAIAPI, type StreamEvent, type GenerateOptions, validateGeneratedHtml, type DemoTemplateId, type FeatureList } from '../services/ai';
import { approveAndContinue } from '../services/ai/liveEngine';
import { cancelActiveRun } from '../services/ai/activeRun';
import { ENTRY_FILE_PATH, type ProjectFramework, type ChatMessage as ProjectChatMessage, type FileNode as ProjectFileNode } from '../types/project';
import { loadMemoryForGeneration, isRecallQuery, generateRecallResponse, extractAndUpdateGlobalPreferences } from '../services/memory';
import { toast } from '../components/Toast';
import { HomeAuthControls } from '../components/AuthControls';
import SandboxFrame from '../components/SandboxFrame';
import { FileTreePanel, type TreeNode, buildTree } from '../components/FileTree';
import { RequirementPanel } from '../components/RequirementPanel';
import { VersionHistory } from '../components/VersionHistory';
import { useOptimizerStore } from '../stores/optimizerStore';
import type { ConfirmedRequirement, OptimizedRequirement } from '../services/ai/optimizer';
import { extractProgressInfo, parseReviewChecks } from '../utils/streamParser';
import { ReviewSummary } from '../components/ReviewSummary';
import { extractPreferences } from '../services/ai/preferenceExtractor';
import type { ChangeList } from '../services/ai/types';
import { DiffViewer } from '../components/DiffViewer';
import { StreamingMessage } from '../components/StreamingMessage';
import ReactMarkdown from 'react-markdown';
import { ImagePreview } from '../components/ImagePreview';
import { CommandDropdown } from '../commands/CommandDropdown';
import { parseCommandInput, executeCommand, type CommandContext } from '../commands/index';
import { useKeybinding } from '../hooks/useKeybinding';

/** 图片限制配置 */
const IMAGE_CONFIG = {
  maxSize: 5 * 1024 * 1024, // 5MB
  maxCount: 4,
  allowedTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'],
};

/** 一键部署入口开关：上线时改为 true 即恢复完整部署流程 */
const DEPLOY_ENABLED = false;

const TEMPLATE_CHIPS: { id: DemoTemplateId; label: string; prompt: string; icon: string; framework: ProjectFramework }[] = [
  { id: 'todo', label: '待办清单', prompt: '做一个待办清单，可以添加、完成和删除任务', icon: 'lucide:check-square', framework: 'react-cdn' },
  { id: 'chart', label: '数据看板', prompt: '做一个数据看板，显示图表和统计信息', icon: 'lucide:bar-chart-2', framework: 'react-cdn' },
  { id: 'landing', label: '落地页', prompt: '做一个产品落地页，展示产品特性', icon: 'lucide:layout', framework: 'html' },
  { id: 'dashboard', label: '控制面板', prompt: '做一个控制面板，包含多个功能卡片', icon: 'lucide:grid-3x3', framework: 'react-cdn' },
  { id: 'calculator', label: '计算器', prompt: '创建一个计算器应用，支持加减乘除和百分比计算', icon: 'lucide:calculator', framework: 'html' },
  { id: 'snake', label: '贪吃蛇', prompt: '创建一个贪吃蛇游戏，用方向键控制，显示得分', icon: 'lucide:gamepad-2', framework: 'html' },
];

/** 消息状态（用于 UI 展示，与持久化解耦） */
type MessageStatus = 'processing' | 'done' | 'error' | 'waiting_approval';

/** UI 消息（扩展自持久化的 ChatMessage，添加临时 UI 状态） */
interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  steps?: number;
  status?: MessageStatus;
  /** 分析结果（用于批准流程） */
  features?: FeatureList | { raw: string };
  /** 会话 ID（用于批准后继续） */
  sessionId?: string;
  /** 用户上传的图片（Base64 Data URL 数组） */
  images?: string[];
}

/** 将持久化消息转换为 UI 消息（过滤 system 消息） */
function toUIMessage(msg: ProjectChatMessage): UIMessage | null {
  // 过滤掉 system 消息，UI 不显示
  if (msg.role === 'system') return null;
  const result: UIMessage = {
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
    timestamp: new Date(msg.createdAt),
  };
  // 仅在有图片时添加 images 属性
  if (msg.images && msg.images.length > 0) {
    result.images = msg.images;
  }
  return result;
}

/** 格式化时间 */
function formatTime(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

/** 判断是否为 FeatureList 类型 */
function isFeatureList(features: unknown): features is FeatureList {
  return typeof features === 'object' && features !== null && 'appTitle' in features && 'features' in features;
}

/** 意图类型到标签文案和颜色的映射 */
const INTENT_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  create: { label: '创建', color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  modify: { label: '修改', color: 'text-green-500', bgColor: 'bg-green-500/10' },
  analyze: { label: '分析', color: 'text-yellow-500', bgColor: 'bg-yellow-500/10' },
  diagnose: { label: '诊断', color: 'text-orange-500', bgColor: 'bg-orange-500/10' },
};

/**
 * 生成失败后回退当前项目状态
 */
function revertProjectStatusAfterFailure(): void {
  const { currentProject, updateProjectStatus } = useProjectStore.getState();
  const entryHtml = currentProject?.files[ENTRY_FILE_PATH]?.content ?? '';
  updateProjectStatus(validateGeneratedHtml(entryHtml).ok ? 'ready' : 'draft');
}

/**
 * 将确认后的结构化需求组合为流水线提示词。
 * 三阶段流水线入口只接受纯文本 prompt（AIEngine 契约），
 * 因此以「原始描述 + 结构化文档 + 修改说明」的富文本形式传递给分析师阶段。
 */
function composePipelinePrompt(confirmed: ConfirmedRequirement): string {
  const parts = [
    confirmed.originalPrompt,
    '## 已确认的结构化需求文档',
    JSON.stringify(confirmed.optimized, null, 2),
  ];
  if (confirmed.userEdited && confirmed.editNotes) {
    parts.push(`## 用户修改说明：${confirmed.editNotes}`);
  }
  parts.push('请严格按照以上结构化需求文档生成应用；原始描述与文档冲突时，以文档为准。');
  return parts.join('\n');
}

/**
 * 复制文本到剪贴板（兼容非安全上下文）
 */
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback: 使用 textarea + execCommand
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

/**
 * 简单的代码高亮（HTML）
 */
function highlightHtml(code: string): React.ReactNode {
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const highlighted = escaped
    .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="text-[var(--color-accent)]">$2</span>')
    .replace(/([\w-]+)(=)/g, '<span class="text-amber-400">$1</span>$2')
    .replace(/"([^"]*)"/g, '<span class="text-green-400">"$1"</span>');

  return <span dangerouslySetInnerHTML={{ __html: highlighted }} />;
}

/** 文件树项组件 */
function FileTreeItem({ file, isActive }: { file: FileGenerationStatus; isActive: boolean }) {
  const statusIcon = useMemo(() => {
    switch (file.status) {
      case 'pending':
        return <span className="w-4 h-4 flex items-center justify-center text-[var(--color-text-tertiary)]">○</span>;
      case 'generating':
        // 状态点：生成中闪烁
        return (
          <div className="w-4 h-4 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
          </div>
        );
      case 'completed':
        // 状态点：完成绿色
        return <Icon icon="lucide:check" width={14} height={14} className="text-green-500" />;
      case 'failed':
        // 状态点：失败红色
        return <Icon icon="lucide:x" width={14} height={14} className="text-red-500" />;
    }
  }, [file.status]);

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors ${
      isActive ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'
    }`}>
      {statusIcon}
      <Icon icon="lucide:file-code" width={14} height={14} />
      <span className="flex-1 truncate">{file.name}</span>
      {file.status === 'generating' && file.charCount > 0 && (
        <span className="text-[11px] text-[var(--color-text-tertiary)] tabular-nums">
          {file.lineCount} 行
        </span>
      )}
      {file.status === 'completed' && file.charCount > 0 && (
        <span className="text-[11px] text-[var(--color-text-tertiary)] tabular-nums">
          {(file.charCount / 1024).toFixed(1)}KB
        </span>
      )}
    </div>
  );
}

/** 消息气泡组件（类 atoms.dev 风格） */
function MessageBubble({
  message,
  onApprove,
}: {
  message: UIMessage;
  onApprove?: (sessionId: string) => void;
}) {
  const isUser = message.role === 'user';
  const isWaitingApproval = message.status === 'waiting_approval';
  const features = message.features;

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      {/* 时间戳 */}
      <div className={`flex items-center gap-2 mb-1 text-[11px] text-[var(--color-text-tertiary)] ${isUser ? 'flex-row-reverse' : ''}`}>
        <span>{formatTime(message.timestamp)}</span>
        {!isUser && message.steps && (
          <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg-base)]">
            {message.steps} 步
          </span>
        )}
      </div>

      {/* 消息内容 */}
      <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
        isUser
          ? 'bg-[var(--color-accent)] text-white'
          : 'bg-[var(--color-bg-base)] border border-[var(--color-border-default)]'
      }`}>
        {/* 用户图片 */}
        {isUser && message.images && message.images.length > 0 && (
          <div className="mb-2 -mx-1">
            <div className="flex flex-wrap gap-2">
              {message.images.map((image, index) => (
                <img
                  key={`${image.slice(0, 50)}-${index}`}
                  src={image}
                  alt={`附件图片 ${index + 1}`}
                  className="w-24 h-24 rounded-lg object-cover"
                />
              ))}
            </div>
          </div>
        )}

        {isUser ? (
          // 用户消息：纯文本显示
          <p className="text-[13px] leading-[1.6] whitespace-pre-wrap">{message.content}</p>
        ) : (
          // AI 消息：Markdown 渲染
          <div className="prose prose-sm max-w-none text-[13px] text-[var(--color-text-primary)] leading-[1.6]">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}

        {/* 功能清单展示 */}
        {!isUser && isWaitingApproval && features && isFeatureList(features) && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border-default)]">
            <h4 className="text-[12px] font-medium text-[var(--color-text-primary)] mb-2">功能清单</h4>
            <div className="space-y-1.5">
              {features.features.map((f) => (
                <div key={f.id} className="flex items-start gap-2">
                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                    f.priority === 'must'
                      ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'bg-[var(--color-text-tertiary)]/10 text-[var(--color-text-secondary)]'
                  }`}>
                    {f.priority === 'must' ? '必须' : '可选'}
                  </span>
                  <span className="text-[12px] text-[var(--color-text-secondary)]">{f.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 状态标签或批准按钮 */}
        {!isUser && message.status && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--color-border-default)]">
            {isWaitingApproval ? (
              <>
                <span className="text-[11px] text-amber-500">等待批准</span>
                {message.sessionId && onApprove && (
                  <button
                    onClick={() => onApprove(message.sessionId!)}
                    className="ml-auto px-3 py-1 rounded-lg bg-[var(--color-accent)] text-white text-[12px] font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
                  >
                    批准
                  </button>
                )}
              </>
            ) : (
              <span className={`text-[11px] ${
                message.status === 'done' ? 'text-green-500' :
                message.status === 'error' ? 'text-red-500' :
                'text-[var(--color-accent)]'
              }`}>
                {message.status === 'done' ? '已处理' :
                 message.status === 'error' ? '处理失败' :
                 '处理中...'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const [inputValue, setInputValue] = useState('');
  // 新项目的目标框架：仅在首条消息创建项目时生效，默认 html
  const [selectedFramework, setSelectedFramework] = useState<ProjectFramework>('html');
  const [isGenerating, setIsGenerating] = useState(false);
  // ZIP 导出进行中标记（防重复点击）
  const [isExporting, setIsExporting] = useState(false);
  const [viewTab, setViewTab] = useState<'preview' | 'code'>('preview');
  // deviceMode 已移至 SandboxFrame 组件（通过 useSettingsStore）
  const [showConsole, setShowConsole] = useState(false);
  // 当前正在生成的消息 ID（用于跟踪 UI 状态）
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  // 部署进行中标记（防重复点击）
  const [isDeploying, setIsDeploying] = useState(false);
  // 当前消息的 UI 状态（步骤数、status 等）
  const [messageUIState, setMessageUIState] = useState<{ steps: number; status: MessageStatus; features?: FeatureList | { raw: string }; sessionId?: string } | null>(null);
  // 待确认的变更（diff 模式）：用户批准后应用，拒绝则丢弃
  const [pendingDiff, setPendingDiff] = useState<{
    changes: ChangeList;
    files: Record<string, ProjectFileNode>;
  } | null>(null);
  // 已粘贴/拖拽的图片列表（Base64 Data URL）
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  // 是否正在拖拽图片
  const [isDragging, setIsDragging] = useState(false);
  // 命令下拉是否可见
  const [showCommandDropdown, setShowCommandDropdown] = useState(false);
  const navigate = useNavigate();

  // F-001: 首页登录守卫
  const { user } = useAuthStore();
  const isLoggedIn = !!user;

  // 流式输出状态
  const streamBuffer = useChatStore((state) => state.streamBuffer);
  const reviewChecks = useChatStore((state) => state.reviewChecks);
  const streamingText = getCurrentPhaseText(streamBuffer);
  const scrollRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);

  // 渲染阶段立即判断：刷新/直接访问时清除当前项目（导航进入则保留）
  // 注意：必须在读取 currentProject 之前执行，避免先渲染旧项目再清除导致的闪烁
  const wasNavigatedRef = useRef<boolean | null>(null);
  if (wasNavigatedRef.current === null) {
    // 只在首次渲染时判断一次
    wasNavigatedRef.current = sessionStorage.getItem('atoms_nav_to_workspace') === 'true';
    sessionStorage.removeItem('atoms_nav_to_workspace');
    if (!wasNavigatedRef.current) {
      useProjectStore.getState().clearCurrentProject();
    }
  }

  // 当前项目的 HTML
  const currentProject = useProjectStore((state) => state.currentProject);
  const generatedHtml = currentProject?.files[ENTRY_FILE_PATH]?.content ?? '';

  // 当前选中的文件路径（用于文件树高亮和代码查看）
  const [activeFilePath, setActiveFilePath] = useState<string | null>(ENTRY_FILE_PATH);

  // 转换文件列表为文件树结构（使用项目 files）
  const fileTree: TreeNode[] = useMemo(() => {
    if (currentProject?.files) {
      return buildTree(currentProject.files);
    }
    return [];
  }, [currentProject?.files]);

  // 当前选中文件内容
  const activeFileContent = useMemo(() => {
    if (!activeFilePath) return generatedHtml;
    return currentProject?.files[activeFilePath]?.content ?? generatedHtml;
  }, [activeFilePath, currentProject?.files, generatedHtml]);

  // 处理文件选择
  const handleFileSelect = useCallback((path: string) => {
    setActiveFilePath(path);
    // 可选：更新 URL hash 支持书签
    window.location.hash = `file=${encodeURIComponent(path)}`;
  }, []);

  // 处理目录展开/收起（目前没有目录，预留扩展）
  const handleFolderToggle = useCallback((_path: string) => {
    // 预留：多文件项目时实现目录展开/收起
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current && streamingText) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    if (codeRef.current && generatedHtml && viewTab === 'code') {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [streamingText, generatedHtml, viewTab]);

  const { createProject, updateEntryFile, updateFiles, updateProjectStatus, addMessage, saveVersion } = useProjectStore();
  const { startGeneration, updateStage, appendDelta, finishGeneration, setError, setAwaitingApproval, updateFileStatus, setReviewChecks, setIntent } = useChatStore();
  const { apiKey, getEffectiveBaseURL } = useSettingsStore();

  // 提示词优化器（需求确认前置流程）
  const optimizerEnabled = useOptimizerStore((state) => state.enabled);
  const optimizerResult = useOptimizerStore((state) => state.result);
  const isOptimizing = useOptimizerStore((state) => state.isOptimizing);
  const optimizerError = useOptimizerStore((state) => state.error);
  const optimizerStreamText = useOptimizerStore((state) => state.streamText);
  const optimizerOriginalPrompt = useOptimizerStore((state) => state.originalPrompt);

  // 从持久化层读取消息，并合并当前生成中的 UI 状态
  const messages = useMemo((): UIMessage[] => {
    const persistedMessages = currentProject?.chat ?? [];
    // 过滤掉 system 消息（toUIMessage 返回 null）
    const uiMessages = persistedMessages.map(toUIMessage).filter((m): m is UIMessage => m !== null);

    // 如果有正在生成的消息，添加 UI 状态
    if (pendingMessageId && messageUIState) {
      const idx = uiMessages.findIndex(m => m.id === pendingMessageId);
      if (idx !== -1) {
        const existing = uiMessages[idx];
        if (existing) {
          const updated: UIMessage = {
            id: existing.id,
            role: existing.role,
            content: existing.content,
            timestamp: existing.timestamp,
            steps: messageUIState.steps,
            status: messageUIState.status,
          };
          if (messageUIState.features !== undefined) {
            updated.features = messageUIState.features;
          }
          if (messageUIState.sessionId !== undefined) {
            updated.sessionId = messageUIState.sessionId;
          }
          uiMessages[idx] = updated;
        }
      }
    }

    return uiMessages;
  }, [currentProject?.chat, pendingMessageId, messageUIState]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= 2000) {
      setInputValue(value);
      // 检测命令：以 / 开头时显示下拉
      setShowCommandDropdown(value.trim().startsWith('/'));
    }
  };

  const handleChipClick = (chip: typeof TEMPLATE_CHIPS[number]) => {
    if (isGenerating) return;
    // F-001: 未登录时点击模板按钮跳转到登录页
    if (!isLoggedIn) {
      navigate('/login?redirect=%2Fworkspace');
      return;
    }
    // 模板自带推荐框架，填充提示词的同时同步框架选择
    setSelectedFramework(chip.framework);
    setInputValue(chip.prompt);
  };

  // 处理生成事件
  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
      console.log('[HomePage] 收到事件:', event.type, event.payload);
      switch (event.type) {
        case 'stage':
          updateStage(event.payload.stage, event.payload.attempt, event.payload.message, event.payload.intent);
          // 更新消息步骤计数
          setMessageUIState(prev => prev ? { ...prev, steps: (prev.steps || 0) + 1 } : { steps: 1, status: 'processing' });
          break;
        case 'delta': {
          // 工具参数流式渲染：优先用 payload 携带的文件信息，缺省时从累积文本推断
          const { fileName, operation } = event.payload;
          const currentBuffer = useChatStore.getState().streamBuffer;
          const currentStreamingText = getCurrentPhaseText(currentBuffer);
          const resolvedFileName = fileName
            ?? ((event.payload.phase === 'generate' || event.payload.phase === 'repair')
              ? extractProgressInfo(currentStreamingText + event.payload.text).fileName
              : null);
          appendDelta(event.payload.phase, event.payload.text, resolvedFileName ?? undefined, operation);
          // UI 状态保持 processing
          setMessageUIState(prev => prev ? { ...prev, status: 'processing' } : { steps: 0, status: 'processing' });
          break;
        }
        case 'done': {
          console.log('[HomePage] done 事件:', {
            htmlLength: event.payload.html?.length || 0,
            htmlPreview: event.payload.html?.slice(0, 200) || '(empty)',
            hasFiles: !!(event.payload as { files?: Record<string, ProjectFileNode> }).files,
            hasChanges: !!(event.payload as { changes?: ChangeList }).changes,
          });

          // 从流式文本解析审查者检查结果，折叠为单行摘要展示
          const doneBuffer = useChatStore.getState().streamBuffer;
          setReviewChecks(parseReviewChecks(doneBuffer.generateText + doneBuffer.repairText));

          // 将追踪中的文件标记为完成
          for (const f of doneBuffer.files) {
            if (f.status === 'generating') {
              updateFileStatus(f.path, 'completed', f.charCount, f.lineCount);
            }
          }

          // 兼容多文件格式：检查 payload.files 是否存在
          const payload = event.payload as {
            html?: string;
            files?: Record<string, ProjectFileNode>;
            warnings?: string[];
            changes?: ChangeList;
            changeSummary?: string;
            analysis?: string;
          };
          const hasFiles = payload.files && Object.keys(payload.files).length > 0;
          const hasChanges = !!payload.changes && payload.changes.changes.length > 0;
          const hasAnalysis = !!payload.analysis && payload.analysis.length > 0;

          // 对话模式：有 analysis 字段时，作为 assistant 消息展示
          // （analyze/diagnose 意图、分析师澄清、diff 模式空变更均走此分支）
          if (hasAnalysis && !hasFiles && !payload.html) {
            console.log('[HomePage] 对话模式，analysis 字段长度:', payload.analysis!.length);
            finishGeneration();
            setIsGenerating(false);
            // 对话模式不改动项目文件，恢复生成前状态（runGeneration 已置为 generating）
            revertProjectStatusAfterFailure();

            // 将分析/诊断结果作为 assistant 消息保存
            addMessage({ role: 'assistant', content: payload.analysis! });
            toast.success('分析完成');

            // 清除 UI 状态
            setPendingMessageId(null);
            setMessageUIState(null);
            break;
          }

          // diff 模式：有 changes 时先显示 DiffViewer，等待用户确认
          if (hasChanges && hasFiles) {
            console.log('[HomePage] diff 模式，等待用户确认变更');
            finishGeneration();
            setIsGenerating(false);
            setPendingDiff({
              changes: payload.changes!,
              files: payload.files!,
            });
            // 添加提示消息
            addMessage({ role: 'assistant', content: `代码修改完成，${payload.changes!.summary}。请确认后应用变更。` });
            // 清除 UI 状态
            setPendingMessageId(null);
            setMessageUIState(null);
            break;
          }

          if (hasFiles) {
            // 多文件模式（非 diff 模式或 diff 解析失败后的降级）
            const files = payload.files!;
            console.log('[HomePage] 多文件模式，文件数:', Object.keys(files).length);

            // 获取入口文件内容用于验证
            const entryPath = (event.payload as { entryFile?: string }).entryFile ?? ENTRY_FILE_PATH;
            const entryContent = files[entryPath]?.content ?? files[ENTRY_FILE_PATH]?.content ?? '';
            const validation = validateGeneratedHtml(entryContent);

            // 保存多文件
            updateFiles(files, entryPath);
            updateProjectStatus(validation.ok ? 'ready' : 'draft');
            finishGeneration();
            setIsGenerating(false);

            // 组合完整的 LLM 输出（分析 + 生成内容）
              const filesBuffer = useChatStore.getState().streamBuffer;
              const fullContent = [
                filesBuffer.analyzeText,
                filesBuffer.generateText,
              ].filter(Boolean).join('\n\n').trim();

              if (validation.ok) {
                // 保存版本快照
                const summary = `生成应用，共 ${Object.keys(files).length} 个文件`;
                const isFirstVersion = useProjectStore.getState().versions.length === 0;
                saveVersion(summary, isFirstVersion ? 'initial' : 'iteration');

                // 添加完整消息：优先使用 LLM 输出，fallback 到简短提示
                addMessage({
                  role: 'assistant',
                  content: fullContent || `应用已生成完成！共 ${Object.keys(files).length} 个文件。你可以继续描述需求来修改它。`
                });
                toast.success('生成完成');
              } else {
                const warningMsg = `生成完成，但代码存在 ${validation.issues.length} 个问题，可能影响功能`;
                addMessage({
                  role: 'assistant',
                  content: fullContent || warningMsg
                });
                toast.info(warningMsg);
                console.warn('[HomePage] 验证问题:', validation.issues);
              }

            // 清除 UI 状态
            setPendingMessageId(null);
            setMessageUIState(null);
          } else if (event.payload.html && event.payload.html.length > 0) {
            // 单文件模式（向后兼容）
            console.log('[HomePage] 单文件模式');
            const validation = validateGeneratedHtml(event.payload.html);
            console.log('[HomePage] 验证结果:', validation);

            console.log('[HomePage] 调用 updateEntryFile');
            updateEntryFile(event.payload.html);
            console.log('[HomePage] updateEntryFile 完成');
            updateProjectStatus(validation.ok ? 'ready' : 'draft');
            finishGeneration();
            setIsGenerating(false);

            // 组合完整的 LLM 输出（分析 + 生成内容）
            const singleBuffer = useChatStore.getState().streamBuffer;
            const fullContent = [
              singleBuffer.analyzeText,
              singleBuffer.generateText,
            ].filter(Boolean).join('\n\n').trim();

            if (validation.ok) {
              // 保存版本快照
              const summary = '生成应用';
              const isFirstVersion = useProjectStore.getState().versions.length === 0;
              saveVersion(summary, isFirstVersion ? 'initial' : 'iteration');

              // 添加完整消息：优先使用 LLM 输出，fallback 到简短提示
              addMessage({
                role: 'assistant',
                content: fullContent || '应用已生成完成！你可以继续描述需求来修改它。'
              });
              toast.success('生成完成');
            } else {
              const warningMsg = `生成完成，但代码存在 ${validation.issues.length} 个问题，可能影响功能`;
              addMessage({
                role: 'assistant',
                content: fullContent || warningMsg
              });
              toast.info(warningMsg);
              console.warn('[HomePage] 验证问题:', validation.issues);
            }

            // 清除 UI 状态
            setPendingMessageId(null);
            setMessageUIState(null);
          } else {
            // HTML 为空，这是真正的错误
            const errorMsg = '生成的代码为空，请重试';
            console.error('[HomePage] HTML 为空');
            setError(errorMsg);
            revertProjectStatusAfterFailure();
            finishGeneration();
            setIsGenerating(false);
            toast.error(errorMsg);
            setMessageUIState(prev => prev ? { ...prev, status: 'error' } : null);
            addMessage({ role: 'assistant', content: errorMsg });
            setPendingMessageId(null);
          }
          break;
        }
        case 'error':
          setError(event.payload.message);
          revertProjectStatusAfterFailure();
          finishGeneration();
          setIsGenerating(false);
          toast.error(event.payload.message, 6000);
          // 更新 UI 状态为错误
          setMessageUIState(prev => prev ? { ...prev, status: 'error' } : null);
          // 添加错误消息到持久化
          addMessage({ role: 'assistant', content: event.payload.message });
          setPendingMessageId(null);
          break;
        case 'approval_required': {
          // 分析完成，等待批准。不调用 finishGeneration，避免 stage 变成 done
          setAwaitingApproval(true);
          setIsGenerating(false);
          // 更新消息状态，显示分析结果和批准按钮
          const features = event.payload.features;
          const sessionId = event.payload.sessionId;
          setMessageUIState(prev => {
            const base = prev ? {
              ...prev,
              steps: (prev.steps || 0) + 1,
            } : {
              steps: 1,
            };
            return {
              ...base,
              status: 'waiting_approval',
              ...(features ? { features } : {}),
              ...(sessionId ? { sessionId } : {}),
            };
          });
          break;
        }
      }
    },
    [updateStage, appendDelta, updateEntryFile, updateFiles, updateProjectStatus, setError, addMessage, setAwaitingApproval]
  );

  // 批准后继续生成
  const handleApprove = useCallback(async (sessionId: string) => {
    setAwaitingApproval(false); // 清除等待批准状态
    setIsGenerating(true);
    updateProjectStatus('generating');
    startGeneration(`approve-${Date.now()}`);

    // 更新消息状态为处理中
    setMessageUIState(prev => prev ? { ...prev, status: 'processing' } : { steps: 0, status: 'processing' });

    try {
      await approveAndContinue(sessionId, handleStreamEvent);
    } catch (error) {
      const errorMsg = '生成过程发生异常，请重试';
      setError(errorMsg);
      revertProjectStatusAfterFailure();
      setIsGenerating(false);
      toast.error(errorMsg);
      setMessageUIState(prev => prev ? { ...prev, status: 'error' } : null);
      addMessage({ role: 'assistant', content: errorMsg });
      setPendingMessageId(null);
    }
  }, [handleStreamEvent, updateProjectStatus, startGeneration, setError, addMessage, setAwaitingApproval]);

  /**
   * 执行一次三阶段流水线生成。
   * @param userMessage 展示在对话区的用户消息（原始需求）
   * @param llmPrompt 实际发给模型的内容（原始需求或附带结构化文档的富输入）
   * @param opts 附加选项（如 intentOverride、images）
   */
  const runGeneration = useCallback(async (userMessage: string, llmPrompt: string, opts?: { intentOverride?: 'create' | 'modify' | 'analyze' | 'diagnose'; images?: string[] | undefined }) => {
    if (!userMessage.trim() || isGenerating) return;

    setIsGenerating(true);

    // 确保项目存在（首条用户消息才能入库）
    const project = currentProject ?? createProject('未命名项目', selectedFramework);

    // 判断是否为迭代：存在历史对话 或 已有实质性生成内容（非空白骨架）
    const priorChat = project.chat ?? [];
    // 检查是否有实质内容：入口文件内容超过骨架模板（约 250 字符）才算有内容
    const entryContent = project.files[ENTRY_FILE_PATH]?.content ?? '';
    const hasSubstantialContent = entryContent.length > 300 || Object.keys(project.files).some(p => p !== ENTRY_FILE_PATH);
    const isIteration = priorChat.length > 0 || hasSubstantialContent;

    // 调试日志：追踪 framework 参数传递
    console.log('[HomePage] runGeneration 参数追踪:', {
      selectedFramework,
      projectFramework: project.framework,
      isIteration,
      priorChatLength: priorChat.length,
      entryContentLength: entryContent.length,
      hasSubstantialContent,
      willUseFramework: isIteration ? (project.framework ?? 'html') : selectedFramework,
    });

    // 添加用户消息到持久化层（包含图片）
    addMessage({ role: 'user', content: userMessage, images: opts?.images });
    updateProjectStatus('generating');

    // 后台提取项目偏好：从用户消息中识别纠正（如"不要渐变"）与风格偏好（如"深色模式"）
    const extractedPrefs = extractPreferences(project.id, userMessage);
    if (extractedPrefs.length > 0) {
      console.log('[HomePage] 已提取项目偏好:', extractedPrefs.map(p => `${p.key}=${p.value}`));
    }

    // 获取 AI API
    const baseURL = getEffectiveBaseURL();
    const api = getAIAPI(apiKey, baseURL);

    // 开始生成
    const runId = `run-${Date.now()}`;
    startGeneration(runId);

    // 设置当前正在生成的消息 UI 状态
    const assistantId = `msg-${Date.now() + 1}`;
    setPendingMessageId(assistantId);
    setMessageUIState({ steps: 0, status: 'processing' });

    try {
      // 构建 currentFiles：优先使用 project.files，fallback 到 generatedHtml
      const filesFromProject = Object.entries(project.files)
        .filter(([path, node]) => path !== ENTRY_FILE_PATH || (node.content && node.content.includes('</html>')))
        .map(([path, node]) => [path, { path: node.path, content: node.content, language: node.language }]);

      // 如果 project.files 为空但有 generatedHtml，用 generatedHtml 作为 fallback
      const filesToSend = filesFromProject.length > 0
        ? Object.fromEntries(filesFromProject)
        : generatedHtml
          ? { [ENTRY_FILE_PATH]: { path: ENTRY_FILE_PATH, content: generatedHtml, language: 'html' as const } }
          : {};

      // 构建生成选项
      const baseOpts: GenerateOptions = {
        // 目标框架：首次创建用 selectedFramework，迭代修改用项目的 framework
        framework: isIteration ? (project.framework ?? 'html') : selectedFramework,
        ...(isIteration ? {
          currentHtml: generatedHtml,
          currentFiles: filesToSend,
          // 最近 12 条对话（用户+助手交替），前端预裁剪每条上限 2000 字符
          chatTurns: priorChat.slice(-12)
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({
              role: m.role as 'user' | 'assistant',
              content: m.content.slice(0, 2000)
            })),
        } : {}),
      };

      // 原始需求：首条用户消息（仅在迭代时添加）
      const firstUserContent = priorChat.find(m => m.role === 'user')?.content?.slice(0, 300);

      // 加载记忆：项目偏好 + 全局偏好
      const memory = loadMemoryForGeneration(project.id);

      const generateOpts: GenerateOptions = {
        ...baseOpts,
        ...(firstUserContent ? { originalRequest: firstUserContent } : {}),
        ...(memory.projectPreferences.length > 0 ? { preferences: memory.projectPreferences } : {}),
        ...(memory.globalPreferences ? { globalPreferences: memory.globalPreferences } : {}),
        ...(opts?.intentOverride ? { intentOverride: opts.intentOverride } : {}),
      };

      // 调试日志：最终发送的 generateOpts
      console.log('[HomePage] 最终 generateOpts:', {
        framework: generateOpts.framework,
        hasCurrentFiles: !!generateOpts.currentFiles,
        hasChatTurns: !!generateOpts.chatTurns,
        chatTurnsLength: generateOpts.chatTurns?.length || 0,
      });

      await api.generateStream(llmPrompt, handleStreamEvent, generateOpts);
    } catch (error) {
      const errorMsg = '生成过程发生异常，请重试';
      setError(errorMsg);
      revertProjectStatusAfterFailure();
      setIsGenerating(false);
      toast.error(errorMsg);
      // 更新 UI 状态为错误
      setMessageUIState(prev => prev ? { ...prev, status: 'error' } : null);
      addMessage({ role: 'assistant', content: errorMsg });
      setPendingMessageId(null);
    }
  }, [
    isGenerating,
    currentProject,
    createProject,
    updateProjectStatus,
    apiKey,
    getEffectiveBaseURL,
    startGeneration,
    handleStreamEvent,
    generatedHtml,
    selectedFramework,
    setError,
    addMessage,
  ]);

  // 清空图片
  const handleClearImages = useCallback(() => {
    setPastedImages([]);
  }, []);

  // 直接生成：跳过优化器，以原始输入进入流水线
  const handleSubmit = useCallback(() => {
    if (!inputValue.trim() || isGenerating || isOptimizing) return;

    // F-001: 未登录时阻止创建，跳转到登录页
    if (!isLoggedIn) {
      navigate('/login?redirect=%2Fworkspace');
      return;
    }

    const prompt = inputValue.trim();

    // 检查是否为命令
    const parsed = parseCommandInput(prompt);
    if (parsed.isCommand && parsed.commandName) {
      // 构建命令上下文
      const commandContext: CommandContext = {
        clearChat: () => {
          // 清空对话
          useProjectStore.getState().clearChat();
        },
        createNewProject: () => {
          // 新建项目：跳转到项目列表
          navigate('/projects');
        },
        exportProject: async () => {
          // 导出项目
          if (!currentProject) {
            toast.error('没有可导出的项目');
            return;
          }
          try {
            const { exportProjectAsZip } = await import('../services/export/zipExporter');
            await exportProjectAsZip(currentProject);
            toast.success('ZIP 包已开始下载');
          } catch (error) {
            const msg = error instanceof Error ? error.message : '导出失败，请稍后重试';
            toast.error(msg);
          }
        },
        showToast: (message, type = 'info') => {
          if (type === 'success') toast.success(message);
          else if (type === 'error') toast.error(message);
          else toast.info(message);
        },
      };
      // 添加可选的 projectId
      if (currentProject?.id) {
        commandContext.projectId = currentProject.id;
      }

      void executeCommand(parsed.commandName, parsed.args ?? '', commandContext);
      setInputValue('');
      setShowCommandDropdown(false);
      return;
    }

    setInputValue('');
    setShowCommandDropdown(false);

    // 提取并更新全局偏好（如"以后都用 React"）
    extractAndUpdateGlobalPreferences(prompt);

    // 检查是否为 Recall 查询（查询偏好）
    if (isRecallQuery(prompt)) {
      const memory = loadMemoryForGeneration(currentProject?.id);
      const response = generateRecallResponse(memory);
      // 添加用户消息（包含图片）
      addMessage({ role: 'user', content: prompt, images: pastedImages.length > 0 ? pastedImages : undefined });
      // 添加 AI 响应
      addMessage({ role: 'assistant', content: response });
      // 清空图片
      handleClearImages();
      return;
    }

    // 保存当前图片列表，避免清空后丢失
    const imagesToSend = pastedImages.length > 0 ? [...pastedImages] : undefined;
    handleClearImages();

    void runGeneration(prompt, prompt, { images: imagesToSend });
  }, [inputValue, isGenerating, isOptimizing, isLoggedIn, navigate, runGeneration, currentProject, addMessage, pastedImages, handleClearImages]);

  // 帮我完善需求：触发提示词优化器（需求确认前置流程）
  const handleStartOptimize = useCallback(() => {
    if (!inputValue.trim() || isGenerating || isOptimizing) return;

    if (!isLoggedIn) {
      navigate('/login?redirect=%2Fworkspace');
      return;
    }

    void useOptimizerStore.getState().startOptimize(inputValue.trim());
  }, [inputValue, isGenerating, isOptimizing, isLoggedIn, navigate]);

  // 取消：优化中取消请求；确认阶段放弃本次需求（回到输入状态，不产生文件变更）
  const handleOptimizerCancel = useCallback(() => {
    if (useOptimizerStore.getState().isOptimizing) {
      useOptimizerStore.getState().cancelOptimize();
      toast.info('已取消需求分析');
      return;
    }
    useOptimizerStore.getState().skip();
    toast.info('已取消本次需求，可继续修改描述');
  }, []);

  // 优化失败后重试
  const handleOptimizerRetry = useCallback(() => {
    const prompt = useOptimizerStore.getState().originalPrompt;
    if (!prompt) return;
    void useOptimizerStore.getState().startOptimize(prompt);
  }, []);

  // 一键接受：按当前结构化需求进入流水线
  const handleOptimizerAccept = useCallback(() => {
    const store = useOptimizerStore.getState();
    store.accept();
    const confirmed = useOptimizerStore.getState().buildConfirmedRequirement();
    if (!confirmed) return;
    useOptimizerStore.getState().reset();
    setInputValue('');
    void runGeneration(confirmed.originalPrompt, composePipelinePrompt(confirmed));
  }, [runGeneration]);

  // 编辑后接受：携带修改后的需求进入流水线
  const handleOptimizerAcceptWithEdits = useCallback((edited: OptimizedRequirement, notes: string) => {
    const store = useOptimizerStore.getState();
    store.acceptWithEdits(edited, notes);
    const confirmed = useOptimizerStore.getState().buildConfirmedRequirement();
    if (!confirmed) return;
    useOptimizerStore.getState().reset();
    setInputValue('');
    void runGeneration(confirmed.originalPrompt, composePipelinePrompt(confirmed));
  }, [runGeneration]);

  /**
   * 意图纠正：取消当前生成，使用 intentOverride 重新调用 API
   */
  const handleIntentCorrect = useCallback((intentOverride: 'create' | 'modify' | 'analyze' | 'diagnose') => {
    // 取消当前生成
    cancelActiveRun();
    finishGeneration();
    setIsGenerating(false);

    // 清空当前缓冲区
    setIntent(null);

    // 使用 intentOverride 重新调用 API
    const lastUserMessage = currentProject?.chat.filter(m => m.role === 'user').pop()?.content;
    if (!lastUserMessage) {
      toast.error('无法重新生成，未找到上次输入');
      return;
    }

    // 重新生成
    void runGeneration(lastUserMessage, lastUserMessage, { intentOverride });
  }, [currentProject?.chat, finishGeneration, setIntent, runGeneration]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // 快捷键处理函数
  const handleCancel = useCallback(() => {
    if (isGenerating) {
      cancelActiveRun();
      finishGeneration();
      setIsGenerating(false);
      setMessageUIState(prev => prev ? { ...prev, status: 'error' } : null);
      toast.info('已停止生成');
    }
  }, [isGenerating, finishGeneration]);

  const handleClearChat = useCallback(() => {
    if (!currentProject) {
      toast.info('当前没有项目');
      return;
    }
    if (isGenerating) {
      toast.info('请先停止生成');
      return;
    }
    useProjectStore.getState().clearChat();
    toast.success('对话已清空');
  }, [currentProject, isGenerating]);

  const handleNewProject = useCallback(() => {
    if (isGenerating) {
      toast.info('请先停止生成');
      return;
    }
    useProjectStore.getState().newProject();
    navigate('/workspace');
    toast.success('已创建新项目');
  }, [isGenerating, navigate]);

  const handleExport = useCallback(async () => {
    if (!currentProject) {
      toast.error('没有可导出的项目');
      return;
    }
    if (isExporting) return;
    setIsExporting(true);
    try {
      const { exportProjectAsZip } = await import('../services/export/zipExporter');
      await exportProjectAsZip(currentProject);
      toast.success('ZIP 包已开始下载');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '导出失败，请稍后重试';
      toast.error(msg);
    } finally {
      setIsExporting(false);
    }
  }, [currentProject, isExporting]);

  // 注册全局快捷键
  useKeybinding([
    { key: 'Enter', ctrl: true, action: handleSubmit, description: '提交输入' },
    { key: 'Escape', action: handleCancel, description: '取消生成' },
    { key: 'l', ctrl: true, action: handleClearChat, description: '清空对话' },
    { key: 'n', ctrl: true, action: handleNewProject, description: '新建项目' },
    { key: 'e', ctrl: true, action: handleExport, description: '导出项目' },
  ]);

  /**
   * 处理文件（图片）添加
   * - 检查文件类型
   * - 检查文件大小
   * - 检查图片数量限制
   * - 转换为 Base64 Data URL
   */
  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      // 检查文件类型
      if (!IMAGE_CONFIG.allowedTypes.includes(file.type)) {
        toast.error(`不支持的图片格式：${file.name}`);
        continue;
      }

      // 检查文件大小
      if (file.size > IMAGE_CONFIG.maxSize) {
        toast.error(`图片 ${file.name} 超过 5MB 限制`);
        continue;
      }

      // 检查图片数量
      if (pastedImages.length >= IMAGE_CONFIG.maxCount) {
        toast.error('最多上传 4 张图片');
        return;
      }

      // 转换为 Base64
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          setPastedImages((prev) => [...prev, result]);
        }
      };
      reader.readAsDataURL(file);
    }
  }, [pastedImages.length]);

  /**
   * 处理粘贴事件
   */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      handleFiles(files);
    }
  }, [handleFiles]);

  /**
   * 处理拖拽进入
   */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  /**
   * 处理拖拽离开
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  /**
   * 处理拖拽悬停
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /**
   * 处理拖拽放置
   */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  }, [handleFiles]);

  /**
   * 删除已粘贴的图片
   */
  const handleRemoveImage = useCallback((index: number) => {
    setPastedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // 阶段图标映射
  const stageIcon = useMemo(() => {
    switch (streamBuffer.stage) {
      case 'analyzing':
        return 'lucide:search';
      case 'generating':
        return 'lucide:code-2';
      case 'reviewing':
        return 'lucide:eye';
      case 'done':
        return 'lucide:check-circle';
      case 'error':
        return 'lucide:alert-circle';
      default:
        return 'lucide:sparkles';
    }
  }, [streamBuffer.stage]);

  // 当前阶段标题：四角色现在进行时文案（参考 Claude Code 的 getActivityDescription）
  const stageTitle = useMemo(() => {
    switch (streamBuffer.stage) {
      case 'analyzing':
        // 分析师：正在分析功能
        return '正在分析功能...';
      case 'generating': {
        // 工程师：正在生成 <文件名>（有活跃文件时带文件名，类 Claude Code 的 "Writing index.html"）
        const activeFile = streamBuffer.activeFilePath
          ?? streamBuffer.files.find((f) => f.status === 'generating')?.name;
        if (activeFile) {
          const fileName = activeFile.split('/').pop() ?? activeFile;
          return `正在生成 ${fileName}...`;
        }
        return '正在生成代码...';
      }
      case 'reviewing':
        // 审查者：正在审查代码
        return '正在审查代码...';
      case 'done':
        return '完成';
      case 'error':
        return '出错';
      default:
        return '准备中';
    }
  }, [streamBuffer.stage, streamBuffer.activeFilePath, streamBuffer.files]);

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-base)]">
      {/* Header */}
      <header className="h-14 flex items-center justify-between px-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/projects')}
            className="flex items-center gap-2 px-2 py-1 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-base)] transition-colors"
          >
            <Icon icon="lucide:sidebar" width={18} height={18} />
          </button>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)] font-[var(--font-display)]">Atoms</h1>
          {currentProject && (
            <span className="text-[12px] text-[var(--color-text-tertiary)]">{currentProject.name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 返回首页（落地页）入口 */}
          <Link
            to="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
            title="返回首页"
          >
            <Icon icon="lucide:home" width={14} height={14} />
            <span>首页</span>
          </Link>
          {/* 积分显示（模拟） */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-bg-base)] text-[12px] text-[var(--color-text-secondary)]">
            <Icon icon="lucide:coins" width={14} height={14} />
            <span>∞ 积分</span>
          </div>
          <HomeAuthControls />
        </div>
      </header>

      {/* Main: Left chat + Right preview */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chat Panel */}
        <div className="w-full md:w-1/2 lg:w-[45%] min-w-[400px] flex flex-col border-r border-[var(--color-border-default)]">
          {/* Chat messages area */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Welcome message：只要当前是新会话就展示（与历史项目无关） */}
            {messages.length === 0 && !isGenerating && !isOptimizing && (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-[var(--color-accent)]/10 flex items-center justify-center mx-auto mb-4">
                  <Icon icon="lucide:sparkles" width={24} height={24} className="text-[var(--color-accent)]" />
                </div>
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">你好，我是 Atoms</h2>
                <p className="text-[14px] text-[var(--color-text-secondary)] max-w-md mx-auto">
                  描述你想做的应用，我会帮你生成代码并实时预览。可以尝试下方的模板快速开始。
                </p>
              </div>
            )}

            {/* Template chips：与欢迎语同条件，新会话始终展示模板入口 */}
            {messages.length === 0 && !isGenerating && !isOptimizing && (
              <div className="flex flex-wrap justify-center gap-2 pb-4">
                {TEMPLATE_CHIPS.map((chip) => (
                  <button
                    key={chip.id}
                    onClick={() => handleChipClick(chip)}
                    disabled={isGenerating}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-[var(--color-text-secondary)] bg-[var(--color-bg-base)] border border-[var(--color-border-default)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Icon icon={chip.icon} width={14} height={14} />
                    {chip.label}
                  </button>
                ))}
              </div>
            )}

            {/* 消息列表 */}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} onApprove={handleApprove} />
            ))}

            {/* 流式生成中的消息：在消息列表末尾显示 LLM 的实时输出 */}
            {isGenerating && streamingText && (
              <StreamingMessage
                content={streamingText}
                stage={streamBuffer.stage}
                activeFilePath={streamBuffer.activeFilePath}
              />
            )}

            {/* 独立的批准面板：不依赖 chat 数组中的消息 */}
            {streamBuffer.awaitingApproval && messageUIState?.status === 'waiting_approval' && messageUIState?.features && (
              <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-default)] rounded-xl p-4">
                {/* 标题栏 */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <Icon icon="lucide:clipboard-check" width={20} height={20} className="text-amber-500" />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">分析完成</h3>
                    <p className="text-[12px] text-[var(--color-text-tertiary)]">请确认功能清单后批准生成</p>
                  </div>
                </div>

                {/* 功能清单 */}
                {isFeatureList(messageUIState.features) && (
                  <div className="mb-4">
                    <h4 className="text-[12px] font-medium text-[var(--color-text-secondary)] mb-2">
                      {messageUIState.features.appTitle}
                    </h4>
                    <div className="space-y-1.5">
                      {messageUIState.features.features.map((f) => (
                        <div key={f.id} className="flex items-start gap-2">
                          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                            f.priority === 'must'
                              ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                              : 'bg-[var(--color-text-tertiary)]/10 text-[var(--color-text-secondary)]'
                          }`}>
                            {f.priority === 'must' ? '必须' : '可选'}
                          </span>
                          <span className="text-[13px] text-[var(--color-text-primary)]">{f.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="flex items-center gap-3 pt-3 border-t border-[var(--color-border-default)]">
                  <button
                    onClick={() => {
                      // 取消批准，重置状态
                      setAwaitingApproval(false);
                      setMessageUIState(null);
                      finishGeneration();
                      toast.info('已取消生成');
                    }}
                    className="px-4 py-2 rounded-lg text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-base)] transition-colors"
                  >
                    取消
                  </button>
                  {messageUIState.sessionId && (
                    <button
                      onClick={() => handleApprove(messageUIState.sessionId!)}
                      className="flex-1 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-[13px] font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
                    >
                      批准并生成
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 需求确认面板：优化器流式分析中 / 待确认 / 优化失败 */}
            {(isOptimizing || optimizerResult || optimizerError) && (
              <RequirementPanel
                requirement={optimizerResult}
                isOptimizing={isOptimizing}
                streamText={optimizerStreamText}
                error={optimizerError}
                originalPrompt={optimizerOriginalPrompt}
                onAccept={handleOptimizerAccept}
                onAcceptWithEdits={handleOptimizerAcceptWithEdits}
                onCancel={handleOptimizerCancel}
                onRetry={handleOptimizerRetry}
              />
            )}

            {/* 生成状态面板 */}
            {isGenerating && (
              <div className="space-y-3">
                {/* 阶段进度 */}
                <div className="bg-[var(--color-bg-base)] rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      streamBuffer.stage === 'error' ? 'bg-red-500/10' : 'bg-[var(--color-accent)]/10'
                    }`}>
                      <Icon
                        icon={stageIcon}
                        width={16}
                        height={16}
                        className={streamBuffer.stage === 'error' ? 'text-red-500' : 'text-[var(--color-accent)]'}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[14px] font-medium text-[var(--color-text-primary)]">
                          {stageTitle}
                        </span>
                        <span className="text-[12px] text-[var(--color-text-tertiary)]">
                          {streamBuffer.stageMessage}
                        </span>
                      </div>
                      {/* 进度条 */}
                      <div className="flex gap-1.5 mt-2">
                        {['analyzing', 'generating', 'reviewing'].map((stage, i) => (
                          <div
                            key={stage}
                            className={`h-1 flex-1 rounded-full transition-colors ${
                              streamBuffer.stage === stage
                                ? 'bg-[var(--color-accent)]'
                                : ['generating', 'reviewing'].includes(streamBuffer.stage) && i < ['analyzing', 'generating', 'reviewing'].indexOf(streamBuffer.stage)
                                  ? 'bg-green-500'
                                  : 'bg-[var(--color-border-default)]'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 意图识别结果 */}
                  {streamBuffer.intent && (
                    <div className="space-y-2 pt-3 border-t border-[var(--color-border-default)]">
                      {/* 意图类型 */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-[var(--color-text-tertiary)]">识别为</span>
                        <span className={`text-[12px] px-2 py-0.5 rounded ${INTENT_CONFIG[streamBuffer.intent.type]?.bgColor || ''} ${INTENT_CONFIG[streamBuffer.intent.type]?.color || ''}`}>
                          {INTENT_CONFIG[streamBuffer.intent.type]?.label || streamBuffer.intent.type}
                        </span>
                        {streamBuffer.intent.confidence < 0.7 && (
                          <span title="置信度较低，建议检查">
                            <Icon icon="lucide:alert-triangle" width={12} height={12} className="text-amber-500" />
                          </span>
                        )}
                        <span className="text-[11px] text-[var(--color-text-tertiary)]">
                          {Math.round(streamBuffer.intent.confidence * 100)}% 置信度
                        </span>

                        {/* 纠正按钮组：confidence < 0.8 时显示 */}
                        {streamBuffer.intent.confidence < 0.8 && (
                          <div className="flex items-center gap-1 ml-auto">
                            {(['create', 'modify', 'analyze', 'diagnose'] as const).map((intentType) => {
                              if (intentType === streamBuffer.intent?.type) return null;
                              const config = INTENT_CONFIG[intentType];
                              return (
                                <button
                                  key={intentType}
                                  onClick={() => handleIntentCorrect(intentType)}
                                  className={`text-[11px] px-2 py-0.5 rounded border border-[var(--color-border-default)] hover:border-[var(--color-border-strong)] ${config?.color || ''} hover:${config?.bgColor || ''} transition-colors`}
                                >
                                  改为{config?.label || intentType}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* 框架建议 */}
                      {streamBuffer.intent.suggestedFramework && streamBuffer.intent.suggestedFramework !== 'html' && (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-[var(--color-text-tertiary)]">自动识别框架</span>
                          <span className="text-[12px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-500">
                            {streamBuffer.intent.suggestedFramework === 'react-cdn' ? 'React' :
                             streamBuffer.intent.suggestedFramework === 'vue-cdn' ? 'Vue' :
                             streamBuffer.intent.suggestedFramework}
                          </span>
                          <Icon icon="lucide:sparkles" width={12} height={12} className="text-[var(--color-text-tertiary)]" />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 文件面板：实时生成进度（文件名 + 状态点） */}
                {streamBuffer.files.length > 0 && (
                  <div className="bg-[var(--color-bg-base)] rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2 text-[12px] text-[var(--color-text-tertiary)]">
                      <Icon icon="lucide:folder-open" width={12} height={12} />
                      <span>项目文件</span>
                      <span className="ml-auto tabular-nums">
                        {streamBuffer.files.filter((f) => f.status === 'completed').length}/{streamBuffer.files.length}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {streamBuffer.files.map((file) => (
                        <FileTreeItem
                          key={file.path}
                          file={file}
                          isActive={file.status === 'generating'}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 生成完成：仅在真正完成（非等待批准状态）且无消息时显示 */}
            {generatedHtml && !isGenerating && streamBuffer.stage === 'done' && !streamBuffer.awaitingApproval && messages.length === 0 && (
              <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 text-green-500 mb-2">
                  <Icon icon="lucide:check-circle" width={16} height={16} />
                  <span className="text-[13px] font-medium">生成完成</span>
                </div>
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  应用已生成，你可以在右侧预览查看效果。继续描述需求可以修改应用。
                </p>
              </div>
            )}

            {/* 变更确认面板：diff 模式下等待用户批准 */}
            {pendingDiff && (
              <DiffViewer
                diff={{
                  changes: pendingDiff.changes.changes.map((c) => ({
                    path: c.file,
                    edits: c.edits.map((e) => ({
                      line: e.line,
                      old: e.old,
                      new: e.new,
                      type: e.type,
                    })),
                  })),
                  summary: pendingDiff.changes.summary,
                }}
                onAccept={() => {
                  // 应用变更
                  const entryPath = ENTRY_FILE_PATH;
                  const entryContent = pendingDiff.files[entryPath]?.content ?? '';
                  const validation = validateGeneratedHtml(entryContent);

                  updateFiles(pendingDiff.files, entryPath);
                  updateProjectStatus(validation.ok ? 'ready' : 'draft');

                  if (validation.ok) {
                    const summary = `应用变更：${pendingDiff.changes.summary}`;
                    saveVersion(summary, 'iteration');
                    addMessage({ role: 'assistant', content: '变更已应用。' });
                    toast.success('变更已应用');
                  } else {
                    const warningMsg = `变更已应用，但代码存在 ${validation.issues.length} 个问题`;
                    addMessage({ role: 'assistant', content: warningMsg });
                    toast.info(warningMsg);
                  }

                  setPendingDiff(null);
                }}
                onReject={() => {
                  // 拒绝变更
                  addMessage({ role: 'assistant', content: '变更已取消，代码保持原样。' });
                  toast.info('变更已取消');
                  setPendingDiff(null);
                }}
              />
            )}

            {/* 审查摘要：确定性校验/构建日志折叠为单行，点击展开详情 */}
            {!isGenerating && reviewChecks && reviewChecks.length > 0 && (
              <ReviewSummary checks={reviewChecks} />
            )}
          </div>

          {/* Input area */}
          <div className="p-4 border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
            {/* 停止按钮：生成中时显示 */}
            {isGenerating && (
              <button
                onClick={() => {
                  cancelActiveRun();
                  finishGeneration();
                  setIsGenerating(false);
                  setMessageUIState(prev => prev ? { ...prev, status: 'error' } : null);
                  toast.info('已停止生成');
                }}
                className="w-full mb-3 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
              >
                <Icon icon="lucide:square" width={14} height={14} />
                <span className="text-[13px] font-medium">停止生成</span>
              </button>
            )}

            {/* 图片预览 */}
            {pastedImages.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] text-[var(--color-text-tertiary)]">
                    已粘贴 {pastedImages.length} 张图片
                  </span>
                  <button
                    onClick={handleClearImages}
                    className="text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                  >
                    清空全部
                  </button>
                </div>
                <ImagePreview images={pastedImages} onRemove={handleRemoveImage} />
              </div>
            )}

            {/* 输入框容器：支持拖拽 */}
            <div
              className="relative"
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {/* 命令下拉 */}
              <CommandDropdown
                input={inputValue}
                visible={showCommandDropdown && !isGenerating && !isOptimizing}
                onSelect={(command) => {
                  setInputValue(`/${command.name} `);
                  setShowCommandDropdown(false);
                }}
                onClose={() => setShowCommandDropdown(false)}
              />

              {/* 拖拽覆盖层 */}
              {isDragging && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-accent)]/10 border-2 border-dashed border-[var(--color-accent)] rounded-xl">
                  <div className="text-center">
                    <Icon icon="lucide:upload" width={24} height={24} className="mx-auto mb-2 text-[var(--color-accent)]" />
                    <p className="text-[13px] text-[var(--color-accent)]">拖拽图片到此处上传</p>
                  </div>
                </div>
              )}

              <textarea
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={
                  isGenerating ? '正在生成中...' :
                  isOptimizing ? '正在分析需求...' :
                  isLoggedIn ? '让智能体团队实现你的想法' : '登录后开始创建应用'
                }
                disabled={isGenerating || isOptimizing || !isLoggedIn}
                onClick={() => {
                  // F-001: 未登录时点击输入框跳转到登录页
                  if (!isLoggedIn) {
                    navigate('/login?redirect=%2Fworkspace');
                  }
                }}
                className={`w-full bg-[var(--color-bg-base)] border border-[var(--color-border-default)] rounded-xl px-4 py-3 pr-12 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] resize-none outline-none focus:border-[var(--color-border-strong)] transition-colors disabled:opacity-50 disabled:cursor-pointer ${!isLoggedIn ? 'cursor-pointer' : ''}`}
                rows={2}
              />
              <button
                onClick={handleSubmit}
                disabled={!inputValue.trim() || isGenerating || isOptimizing}
                className="absolute right-3 bottom-3 flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-accent)] text-white disabled:bg-transparent disabled:text-[var(--color-text-tertiary)] disabled:border disabled:border-[var(--color-border-default)] transition-all hover:bg-[var(--color-accent-hover)] active:scale-95"
              >
                <Icon icon={isGenerating ? 'lucide:loader-circle' : 'lucide:send'} width={16} height={16} className={isGenerating ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="flex items-center justify-between mt-2 gap-2">
              <div className="flex items-center gap-3">
                <p className="text-[11px] text-[var(--color-text-tertiary)] shrink-0">
                  按 Enter 发送 · Shift+Enter 换行
                </p>
                <div className="w-px h-3 bg-[var(--color-border-default)]" />
                <p className="text-[11px] text-[var(--color-text-tertiary)] shrink-0">
                  支持粘贴或拖拽图片
                </p>
                <div className="w-px h-3 bg-[var(--color-border-default)]" />
                <p className="text-[11px] text-[var(--color-text-tertiary)] shrink-0">
                  输入 / 使用命令
                </p>
              </div>
              <div className="flex items-center gap-2">
                {optimizerEnabled && (
                  <button
                    onClick={handleStartOptimize}
                    disabled={!inputValue.trim() || isGenerating || isOptimizing}
                    title="AI 先梳理需求并生成结构化文档，确认后再开始生成"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-[var(--color-accent)] border border-[var(--color-accent)]/40 hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Icon icon="lucide:sparkles" width={13} height={13} />
                    帮我完善需求
                  </button>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={!inputValue.trim() || isGenerating || isOptimizing}
                  title="跳过需求分析，直接开始生成"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Icon icon="lucide:play" width={13} height={13} />
                  直接生成
                </button>
                {generatedHtml && (
                  <button
                    onClick={async () => {
                      try {
                        // 收集所有文件用于分享
                        const files = currentProject?.files ? Object.fromEntries(
                          Object.entries(currentProject.files).map(([path, node]) => [
                            path,
                            { path, content: node.content, language: node.language }
                          ])
                        ) : undefined;
                        const shareId = await saveShare(generatedHtml, currentProject?.name, files);
                        const shareUrl = getShareUrl(shareId);
                        await copyToClipboard(shareUrl);
                        toast.success('分享链接已复制到剪贴板');
                      } catch (error) {
                        // apiClient 已对 401 统一处理（提示会话过期并跳转登录）
                        // 此处只处理非 401 错误
                        const isAuthError = error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 401;
                        if (!isAuthError) {
                          const message = error instanceof Error ? error.message : '分享失败，请稍后重试';
                          toast.error(message);
                        }
                      }
                    }}
                    className="flex items-center gap-1 text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                  >
                    <Icon icon="lucide:share" width={12} height={12} />
                    复制分享链接
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Preview Panel */}
        <div className="hidden md:flex flex-1 min-w-[500px] flex-col bg-[var(--color-bg-base)]">
          {/* Preview header with full toolbar */}
          <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
            <div className="flex items-center gap-1">
              {/* Tab buttons */}
              <button
                onClick={() => setViewTab('preview')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors ${
                  viewTab === 'preview'
                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Icon icon="lucide:play" width={14} height={14} />
                预览
              </button>
              <button
                onClick={() => setViewTab('code')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors ${
                  viewTab === 'code'
                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Icon icon="lucide:code-2" width={14} height={14} />
                代码
              </button>

              {/* Divider */}
              <div className="w-px h-5 bg-[var(--color-border-default)] mx-2" />

              {/* 版本历史按钮（仅在代码视图显示） */}
              {viewTab === 'code' && <VersionHistory />}

              {/* Divider */}
              <div className="w-px h-5 bg-[var(--color-border-default)] mx-2" />

              {/* 设备切换已移至 SandboxFrame 组件内 */}
            </div>

            <div className="flex items-center gap-1">
              {/* Reload */}
              <button
                onClick={() => {
                  // 触发 iframe 重新加载
                  const iframe = document.querySelector('iframe');
                  if (iframe && generatedHtml) {
                    iframe.srcdoc = generatedHtml;
                  }
                }}
                disabled={!generatedHtml}
                className="p-1.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] disabled:opacity-50 transition-colors"
                title="重新加载"
              >
                <Icon icon="lucide:refresh-cw" width={16} height={16} />
              </button>

              {/* Share link */}
              {generatedHtml && (
                <button
                  onClick={async () => {
                    try {
                      // 收集所有文件用于分享
                      const files = currentProject?.files ? Object.fromEntries(
                        Object.entries(currentProject.files).map(([path, node]) => [
                          path,
                          { path, content: node.content, language: node.language }
                        ])
                      ) : undefined;
                      const shareId = await saveShare(generatedHtml, currentProject?.name, files);
                      const shareUrl = getShareUrl(shareId);
                      await copyToClipboard(shareUrl);
                      toast.success('分享链接已复制');
                    } catch (error) {
                      // apiClient 已对 401 统一处理（提示会话过期并跳转登录）
                      // 此处只处理非 401 错误
                      const isAuthError = error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 401;
                      if (!isAuthError) {
                        const message = error instanceof Error ? error.message : '分享失败，请稍后重试';
                        toast.error(message);
                      }
                    }
                  }}
                  className="p-1.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                  title="分享链接"
                >
                  <Icon icon="lucide:share" width={16} height={16} />
                </button>
              )}

              {/* Export ZIP */}
              {generatedHtml && currentProject && (
                <button
                  onClick={async () => {
                    if (isExporting) return;
                    setIsExporting(true);
                    try {
                      // 动态导入：仅在导出时加载 jszip（约 95KB）
                      const { exportProjectAsZip } = await import('../services/export/zipExporter');
                      await exportProjectAsZip(currentProject);
                      toast.success('ZIP 包已开始下载');
                    } catch (error) {
                      const msg = error instanceof Error ? error.message : '导出失败，请稍后重试';
                      toast.error(msg);
                    } finally {
                      setIsExporting(false);
                    }
                  }}
                  disabled={isExporting}
                  className="p-1.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] disabled:opacity-50 transition-colors"
                  title={isExporting ? '正在打包下载...' : '导出代码为 ZIP'}
                >
                  <Icon
                    icon={isExporting ? 'lucide:loader-circle' : 'lucide:download'}
                    width={16}
                    height={16}
                    className={isExporting ? 'animate-spin' : ''}
                  />
                </button>
              )}

              {/* Deploy to server：功能代码保留，入口当前关闭（上线时把 DEPLOY_ENABLED 改为 true） */}
              {generatedHtml && currentProject && (
                <button
                  onClick={async () => {
                    if (!DEPLOY_ENABLED) {
                      toast.info('一键部署功能正在打磨中，即将上线，敬请期待');
                      return;
                    }
                    if (isDeploying) return;
                    setIsDeploying(true);
                    try {
                      const result = await deployProject(currentProject.id, currentProject.files);
                      await copyToClipboard(result.deployUrl);
                      toast.success(`部署成功，链接已复制：${result.deployUrl}`);
                    } catch (error) {
                      // 401 已由 apiClient 统一提示并跳转登录，此处不重复提示
                      if (!(error instanceof ApiError && error.status === 401)) {
                        const message = error instanceof ApiError ? error.message : '部署失败，请稍后重试';
                        toast.error(message);
                      }
                    } finally {
                      setIsDeploying(false);
                    }
                  }}
                  disabled={isDeploying}
                  className="p-1.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] disabled:opacity-50 transition-colors"
                  title={DEPLOY_ENABLED ? '部署到服务器' : '部署到服务器（即将上线）'}
                >
                  <Icon
                    icon={isDeploying ? 'lucide:loader-circle' : 'lucide:rocket'}
                    width={16}
                    height={16}
                    className={isDeploying ? 'animate-spin' : ''}
                  />
                </button>
              )}

              {/* Console toggle */}
              <button
                onClick={() => setShowConsole(!showConsole)}
                className={`p-1.5 rounded transition-colors ${
                  showConsole
                    ? 'bg-[var(--color-bg-base)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                }`}
                title="控制台"
              >
                <Icon icon="lucide:terminal" width={16} height={16} />
              </button>
            </div>
          </div>

          {/* Preview content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {viewTab === 'preview' ? (
              <>
                <div className="flex-1 flex items-center justify-center p-4">
                  {generatedHtml ? (
                    <div className="w-full h-full">
                      <SandboxFrame
                        html={generatedHtml}
                        files={currentProject?.files}
                        framework={currentProject?.framework ?? 'html'}
                      />
                    </div>
                  ) : (
                    <div className="text-center text-[var(--color-text-tertiary)]">
                      <Icon icon="lucide:monitor-play" width={48} height={48} className="mx-auto mb-4 opacity-50" />
                      <p className="text-[14px]">生成的应用将在这里预览</p>
                      <p className="text-[12px] mt-1">在左侧输入需求开始</p>
                    </div>
                  )}
                </div>

                {/* Console panel */}
                {showConsole && (
                  <div className="h-32 border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon icon="lucide:terminal" width={12} height={12} className="text-[var(--color-text-tertiary)]" />
                      <span className="text-[11px] text-[var(--color-text-tertiary)]">控制台</span>
                    </div>
                    <div className="text-[12px] text-[var(--color-text-secondary)] font-mono">
                      预览控制台输出将显示在这里...
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex overflow-hidden">
                {/* 文件树 */}
                <div className="w-48 shrink-0 border-r border-[var(--color-border-default)]">
                  <FileTreePanel
                    tree={fileTree}
                    activeFilePath={activeFilePath}
                    onFileSelect={handleFileSelect}
                    onFolderToggle={handleFolderToggle}
                  />
                </div>

                {/* 代码区 */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  {activeFileContent ? (
                    <>
                      <div className="px-4 py-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
                        <span className="text-[12px] text-[var(--color-text-tertiary)]">
                          {activeFilePath?.split('/').pop() ?? 'index.html'}
                        </span>
                        <span className="text-[12px] text-[var(--color-text-tertiary)] ml-4">
                          {(activeFileContent.length / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <div
                        ref={codeRef}
                        className="flex-1 overflow-auto p-4 font-mono text-[13px] leading-[1.6] bg-[var(--color-bg-surface)]"
                      >
                        <pre className="text-[var(--color-text-primary)]">
                          {highlightHtml(activeFileContent)}
                        </pre>
                      </div>
                    </>
                  ) : (
                    <div className="h-full flex items-center justify-center">
                      <div className="text-center text-[var(--color-text-tertiary)]">
                        <Icon icon="lucide:file-code" width={48} height={48} className="mx-auto mb-4 opacity-50" />
                        <p className="text-[14px]">生成的代码将在这里显示</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}