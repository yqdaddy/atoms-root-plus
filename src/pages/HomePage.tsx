/**
 * 首页：全屏智能体界面（类 atoms.dev 风格）。
 * 左侧 AI 对话 + 文件生成面板，右侧实时预览 + 代码查看。
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { useProjectStore } from '../stores/projectStore';
import { useChatStore, getCurrentPhaseText } from '../stores/chatStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getAIAPI, type StreamEvent, validateGeneratedHtml, type DemoTemplateId } from '../services/ai';
import { ENTRY_FILE_PATH } from '../types/project';
import { toast } from '../components/Toast';
import { HomeAuthControls } from '../components/AuthControls';
import SandboxFrame from '../components/SandboxFrame';

const TEMPLATE_CHIPS: { id: DemoTemplateId; label: string; prompt: string; icon: string }[] = [
  { id: 'todo', label: '待办清单', prompt: '做一个待办清单，可以添加、完成和删除任务', icon: 'lucide:check-square' },
  { id: 'chart', label: '数据看板', prompt: '做一个数据看板，显示图表和统计信息', icon: 'lucide:bar-chart-2' },
  { id: 'landing', label: '落地页', prompt: '做一个产品落地页，展示产品特性', icon: 'lucide:layout' },
  { id: 'dashboard', label: '控制面板', prompt: '做一个控制面板，包含多个功能卡片', icon: 'lucide:grid-3x3' },
];

/** 文件状态 */
type FileStatus = 'pending' | 'generating' | 'completed';

/** 文件信息 */
interface FileItem {
  name: string;
  path: string;
  status: FileStatus;
  size: number;
  lines: number;
}

/** 消息记录（带时间戳） */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  steps?: number;
  status?: 'processing' | 'done' | 'error';
}

/** 格式化时间 */
function formatTime(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

/**
 * 生成失败后回退当前项目状态
 */
function revertProjectStatusAfterFailure(): void {
  const { currentProject, updateProjectStatus } = useProjectStore.getState();
  const entryHtml = currentProject?.files[ENTRY_FILE_PATH]?.content ?? '';
  updateProjectStatus(validateGeneratedHtml(entryHtml).ok ? 'ready' : 'draft');
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
function FileTreeItem({ file, isActive }: { file: FileItem; isActive: boolean }) {
  const statusIcon = useMemo(() => {
    switch (file.status) {
      case 'pending':
        return <span className="w-4 h-4 flex items-center justify-center text-[var(--color-text-tertiary)]">○</span>;
      case 'generating':
        return <Icon icon="lucide:loader-2" width={14} height={14} className="animate-spin text-[var(--color-accent)]" />;
      case 'completed':
        return <Icon icon="lucide:check" width={14} height={14} className="text-green-500" />;
    }
  }, [file.status]);

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors ${
      isActive ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'
    }`}>
      {statusIcon}
      <Icon icon="lucide:file-code" width={14} height={14} />
      <span className="flex-1 truncate">{file.name}</span>
      {file.status === 'completed' && file.size > 0 && (
        <span className="text-[11px] text-[var(--color-text-tertiary)]">
          {(file.size / 1024).toFixed(1)}KB
        </span>
      )}
    </div>
  );
}

/** 消息气泡组件（类 atoms.dev 风格） */
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

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
        <p className="text-[13px] leading-[1.6] whitespace-pre-wrap">{message.content}</p>

        {/* 状态标签（assistant 消息） */}
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
  );
}

export default function HomePage() {
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [viewTab, setViewTab] = useState<'preview' | 'code'>('preview');
  const [deviceMode, setDeviceMode] = useState<'desktop' | 'mobile'>('desktop');
  const [showConsole, setShowConsole] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const navigate = useNavigate();

  // 流式输出状态
  const streamBuffer = useChatStore((state) => state.streamBuffer);
  const streamingText = getCurrentPhaseText(streamBuffer);
  const scrollRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);

  // 当前项目的 HTML
  const currentProject = useProjectStore((state) => state.currentProject);
  const generatedHtml = currentProject?.files[ENTRY_FILE_PATH]?.content ?? '';

  // 文件列表（目前只有 index.html，后续可扩展）
  const [files, setFiles] = useState<FileItem[]>([]);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current && streamingText) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    if (codeRef.current && generatedHtml && viewTab === 'code') {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [streamingText, generatedHtml, viewTab]);

  // 更新文件状态
  useEffect(() => {
    if (isGenerating) {
      if (streamBuffer.stage === 'generating') {
        // 正在生成代码
        setFiles([
          {
            name: 'index.html',
            path: ENTRY_FILE_PATH,
            status: 'generating',
            size: streamingText.length,
            lines: (streamingText.match(/\n/g) || []).length + 1,
          },
        ]);
      } else if (streamBuffer.stage === 'analyzing') {
        // 分析阶段
        setFiles([
          {
            name: 'index.html',
            path: ENTRY_FILE_PATH,
            status: 'pending',
            size: 0,
            lines: 0,
          },
        ]);
      }
    } else if (generatedHtml && streamBuffer.stage === 'done') {
      // 生成完成
      setFiles([
        {
          name: 'index.html',
          path: ENTRY_FILE_PATH,
          status: 'completed',
          size: generatedHtml.length,
          lines: (generatedHtml.match(/\n/g) || []).length + 1,
        },
      ]);
    }
  }, [isGenerating, streamBuffer.stage, streamingText, generatedHtml]);

  const { createProject, updateEntryFile, updateProjectStatus, addMessage } = useProjectStore();
  const { startGeneration, updateStage, appendDelta, finishGeneration, setError } = useChatStore();
  const { apiKey, getEffectiveBaseURL } = useSettingsStore();

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= 2000) {
      setInputValue(value);
    }
  };

  const handleChipClick = (prompt: string) => {
    if (isGenerating) return;
    setInputValue(prompt);
  };

  // 处理生成事件
  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
      console.log('[HomePage] 收到事件:', event.type, event.payload);
      switch (event.type) {
        case 'stage':
          updateStage(event.payload.stage, event.payload.attempt, event.payload.message);
          // 更新消息步骤计数
          setMessages(prev => prev.map(msg => {
            if (msg.role === 'assistant' && msg.status === 'processing') {
              return { ...msg, steps: (msg.steps || 0) + 1 };
            }
            return msg;
          }));
          break;
        case 'delta':
          appendDelta(event.payload.phase, event.payload.text);
          // 更新 assistant 消息内容
          setMessages(prev => prev.map(msg => {
            if (msg.role === 'assistant' && msg.status === 'processing') {
              return { ...msg, content: '正在生成代码...' };
            }
            return msg;
          }));
          break;
        case 'done': {
          const validation = validateGeneratedHtml(event.payload.html);
          if (validation.ok) {
            updateEntryFile(event.payload.html);
            updateProjectStatus('ready');
            finishGeneration();
            setIsGenerating(false);
            addMessage({ role: 'assistant', content: '应用已生成完成！你可以继续描述需求来修改它。' });
            toast.success('生成完成');
            // 更新消息状态
            setMessages(prev => prev.map(msg => {
              if (msg.role === 'assistant' && msg.status === 'processing') {
                return { ...msg, status: 'done' as const, content: '应用已生成完成！' };
              }
              return msg;
            }));
          } else {
            const errorMsg = `生成的代码存在 ${validation.issues.length} 个问题`;
            setError(errorMsg);
            revertProjectStatusAfterFailure();
            finishGeneration();
            setIsGenerating(false);
            toast.error(errorMsg);
            // 更新消息状态
            setMessages(prev => prev.map(msg => {
              if (msg.role === 'assistant' && msg.status === 'processing') {
                return { ...msg, status: 'error' as const, content: errorMsg };
              }
              return msg;
            }));
          }
          break;
        }
        case 'error':
          setError(event.payload.message);
          revertProjectStatusAfterFailure();
          finishGeneration();
          setIsGenerating(false);
          toast.error(event.payload.message, 6000);
          // 更新消息状态
          setMessages(prev => prev.map(msg => {
            if (msg.role === 'assistant' && msg.status === 'processing') {
              return { ...msg, status: 'error' as const, content: event.payload.message };
            }
            return msg;
          }));
          break;
      }
    },
    [updateStage, appendDelta, updateEntryFile, updateProjectStatus, finishGeneration, setError, addMessage]
  );

  const handleSubmit = useCallback(async () => {
    if (!inputValue.trim() || isGenerating) return;

    const prompt = inputValue.trim();
    setIsGenerating(true);
    setFiles([]); // 重置文件列表

    // 添加用户消息
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    // 如果已有项目，是多轮修改；否则创建新项目
    if (!currentProject) {
      createProject('未命名项目');
    }
    updateProjectStatus('generating');

    // 重置输入
    setInputValue('');

    // 获取 AI API
    const baseURL = getEffectiveBaseURL();
    const api = getAIAPI(apiKey, baseURL);

    // 开始生成
    const runId = `run-${Date.now()}`;
    startGeneration(runId);

    // 添加 assistant 占位消息
    const assistantMessage: ChatMessage = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      steps: 0,
      status: 'processing',
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      const opts = generatedHtml ? { currentHtml: generatedHtml } : {};
      await api.generateStream(prompt, handleStreamEvent, opts);
    } catch (error) {
      const errorMsg = '生成过程发生异常，请重试';
      setError(errorMsg);
      revertProjectStatusAfterFailure();
      setIsGenerating(false);
      toast.error(errorMsg);
      // 更新 assistant 消息状态
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessage.id
          ? { ...msg, status: 'error' as const, content: errorMsg }
          : msg
      ));
    }
  }, [
    inputValue,
    isGenerating,
    currentProject,
    createProject,
    updateProjectStatus,
    apiKey,
    getEffectiveBaseURL,
    startGeneration,
    handleStreamEvent,
    generatedHtml,
    setError,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

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

  // 当前阶段标题
  const stageTitle = useMemo(() => {
    switch (streamBuffer.stage) {
      case 'analyzing':
        return '分析需求';
      case 'generating':
        return '生成代码';
      case 'reviewing':
        return '审查代码';
      case 'done':
        return '完成';
      case 'error':
        return '出错';
      default:
        return '准备中';
    }
  }, [streamBuffer.stage]);

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
        <div className="w-full md:w-1/2 lg:w-[45%] flex flex-col border-r border-[var(--color-border-default)]">
          {/* Chat messages area */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Welcome message */}
            {messages.length === 0 && !isGenerating && !generatedHtml && (
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

            {/* Template chips */}
            {messages.length === 0 && !isGenerating && !generatedHtml && (
              <div className="flex flex-wrap justify-center gap-2 pb-4">
                {TEMPLATE_CHIPS.map((chip) => (
                  <button
                    key={chip.id}
                    onClick={() => handleChipClick(chip.prompt)}
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
              <MessageBubble key={msg.id} message={msg} />
            ))}

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
                </div>

                {/* 文件面板 */}
                {files.length > 0 && (
                  <div className="bg-[var(--color-bg-base)] rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2 text-[12px] text-[var(--color-text-tertiary)]">
                      <Icon icon="lucide:folder-open" width={12} height={12} />
                      <span>项目文件</span>
                    </div>
                    <div className="space-y-1">
                      {files.map((file) => (
                        <FileTreeItem
                          key={file.path}
                          file={file}
                          isActive={file.status === 'generating'}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* 流式输出 */}
                {streamingText && (
                  <div className="bg-[var(--color-bg-surface)] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
                      <span className="text-[12px] text-[var(--color-text-tertiary)]">正在生成...</span>
                    </div>
                    <pre className="text-[12px] text-[var(--color-text-secondary)] leading-[1.6] whitespace-pre-wrap font-mono max-h-[150px] overflow-y-auto">
                      {streamingText.slice(-500)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* 生成完成 */}
            {generatedHtml && !isGenerating && streamBuffer.stage === 'done' && messages.length === 0 && (
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
          </div>

          {/* Input area */}
          <div className="p-4 border-t border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
            <div className="relative">
              <textarea
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={isGenerating ? '正在生成中...' : '让智能体团队实现你的想法'}
                disabled={isGenerating}
                className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border-default)] rounded-xl px-4 py-3 pr-12 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] resize-none outline-none focus:border-[var(--color-border-strong)] transition-colors disabled:opacity-50"
                rows={2}
              />
              <button
                onClick={handleSubmit}
                disabled={!inputValue.trim() || isGenerating}
                className="absolute right-3 bottom-3 flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-accent)] text-white disabled:bg-transparent disabled:text-[var(--color-text-tertiary)] disabled:border disabled:border-[var(--color-border-default)] transition-all hover:bg-[var(--color-accent-hover)] active:scale-95"
              >
                <Icon icon={isGenerating ? 'lucide:loader-2' : 'lucide:send'} width={16} height={16} className={isGenerating ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-[11px] text-[var(--color-text-tertiary)]">
                按 Enter 发送 · Shift+Enter 换行
              </p>
              {generatedHtml && (
                <button
                  onClick={() => {
                    const blob = new Blob([generatedHtml], { type: 'text/html' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'app.html';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-1 text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                >
                  <Icon icon="lucide:share" width={12} height={12} />
                  分享
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right: Preview Panel */}
        <div className="hidden md:flex flex-1 flex-col bg-[var(--color-bg-base)]">
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

              {/* Device mode toggle */}
              <button
                onClick={() => setDeviceMode('desktop')}
                className={`p-1.5 rounded transition-colors ${
                  deviceMode === 'desktop'
                    ? 'bg-[var(--color-bg-base)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                }`}
                title="桌面模式"
              >
                <Icon icon="lucide:monitor" width={16} height={16} />
              </button>
              <button
                onClick={() => setDeviceMode('mobile')}
                className={`p-1.5 rounded transition-colors ${
                  deviceMode === 'mobile'
                    ? 'bg-[var(--color-bg-base)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                }`}
                title="移动模式"
              >
                <Icon icon="lucide:smartphone" width={16} height={16} />
              </button>
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

              {/* Open in new tab */}
              {generatedHtml && (
                <button
                  onClick={() => {
                    const blob = new Blob([generatedHtml], { type: 'text/html' });
                    const url = URL.createObjectURL(blob);
                    window.open(url, '_blank');
                  }}
                  className="p-1.5 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                  title="在新标签页打开"
                >
                  <Icon icon="lucide:external-link" width={16} height={16} />
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
                <div className={`flex-1 flex items-center justify-center p-4 ${
                  deviceMode === 'mobile' ? 'bg-[var(--color-bg-surface)]' : ''
                }`}>
                  {generatedHtml ? (
                    deviceMode === 'mobile' ? (
                      <div className="w-[375px] h-[667px] rounded-[2rem] border-8 border-[var(--color-border-strong)] overflow-hidden shadow-2xl bg-white">
                        <SandboxFrame html={generatedHtml} />
                      </div>
                    ) : (
                      <div className="w-full h-full">
                        <SandboxFrame html={generatedHtml} />
                      </div>
                    )
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
              <div className="flex-1 flex flex-col">
                {generatedHtml ? (
                  <>
                    <div className="px-4 py-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
                      <span className="text-[12px] text-[var(--color-text-tertiary)]">index.html</span>
                      <span className="text-[12px] text-[var(--color-text-tertiary)] ml-4">
                        {(generatedHtml.length / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <div
                      ref={codeRef}
                      className="flex-1 overflow-auto p-4 font-mono text-[13px] leading-[1.6] bg-[var(--color-bg-surface)]"
                    >
                      <pre className="text-[var(--color-text-primary)]">
                        {highlightHtml(generatedHtml)}
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}