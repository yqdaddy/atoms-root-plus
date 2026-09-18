/**
 * 对话面板组件。
 * 支持消息列表、流式渲染、输入框、错误处理和重试。
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import MessageRenderer from './MessageRenderer';
import { useChatStore, getCurrentPhaseText } from '../stores/chatStore';
import { useProjectStore } from '../stores/projectStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getAIAPI, type StreamEvent, validateGeneratedHtml, cancelCurrentGeneration } from '../services/ai';
import { ENTRY_FILE_PATH } from '../types/project';
import { toast } from './Toast';

/**
 * 生成失败后回退当前项目状态，避免 status 永久卡在 generating（D-7）：
 * 入口文件已有通过硬校验的可用 HTML（此前生成成功过）回 ready，
 * 仍是初始模板内容则回 draft。
 */
function revertProjectStatusAfterFailure(): void {
  const { currentProject, updateProjectStatus } = useProjectStore.getState();
  const entryHtml = currentProject?.files[ENTRY_FILE_PATH]?.content ?? '';
  updateProjectStatus(validateGeneratedHtml(entryHtml).ok ? 'ready' : 'draft');
}

export default function ChatPanel() {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);

  const { streamBuffer, isGenerating, error, startGeneration, updateStage, appendDelta, finishGeneration, setError, resetStreamBuffer, clearError } = useChatStore();
  const { currentProject, addMessage, updateEntryFile, updateProjectStatus } = useProjectStore();
  const { apiKey, getEffectiveBaseURL } = useSettingsStore();

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentProject?.chat, streamBuffer.generateText, streamBuffer.analyzeText]);

  // 处理生成事件
  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case 'stage':
          updateStage(event.payload.stage, event.payload.attempt, event.payload.message);
          break;
        case 'delta':
          appendDelta(event.payload.phase, event.payload.text);
          break;
        case 'done': {
          // 验证并保存 HTML
          const validation = validateGeneratedHtml(event.payload.html);
          if (validation.ok) {
            updateEntryFile(event.payload.html);
            updateProjectStatus('ready');
            // 添加助手消息
            addMessage({
              role: 'assistant',
              content: '应用已生成完成，可以在预览面板查看。',
            });
            toast.success('应用生成成功');
            setLastFailedPrompt(null);
          } else {
            const errorMsg = `生成的代码存在 ${validation.issues.length} 个问题`;
            setError(errorMsg);
            revertProjectStatusAfterFailure();
            addMessage({
              role: 'assistant',
              content: `生成完成但存在问题：\n${validation.issues.map((i) => `- ${i.message}`).join('\n')}`,
            });
            toast.error(errorMsg);
          }
          finishGeneration();
          break;
        }
        case 'error':
          setError(event.payload.message);
          revertProjectStatusAfterFailure();
          addMessage({
            role: 'assistant',
            content: `生成失败：${event.payload.message}`,
          });
          toast.error(event.payload.message, 6000);
          finishGeneration();
          break;
      }
    },
    [updateStage, appendDelta, updateEntryFile, updateProjectStatus, addMessage, finishGeneration, setError]
  );

  // 发送消息
  const handleSend = useCallback(async (prompt?: string) => {
    const message = prompt ?? input.trim();
    if (!message || isGenerating) return;

    const userMessage = message;
    setInput('');
    setLastFailedPrompt(userMessage);
    resetStreamBuffer();

    // 添加用户消息
    addMessage({ role: 'user', content: userMessage });
    updateProjectStatus('generating');

    // 获取 AI API
    const baseURL = getEffectiveBaseURL();
    const api = getAIAPI(apiKey, baseURL);

    // 生成唯一 runId
    const runId = `run-${Date.now()}`;
    startGeneration(runId);

    // 调用 AI
    try {
      await api.generateStream(userMessage, handleStreamEvent);
    } catch (err) {
      const errorMsg = '生成过程发生异常，请重试';
      setError(errorMsg);
      revertProjectStatusAfterFailure();
      toast.error(errorMsg);
    }
  }, [
    input,
    isGenerating,
    addMessage,
    updateProjectStatus,
    apiKey,
    getEffectiveBaseURL,
    startGeneration,
    resetStreamBuffer,
    handleStreamEvent,
    setError,
  ]);

  // 重试上次的请求
  const handleRetry = useCallback(() => {
    if (lastFailedPrompt) {
      clearError();
      handleSend(lastFailedPrompt);
    }
  }, [lastFailedPrompt, clearError, handleSend]);

  // 取消生成
  const handleCancel = useCallback(() => {
    cancelCurrentGeneration();
    revertProjectStatusAfterFailure();
    finishGeneration();
    addMessage({
      role: 'assistant',
      content: '已取消生成。',
    });
    toast.info('已取消生成');
  }, [finishGeneration, addMessage]);

  // 快捷提示
  const quickPrompts = [
    { label: '做一个番茄钟', prompt: '做一个番茄钟，可以记录每天的专注时长' },
    { label: '做一个记账本', prompt: '做一个记账本，可以记录收入支出并显示统计' },
    { label: '做一个待办清单', prompt: '做一个待办清单，可以添加、完成和删除任务' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* 错误提示与重试 */}
        {error && streamBuffer.stage === 'error' && (
          <div className="mb-4 p-3 rounded-lg bg-[#fef2f2] border border-[#fecaca]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Icon icon="lucide:x" width={14} height={14} className="text-[#ef4444]" />
                  <span className="text-[13px] font-medium text-[#ef4444]">生成失败</span>
                </div>
                <p className="text-[13px] text-[var(--color-text-primary)]">{error}</p>
              </div>
              {lastFailedPrompt && (
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[13px] text-[var(--color-text-on-accent)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] transition-all duration-[80ms]"
                >
                  <Icon icon="lucide:refresh-cw" width={14} height={14} />
                  <span>重试</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 当前流式内容 */}
        {(streamBuffer.stage !== 'idle' && streamBuffer.stage !== 'done' && streamBuffer.stage !== 'error') && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--color-bg-elevated)]">
            <div className="flex items-center gap-2 mb-2">
              <Icon icon="lucide:hammer" width={14} height={14} className="text-[var(--color-accent)] animate-pulse" />
              <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
                {streamBuffer.stageMessage}
              </span>
            </div>
            {streamBuffer.analyzeText && (
              <div className="text-[13px] text-[var(--color-text-secondary)] whitespace-pre-wrap">
                {getCurrentPhaseText(streamBuffer)}
              </div>
            )}
          </div>
        )}

        {/* 历史消息 */}
        {currentProject?.chat.map((message) => (
          <div
            key={message.id}
            className={`mb-4 p-3 rounded-lg ${
              message.role === 'user'
                ? 'bg-[var(--color-bg-elevated)] ml-4 sm:ml-8'
                : 'bg-[var(--color-bg-inset)] mr-4 sm:mr-8'
            }`}
          >
            <div className="text-[12px] font-medium mb-1 text-[var(--color-text-secondary)]">
              {message.role === 'user' ? '你' : 'AI'}
            </div>
            <MessageRenderer content={message.content} />
          </div>
        ))}

        {/* 空状态 */}
        {(!currentProject?.chat || currentProject.chat.length === 0) && streamBuffer.stage === 'idle' && !error && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-[14px] text-[var(--color-text-secondary)]">
              描述你想做的应用，AI 团队会分析、生成并检查代码，完成后在预览面板实时展示。
            </p>
            <div className="mt-6 space-y-2">
              {quickPrompts.map((item) => (
                <button
                  key={item.label}
                  onClick={() => setInput(item.prompt)}
                  className="block w-full px-4 py-2 rounded-[10px] text-[14px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="p-3 border-t border-[var(--color-border-default)]">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="描述修改方向..."
            disabled={isGenerating}
            className="flex-1 px-3 py-2 rounded-[10px] bg-[var(--color-bg-inset)] text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-placeholder)] border border-[var(--color-border-default)] focus:border-[var(--color-border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg-surface)] transition-all duration-[140ms] disabled:opacity-50"
          />
          {isGenerating ? (
            <button
              onClick={handleCancel}
              className="flex items-center justify-center w-8 h-8 rounded-[10px] bg-[var(--color-error)] text-[var(--color-text-on-accent)] transition-all duration-[80ms] hover:opacity-90 active:scale-[0.98]"
            >
              <Icon icon="lucide:x" width={16} height={16} />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="flex items-center justify-center w-8 h-8 rounded-[10px] bg-[var(--color-accent)] text-[var(--color-text-on-accent)] disabled:bg-transparent disabled:text-[var(--color-text-tertiary)] disabled:border disabled:border-[var(--color-border-default)] transition-all duration-[80ms] hover:bg-[var(--color-accent-hover)] active:scale-[0.98]"
            >
              <Icon icon="lucide:send" width={16} height={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}