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
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore'; // F-001: 首页登录守卫
import { saveShare, getShareUrl } from '../utils/share';
import { deployProject } from '../utils/deploy';
import { ApiError } from '../services/apiClient';
import { getAIAPI, type StreamEvent, type GenerateOptions, validateGeneratedHtml, type DemoTemplateId, type FeatureList } from '../services/ai';
import { approveAndContinue } from '../services/ai/liveEngine';
import { cancelActiveRun } from '../services/ai/activeRun';
import { ENTRY_FILE_PATH, type ProjectFramework, type ChatMessage as ProjectChatMessage, type FileNode as ProjectFileNode, type ChangeList } from '../types/project';
import { loadMemoryForGeneration, isRecallQuery, generateRecallResponse, extractAndUpdateGlobalPreferences } from '../services/memory';
import { toast } from '../components/Toast';
import { HomeAuthControls } from '../components/AuthControls';
import SandboxFrame from '../components/SandboxFrame';
import ExportZipButton, { useZipExport } from '../components/ExportZipButton';
import { FileTreePanel, type TreeNode, buildTree } from '../components/FileTree';
import { RequirementPanel } from '../components/RequirementPanel';
import { VersionHistory } from '../components/VersionHistory';
import { useOptimizerStore } from '../stores/optimizerStore';
import type { ConfirmedRequirement, OptimizedRequirement } from '../services/ai/optimizer';
import { extractProgressInfo, parseReviewChecks } from '../utils/streamParser';
import { ReviewSummary } from '../components/ReviewSummary';
import { extractPreferences } from '../services/ai/preferenceExtractor';
import { StreamingMessage } from '../components/StreamingMessage';
import MessageRenderer from '../components/MessageRenderer';
import MessageErrorBoundary from '../components/MessageErrorBoundary';
import LongTextTruncate from '../components/LongTextTruncate';
import { ImagePreview } from '../components/ImagePreview';
import { CommandDropdown } from '../commands/CommandDropdown';
import { parseCommandInput, executeCommand, type CommandContext } from '../commands/index';
import { useKeybinding } from '../hooks/useKeybinding';
import { MessageGroupContainer, groupMessages } from '../components/MessageGroup';
import { looksStuck } from '../lib/progressEstimator';
import { BuildGroup } from '../components/BuildGroup';
import { DiffModal } from '../components/DiffModal';

/** 图片限制配置 */
const IMAGE_CONFIG = {
  maxSize: 5 * 1024 * 1024, // 5MB
  maxCount: 4,
  allowedTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'],
};

/**
 * 格式化运行时长（用于运行时钟显示）
 * @param ms 毫秒数
 * @returns 格式化后的时长字符串
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return '< 1分钟';
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 5) return `${minutes}分${secs}秒`;
  return `${minutes}分钟`;
}

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
  /** 变更清单（修改消息时携带，用于 diff 查看） */
  changes?: ChangeList;
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
  // 仅在有 changes 时添加 changes 属性（P1: diff 查看支持）
  if (msg.changes) {
    result.changes = msg.changes;
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

/** 意图类型到标签文案和颜色的映射 */
const INTENT_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  create: { label: '创建', color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  modify: { label: '修改', color: 'text-green-500', bgColor: 'bg-green-500/10' },
  analyze: { label: '分析', color: 'text-yellow-500', bgColor: 'bg-yellow-500/10' },
  diagnose: { label: '诊断', color: 'text-orange-500', bgColor: 'bg-orange-500/10' },
  conversation: { label: '对话', color: 'text-purple-500', bgColor: 'bg-purple-500/10' },
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

/** 消息气泡组件（类 atoms.dev 风格） */
function MessageBubble({
  message,
}: {
  message: UIMessage;
}) {
  const isUser = message.role === 'user';
  const [showDiffModal, setShowDiffModal] = useState(false);

  return (
    <>
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
            // 用户消息：纯文本显示；超长文本折叠展示，不全量渲染（MAJOR-D1 防护）
            <LongTextTruncate
              text={message.content}
              className="text-[13px] leading-[1.6] whitespace-pre-wrap"
            />
          ) : (
            // AI 消息：MessageRenderer（JSON 结构化渲染 + Markdown）。
            // 外层包消息级错误边界：单条消息渲染崩溃时降级为占位卡片，
            // 不向上抛、不拖垮对话面板（MAJOR-D1 前端兜底）
            <MessageErrorBoundary rawContent={message.content}>
              <MessageRenderer content={message.content} />
            </MessageErrorBoundary>
          )}

          {/* P1: 查看变更按钮（仅修改消息且有 changes 数据时显示） */}
          {!isUser && message.changes && (
            <div className="mt-3 pt-3 border-t border-[var(--color-border-default)]">
              <button
                onClick={() => setShowDiffModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors"
              >
                <Icon icon="lucide:git-compare" width={14} height={14} />
                <span className="text-[12px] font-medium">查看变更</span>
                <span className="text-[11px] text-green-500/70">
                  ({message.changes.changes.length} 个文件)
                </span>
              </button>
            </div>
          )}

          {/* 状态标签 */}
          {!isUser && message.status && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--color-border-default)]">
              <span className={`text-[11px] ${
                message.status === 'done' ? 'text-green-500' :
                message.status === 'error' ? 'text-red-500' :
                'text-[var(--color-accent)]'
              }`}>
                {message.status === 'done' ? '已处理' :
                 message.status === 'error' ? '处理失败' :
                 '处理中...'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* P1: DiffModal 弹窗 */}
      {message.changes && (
        <DiffModal
          open={showDiffModal}
          onClose={() => setShowDiffModal(false)}
          changes={message.changes}
        />
      )}
    </>
  );
}

// 图片上传待接入多模态管线后启用（当前生成管线仅接收文本：前端图片仅本地展示、服务端零接收）
// 恢复方式：改为 true 即可重新打开粘贴、拖拽、预览与"支持图片"文案，处理逻辑均保留未删
const IMAGE_UPLOAD_ENABLED = false;

export default function HomePage() {
  const [inputValue, setInputValue] = useState('');
  // 新项目的目标框架：仅在首条消息创建项目时生效，默认 html
  const [selectedFramework, setSelectedFramework] = useState<ProjectFramework>('html');
  const [isGenerating, setIsGenerating] = useState(false);
  const [viewTab, setViewTab] = useState<'preview' | 'code'>('preview');
  // deviceMode 已移至 SandboxFrame 组件（通过 useSettingsStore）
  const [showConsole, setShowConsole] = useState(false);
  // 当前正在生成的消息 ID（用于跟踪 UI 状态）
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  // 部署进行中标记（防重复点击）
  const [isDeploying, setIsDeploying] = useState(false);
  // 当前消息的 UI 状态（步骤数、status 等）
  const [messageUIState, setMessageUIState] = useState<{ steps: number; status: MessageStatus; features?: FeatureList | { raw: string }; sessionId?: string } | null>(null);
  // 已粘贴/拖拽的图片列表（Base64 Data URL）
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  // 是否正在拖拽图片（使用计数器避免子元素触发 dragLeave）
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  // 命令下拉是否可见
  const [showCommandDropdown, setShowCommandDropdown] = useState(false);
  // 重命名模态框
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  // 长对话滚动加载：初始显示 12 组，每次加载 12 组
  const INITIAL_VISIBLE_GROUPS = 12;
  const LOAD_STEP = 12;
  const [visibleGroupCount, setVisibleGroupCount] = useState(INITIAL_VISIBLE_GROUPS);
  const navigate = useNavigate();

  // F-001: 首页登录守卫
  const { user } = useAuthStore();
  const isLoggedIn = !!user;

  // 流式输出状态
  const streamBuffer = useChatStore((state) => state.streamBuffer);
  const reviewChecks = useChatStore((state) => state.reviewChecks);
  const restoreStartTime = useChatStore((state) => state.restoreStartTime);
  const streamingText = getCurrentPhaseText(streamBuffer);
  const scrollRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);

  // 运行时钟：每秒更新显示
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  // F-005: 步骤计数（用于卡住检测）
  const [stepCount, setStepCount] = useState<number>(0);

  // F-005: 上一次的 stage，用于检测 stage 变化
  const prevStageRef = useRef<string | null>(null);

  // F-002: 页面刷新时恢复运行时钟
  useEffect(() => {
    // 检查是否正在生成中（从 projectStore 获取当前 runId）
    const currentProjectState = useProjectStore.getState().currentProject;
    if (currentProjectState?.status === 'generating') {
      // 尝试从 sessionStorage 恢复 startTime
      const runId = streamBuffer.runId;
      if (runId) {
        restoreStartTime(runId);
      }
    }
  }, []); // 仅在首次渲染时执行

  // 运行时钟更新：生成中时每秒刷新
  useEffect(() => {
    if (isGenerating && streamBuffer.startTime) {
      const updateTimer = () => {
        setElapsedTime(Date.now() - streamBuffer.startTime!);
      };

      // 立即更新一次
      updateTimer();

      // 每秒更新
      const interval = setInterval(updateTimer, 1000);

      return () => clearInterval(interval);
    }
    // 非 generating 状态时重置
    setElapsedTime(0);
    return undefined;
  }, [isGenerating, streamBuffer.startTime]);

  // F-005: 步骤计数（监听 stage 变化）
  useEffect(() => {
    const currentStage = streamBuffer.stage;
    const prevStage = prevStageRef.current;

    // 如果 stage 变化且不是首次渲染，则增加步骤计数
    if (prevStage !== null && prevStage !== currentStage) {
      setStepCount((count) => count + 1);
    }

    // 更新 prevStage
    prevStageRef.current = currentStage;
  }, [streamBuffer.stage]);

  // F-005: 生成完成时重置步骤计数
  useEffect(() => {
    if (!isGenerating) {
      setStepCount(0);
      prevStageRef.current = null;
    }
  }, [isGenerating]);

  // F-005: 卡住检测
  const isStuck = useMemo(() => {
    if (!isGenerating || !streamBuffer.startTime) return false;
    return looksStuck(elapsedTime, stepCount, isGenerating);
  }, [isGenerating, streamBuffer.startTime, elapsedTime, stepCount]);

  // 渲染阶段立即判断：刷新/直接访问时清除当前项目（导航进入则保留）
  // 注意：必须在读取 currentProject 之前执行，避免先渲染旧项目再清除导致的闪烁
  const wasNavigatedRef = useRef<boolean | null>(null);
  if (wasNavigatedRef.current === null) {
    // 只在首次渲染时判断一次
    wasNavigatedRef.current = sessionStorage.getItem('litpp_nav_to_workspace') === 'true';
    sessionStorage.removeItem('litpp_nav_to_workspace');
    if (!wasNavigatedRef.current) {
      useProjectStore.getState().clearCurrentProject();
    }
  }

  // 当前项目的 HTML
  const currentProject = useProjectStore((state) => state.currentProject);
  const updateProjectName = useProjectStore((state) => state.updateProjectName);
  const generatedHtml = currentProject?.files[ENTRY_FILE_PATH]?.content ?? '';

  // ZIP 导出流程（按钮与 Ctrl+E 快捷键共享同一实例，防重复点击）
  const { isExporting, exportNow: exportProjectZip } = useZipExport(currentProject);

  // 项目总数（用于项目列表入口的数字徽章）
  const projectCount = useProjectStore((state) => state.summaries.length);

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

  // 打开重命名模态框时初始化输入值
  useEffect(() => {
    if (showRenameModal && currentProject) {
      setRenameValue(currentProject.name);
    }
  }, [showRenameModal, currentProject]);

  const { createProject, updateEntryFile, updateFiles, updateProjectStatus, addMessage, saveVersion } = useProjectStore();
  const { startGeneration, updateStage, appendDelta, finishGeneration, setError, updateFileStatus, setReviewChecks, setIntent } = useChatStore();
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

  // F-003: 获取原始的 ChatMessage 数组用于分组
  const chatMessages = useMemo(() => {
    return currentProject?.chat ?? [];
  }, [currentProject?.chat]);

  // 发送新消息后自动平滑滚动到底部（仅消息数增加时触发，不影响"加载更多"的滚动补偿）
  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    const count = chatMessages.length;
    if (count > prevMessageCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
    prevMessageCountRef.current = count;
  }, [chatMessages.length]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= 5000) {
      setInputValue(value);
      // 检测命令：以 / 开头时显示下拉
      setShowCommandDropdown(value.trim().startsWith('/'));
    } else {
      toast.info('内容过长，最多支持 5000 字符');
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
          console.debug('[HomePage] done 事件:', {
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
            console.debug('[HomePage] 对话模式，analysis 字段长度:', payload.analysis!.length);
            finishGeneration();
            setIsGenerating(false);
            // 对话模式不改动项目文件，恢复生成前状态（runGeneration 已置为 generating）
            revertProjectStatusAfterFailure();

            // 将分析/诊断结果作为 assistant 消息保存（带上 runId 和 intentType）
            // 注意：使用 streamBuffer.runId 而不是 currentRunId state，确保获取最新值
            addMessage({ role: 'assistant', content: payload.analysis!, runId: useChatStore.getState().streamBuffer.runId ?? undefined, intentType: streamBuffer.intent?.type });
            toast.success('分析完成');

            // 清除 UI 状态
            setPendingMessageId(null);
            setMessageUIState(null);
            break;
          }

          // diff 模式：直接应用变更，无需用户确认
          if (hasChanges && hasFiles) {
            console.debug('[HomePage] diff 模式，直接应用变更');
            const files = payload.files!;

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
              const summary = `应用变更：${payload.changes!.summary}`;
              saveVersion(summary, 'iteration');
              // P1: 保存 changes 数据用于 diff 查看
              addMessage({
                role: 'assistant',
                content: fullContent || `变更已应用：${payload.changes!.summary}`,
                runId: useChatStore.getState().streamBuffer.runId ?? undefined,
                intentType: streamBuffer.intent?.type,
                changes: payload.changes,
              });
              toast.success('变更已应用');
            } else {
              const warningMsg = `变更已应用，但代码存在 ${validation.issues.length} 个问题`;
              // P1: 保存 changes 数据用于 diff 查看
              addMessage({
                role: 'assistant',
                content: fullContent || warningMsg,
                runId: useChatStore.getState().streamBuffer.runId ?? undefined,
                intentType: streamBuffer.intent?.type,
                changes: payload.changes,
              });
              toast.info(warningMsg);
              console.warn('[HomePage] 验证问题:', validation.issues);
            }

            // 清除 UI 状态
            setPendingMessageId(null);
            setMessageUIState(null);
            break;
          }

          if (hasFiles) {
            // 多文件模式（非 diff 模式或 diff 解析失败后的降级）
            const files = payload.files!;
            console.debug('[HomePage] 多文件模式，文件数:', Object.keys(files).length);

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

                // 添加完整消息：优先使用 LLM 输出，fallback 到简短提示（带上 runId 和 intentType）
                addMessage({
                  role: 'assistant',
                  content: fullContent || `应用已生成完成！共 ${Object.keys(files).length} 个文件。你可以继续描述需求来修改它。`,
                  runId: useChatStore.getState().streamBuffer.runId ?? undefined,
                  intentType: streamBuffer.intent?.type,
                });
                toast.success('生成完成');
              } else {
                const warningMsg = `生成完成，但代码存在 ${validation.issues.length} 个问题，可能影响功能`;
                addMessage({
                  role: 'assistant',
                  content: fullContent || warningMsg,
                  runId: useChatStore.getState().streamBuffer.runId ?? undefined,
                  intentType: streamBuffer.intent?.type,
                });
                toast.info(warningMsg);
                console.warn('[HomePage] 验证问题:', validation.issues);
              }

            // 清除 UI 状态
            setPendingMessageId(null);
            setMessageUIState(null);
          } else if (event.payload.html && event.payload.html.length > 0) {
            // 单文件模式（向后兼容）
            console.debug('[HomePage] 单文件模式');
            const validation = validateGeneratedHtml(event.payload.html);
            console.debug('[HomePage] 验证结果:', validation);

            console.debug('[HomePage] 调用 updateEntryFile');
            updateEntryFile(event.payload.html);
            console.debug('[HomePage] updateEntryFile 完成');
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

              // 添加完整消息：优先使用 LLM 输出，fallback 到简短提示（带上 runId 和 intentType）
              addMessage({
                role: 'assistant',
                content: fullContent || '应用已生成完成！你可以继续描述需求来修改它。',
                runId: useChatStore.getState().streamBuffer.runId ?? undefined,
                intentType: streamBuffer.intent?.type,
              });
              toast.success('生成完成');
            } else {
              const warningMsg = `生成完成，但代码存在 ${validation.issues.length} 个问题，可能影响功能`;
              addMessage({
                role: 'assistant',
                content: fullContent || warningMsg,
                runId: useChatStore.getState().streamBuffer.runId ?? undefined,
                intentType: streamBuffer.intent?.type,
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
            addMessage({ role: 'assistant', content: errorMsg, runId: useChatStore.getState().streamBuffer.runId ?? undefined, intentType: streamBuffer.intent?.type });
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
          // 添加错误消息到持久化（带上 runId 和 intentType）
          addMessage({ role: 'assistant', content: event.payload.message, runId: useChatStore.getState().streamBuffer.runId ?? undefined, intentType: streamBuffer.intent?.type });
          setPendingMessageId(null);
          break;
        case 'approval_required': {
          // 分析完成，直接继续生成，无需等待批准
          const sessionId = event.payload.sessionId;
          if (sessionId) {
            console.debug('[HomePage] 分析完成，自动继续生成');
            // 保持生成状态
            setIsGenerating(true);
            // 异步继续生成
            approveAndContinue(sessionId, handleStreamEvent).catch((error) => {
              console.error('[HomePage] 自动继续生成失败:', error);
              const errorMsg = '生成过程发生异常，请重试';
              setError(errorMsg);
              revertProjectStatusAfterFailure();
              setIsGenerating(false);
              toast.error(errorMsg);
              setMessageUIState(prev => prev ? { ...prev, status: 'error' } : null);
              addMessage({ role: 'assistant', content: errorMsg, runId: useChatStore.getState().streamBuffer.runId ?? undefined });
              setPendingMessageId(null);
            });
          }
          break;
        }
      }
    },
    [updateStage, appendDelta, updateEntryFile, updateFiles, updateProjectStatus, setError, addMessage]
  );

  /**
   * 执行一次三阶段流水线生成。
   * @param userMessage 展示在对话区的用户消息（原始需求）
   * @param llmPrompt 实际发给模型的内容（原始需求或附带结构化文档的富输入）
   * @param opts 附加选项（如 intentOverride、images）
   */
  const runGeneration = useCallback(async (userMessage: string, llmPrompt: string, opts?: { intentOverride?: 'create' | 'modify' | 'analyze' | 'diagnose'; images?: string[] | undefined }) => {
    if (!userMessage.trim() || isGenerating) return;

    setIsGenerating(true);

    // 生成唯一 runId（用于消息分组）
    const runId = `run-${Date.now()}`;

    // 确保项目存在（首条用户消息才能入库）
    const project = currentProject ?? createProject('未命名项目', selectedFramework);

    // 判断是否为迭代：存在历史对话 或 已有实质性生成内容（非空白骨架）
    const priorChat = project.chat ?? [];
    // 检查是否有实质内容：入口文件内容超过骨架模板（约 250 字符）才算有内容
    const entryContent = project.files[ENTRY_FILE_PATH]?.content ?? '';
    const hasSubstantialContent = entryContent.length > 300 || Object.keys(project.files).some(p => p !== ENTRY_FILE_PATH);
    const isIteration = priorChat.length > 0 || hasSubstantialContent;

    // 推断意图类型（如果没有指定）
    const intentType: 'create' | 'modify' | 'analyze' | 'diagnose' = opts?.intentOverride ?? (isIteration ? 'modify' : 'create');

    // 调试日志：追踪 framework 参数传递
    console.debug('[HomePage] runGeneration 参数追踪:', {
      selectedFramework,
      projectFramework: project.framework,
      isIteration,
      priorChatLength: priorChat.length,
      entryContentLength: entryContent.length,
      hasSubstantialContent,
      willUseFramework: isIteration ? (project.framework ?? selectedFramework) : selectedFramework,
      runId,
      intentType,
    });

    // 添加用户消息到持久化层（包含图片、runId、意图类型）
    addMessage({ role: 'user', content: userMessage, images: opts?.images, runId, intentType });
    updateProjectStatus('generating');

    // 后台提取项目偏好：从用户消息中识别纠正（如"不要渐变"）与风格偏好（如"深色模式"）
    const extractedPrefs = extractPreferences(project.id, userMessage);
    if (extractedPrefs.length > 0) {
      console.debug('[HomePage] 已提取项目偏好:', extractedPrefs.map(p => `${p.key}=${p.value}`));
    }

    // 获取 AI API
    const baseURL = getEffectiveBaseURL();
    const api = getAIAPI(apiKey, baseURL);

    // 开始生成（使用前面声明的 runId）
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

      // 幻影迭代防护：有对话历史（isIteration 为真）但拿不到任何可修改文件
      // （历史生成失败未落盘 / 文件丢失）时，必须按"全新生成"发请求。
      // 否则服务端会以"修改现有应用"的框架提示模型，而模型看不到现有文件时
      // 倾向输出 changes 变更清单，触发格式错误且重试也难以纠正。
      const requestAsIteration = isIteration && Object.keys(filesToSend).length > 0;

      // 构建生成选项
      const baseOpts: GenerateOptions = {
        // 目标框架：首次创建用 selectedFramework，迭代修改用项目的 framework
        framework: (requestAsIteration || isIteration) ? (project.framework ?? selectedFramework) : selectedFramework,
        ...(requestAsIteration ? {
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
      console.debug('[HomePage] 最终 generateOpts:', {
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
          // 导出项目（与工具栏按钮、快捷键共用同一导出流程）
          await exportProjectZip();
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
      // 添加用户消息（包含图片）- Recall 查询使用 conversation 意图
      const recallRunId = `recall-${Date.now()}`;
      addMessage({ role: 'user', content: prompt, images: pastedImages.length > 0 ? pastedImages : undefined, runId: recallRunId, intentType: 'conversation' });
      // 添加 AI 响应
      addMessage({ role: 'assistant', content: response, runId: recallRunId, intentType: 'conversation' });
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

  const handleExport = useCallback(() => {
    // 生成进行中禁用导出：产物尚不稳定，物化 dist 没有意义
    if (isGenerating) {
      toast.info('生成进行中，请等待完成后再导出');
      return;
    }
    void exportProjectZip();
  }, [isGenerating, exportProjectZip]);

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
   * 处理粘贴事件（当前入口已停用：见 IMAGE_UPLOAD_ENABLED，图片上传待接入多模态管线后启用）
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
   * 处理拖拽进入（使用计数器避免子元素触发 dragLeave）
   */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setIsDragging(true);
    }
  }, []);

  /**
   * 处理拖拽离开
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
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
    dragCounterRef.current = 0; // 重置计数器
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
          {/* 品牌标识：点击回到首页 */}
          <Link
            to="/"
            className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[var(--color-bg-base)] transition-all duration-[140ms] group"
            title="返回首页"
          >
            <Icon icon="lucide:home" width={18} height={18} className="text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors" />
            <span className="text-[15px] font-semibold text-[var(--color-text-primary)] group-hover:text-[var(--color-text-primary)] transition-colors">
              码孖造
            </span>
          </Link>
          {/* 项目列表入口：带文字标签和数量徽章 */}
          <button
            onClick={() => navigate('/projects')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-base)] transition-all duration-[140ms]"
            title={`查看全部项目 (${projectCount} 个)`}
          >
            <Icon icon="lucide:folder-search" width={20} height={20} />
            <span className="hidden sm:inline font-medium">我的项目</span>
            {projectCount > 0 && (
              <span className="flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full bg-[var(--color-accent)]/10 text-[11px] font-medium text-[var(--color-accent)] tabular-nums">
                {projectCount}
              </span>
            )}
          </button>
          {/* 当前项目名：可点击重命名 */}
          {currentProject && (
            <button
              onClick={() => setShowRenameModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-base)] transition-all duration-[140ms] max-w-[200px]"
              title="点击重命名项目"
            >
              <Icon icon="lucide:file-text" width={16} height={16} className="text-[var(--color-text-secondary)] shrink-0" />
              <span className="truncate font-medium">{currentProject.name}</span>
              <Icon icon="lucide:pencil" width={12} height={12} className="text-[var(--color-text-tertiary)] shrink-0" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
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
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">你好，我是码孖造</h2>
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

            {/* 消息列表（F-003: 分组展示 + 长对话滚动加载） */}
            {(() => {
              // 过滤掉 system 消息
              const visibleMessages = chatMessages.filter((m) => m.role !== 'system');
              if (visibleMessages.length === 0) return null;

              // 按 runId 分组（升序：最旧在前、最新在后）
              const groups = groupMessages(visibleMessages);

              // 长对话滚动加载：升序数组上切掉头部（最旧的组），保留最近 visibleGroupCount 组
              const hiddenCount = Math.max(0, groups.length - visibleGroupCount);
              const visibleGroups = groups
                .map((group, gi) => ({ group, gi }))
                .slice(hiddenCount);

              return (
                <>
                  {/* 加载更多按钮：有隐藏分组时显示 */}
                  {hiddenCount > 0 && (
                    <button
                      onClick={() => {
                        const el = scrollRef.current;
                        const prevHeight = el ? el.scrollHeight : 0;
                        setVisibleGroupCount((c) => c + LOAD_STEP);
                        // 保持滚动位置
                        requestAnimationFrame(() => {
                          if (el) {
                            el.scrollTop += el.scrollHeight - prevHeight;
                          }
                        });
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2 text-[13px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                    >
                      <Icon icon="lucide:chevron-up" width={14} height={14} />
                      加载更多（还有 {hiddenCount} 组）
                    </button>
                  )}

                  {/* 分组消息列表 */}
                  {visibleGroups.map(({ group, gi }) => {
                    const isLatest = gi === groups.length - 1; // 列表最后一组是最新组

                    return (
                      <MessageGroupContainer key={group.runId} group={group} isLatest={isLatest}>
                        {group.messages.map((msg) => (
                          <MessageBubble
                            key={msg.id}
                            message={toUIMessage(msg) ?? { id: msg.id, role: msg.role as 'user' | 'assistant', content: msg.content, timestamp: new Date(msg.createdAt) }}
                          />
                        ))}
                      </MessageGroupContainer>
                    );
                  })}
                </>
              );
            })()}

            {/* 流式生成中的消息：在消息列表末尾显示 LLM 的实时输出 */}
            {isGenerating && streamingText && (
              <StreamingMessage
                content={streamingText}
                stage={streamBuffer.stage}
                activeFilePath={streamBuffer.activeFilePath}
                startTime={streamBuffer.startTime}
                intentType={streamBuffer.intent?.type}
              />
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

            {/* F-005: 卡住警告条 */}
            {isStuck && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                    <Icon icon="lucide:alert-triangle" width={16} height={16} className="text-amber-500" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-[14px] font-medium text-amber-500 mb-1">生成时间较长</h4>
                    <p className="text-[13px] text-[var(--color-text-secondary)] mb-3">
                      生成已耗时超过 15 分钟，建议检查需求是否过于复杂或重新描述需求
                    </p>
                    <button
                      onClick={() => {
                        // 取消当前生成
                        cancelActiveRun();
                        finishGeneration();
                        setIsGenerating(false);
                        setMessageUIState(prev => prev ? { ...prev, status: 'error' } : null);
                        toast.info('已停止生成，请重新描述需求');
                        // 输入框获得焦点
                        const textarea = document.querySelector('textarea');
                        if (textarea) {
                          textarea.focus();
                        }
                      }}
                      className="px-4 py-2 rounded-lg bg-amber-500 text-white text-[13px] font-medium hover:bg-amber-600 transition-colors"
                    >
                      重新描述需求
                    </button>
                  </div>
                </div>
              </div>
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
                        <div className="flex items-center gap-3">
                          {/* F-002: 运行时钟 */}
                          {elapsedTime > 0 && (
                            <span className="text-[12px] text-[var(--color-text-tertiary)] tabular-nums">
                              {formatDuration(elapsedTime)}
                            </span>
                          )}
                          <span className="text-[12px] text-[var(--color-text-tertiary)]">
                            {streamBuffer.stageMessage}
                          </span>
                        </div>
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

                {/* 文件面板：构建步骤实时显示 */}
                {streamBuffer.files.length > 0 && (
                  <div className="bg-[var(--color-bg-base)] rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2 text-[12px] text-[var(--color-text-tertiary)]">
                      <Icon icon="lucide:folder-open" width={12} height={12} />
                      <span>项目文件</span>
                      <span className="ml-auto tabular-nums">
                        {streamBuffer.files.filter((f) => f.status === 'completed').length}/{streamBuffer.files.length}
                      </span>
                    </div>
                    <BuildGroup
                      files={streamBuffer.files}
                      isGenerating={isGenerating}
                      activeFilePath={streamBuffer.activeFilePath}
                    />
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

            {/* 图片预览：图片上传待接入多模态管线后启用 */}
            {IMAGE_UPLOAD_ENABLED && pastedImages.length > 0 && (
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

            {/* 输入框容器：拖拽上传已停用（图片上传待接入多模态管线后启用） */}
            <div
              className="relative"
              onDragEnter={IMAGE_UPLOAD_ENABLED ? handleDragEnter : undefined}
              onDragLeave={IMAGE_UPLOAD_ENABLED ? handleDragLeave : undefined}
              onDragOver={IMAGE_UPLOAD_ENABLED ? handleDragOver : undefined}
              onDrop={IMAGE_UPLOAD_ENABLED ? handleDrop : undefined}
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

              {/* 拖拽覆盖层：图片上传待接入多模态管线后启用 */}
              {IMAGE_UPLOAD_ENABLED && isDragging && (
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
                onPaste={IMAGE_UPLOAD_ENABLED ? handlePaste : undefined}
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
            <div className="flex items-center justify-between mt-2 gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <p className="text-[11px] text-[var(--color-text-tertiary)] shrink-0 whitespace-nowrap">
                  Enter发送
                </p>
                {/* 图片上传待接入多模态管线后启用
                <p className="text-[11px] text-[var(--color-text-tertiary)] shrink-0 whitespace-nowrap">
                  支持图片
                </p>
                */}
                <p className="text-[11px] text-[var(--color-text-tertiary)] shrink-0 whitespace-nowrap">
                  /命令
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-[var(--color-text-tertiary)] tabular-nums">
                  {inputValue.length}/5000
                </span>
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
                <ExportZipButton
                  isExporting={isExporting}
                  disabled={isGenerating}
                  onExport={handleExport}
                />
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

      {/* 重命名项目模态框 */}
      {showRenameModal && currentProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--color-bg-elevated)] rounded-xl p-6 w-[400px] max-w-[90vw] border border-[var(--color-border-default)]">
            <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)] mb-4">重命名项目</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameValue.trim()) {
                  updateProjectName(renameValue.trim());
                  setShowRenameModal(false);
                }
                if (e.key === 'Escape') {
                  setShowRenameModal(false);
                }
              }}
              placeholder="输入项目名称"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowRenameModal(false)}
                className="px-4 py-2 rounded-lg text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-base)] transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (renameValue.trim()) {
                    updateProjectName(renameValue.trim());
                    setShowRenameModal(false);
                  }
                }}
                disabled={!renameValue.trim()}
                className="px-4 py-2 rounded-lg text-[13px] bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}