/**
 * 首页：居中输入框 + 模板 chips。
 * 提交后调用 AI 服务，流式显示生成进度，完成后跳转工作台。
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { useProjectStore } from '../stores/projectStore';
import { useChatStore } from '../stores/chatStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getAIAPI, type StreamEvent, validateGeneratedHtml, type DemoTemplateId } from '../services/ai';
import { ENTRY_FILE_PATH } from '../types/project';
import { toast } from '../components/Toast';
import { HomeAuthControls } from '../components/AuthControls';

const TEMPLATE_CHIPS = [
  { id: 'todo' as DemoTemplateId, label: '待办清单', prompt: '做一个待办清单，可以添加、完成和删除任务' },
  { id: 'chart' as DemoTemplateId, label: '数据看板', prompt: '做一个数据看板，显示图表和统计信息' },
  { id: 'landing' as DemoTemplateId, label: '落地页', prompt: '做一个产品落地页，展示产品特性' },
  { id: 'dashboard' as DemoTemplateId, label: '控制面板', prompt: '做一个控制面板，包含多个功能卡片' },
];

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

export default function HomePage() {
  const [inputValue, setInputValue] = useState('');
  const [charCount, setCharCount] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stageMessage, setStageMessage] = useState('');
  const navigate = useNavigate();

  const { createProject, updateEntryFile, updateProjectStatus, addMessage } = useProjectStore();
  const { startGeneration, updateStage, appendDelta, finishGeneration, setError } = useChatStore();
  const { apiKey, getEffectiveBaseURL } = useSettingsStore();

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= 2000) {
      setInputValue(value);
      setCharCount(value.length);
    }
  };

  const handleChipClick = (prompt: string) => {
    setInputValue(prompt);
    setCharCount(prompt.length);
  };

  // 处理生成事件
  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case 'stage':
          updateStage(event.payload.stage, event.payload.attempt, event.payload.message);
          setStageMessage(event.payload.message);
          break;
        case 'delta':
          appendDelta(event.payload.phase, event.payload.text);
          break;
        case 'done': {
          const validation = validateGeneratedHtml(event.payload.html);
          if (validation.ok) {
            updateEntryFile(event.payload.html);
            updateProjectStatus('ready');
            finishGeneration();
            setIsGenerating(false);
            // 添加 AI 响应消息（避免首页提交后对话区只有用户消息）
            addMessage({ role: 'assistant', content: '应用已生成，你可以在预览区查看效果。如需修改，请继续描述你的需求。' });
            toast.success('应用生成成功');
            // 跳转到工作台
            navigate('/workspace');
          } else {
            const errorMsg = `生成的代码存在 ${validation.issues.length} 个问题`;
            setError(errorMsg);
            revertProjectStatusAfterFailure();
            finishGeneration();
            setIsGenerating(false);
            toast.error(errorMsg);
          }
          break;
        }
        case 'error':
          setError(event.payload.message);
          revertProjectStatusAfterFailure();
          finishGeneration();
          setIsGenerating(false);
          toast.error(event.payload.message, 6000);
          break;
      }
    },
    [updateStage, appendDelta, updateEntryFile, updateProjectStatus, finishGeneration, setError, navigate]
  );

  const handleSubmit = useCallback(async () => {
    if (!inputValue.trim() || isGenerating) return;

    const prompt = inputValue.trim();
    setIsGenerating(true);
    setStageMessage('正在分析需求...');

    // 创建新项目
    createProject('未命名项目');
    addMessage({ role: 'user', content: prompt });
    updateProjectStatus('generating');

    // 重置输入
    setInputValue('');
    setCharCount(0);

    // 获取 AI API
    const baseURL = getEffectiveBaseURL();
    const api = getAIAPI(apiKey, baseURL);

    // 开始生成
    const runId = `run-${Date.now()}`;
    startGeneration(runId);

    try {
      await api.generateStream(prompt, handleStreamEvent);
    } catch (error) {
      const errorMsg = '生成过程发生异常，请重试';
      setError(errorMsg);
      revertProjectStatusAfterFailure();
      setIsGenerating(false);
      toast.error(errorMsg);
    }
  }, [
    inputValue,
    isGenerating,
    createProject,
    addMessage,
    updateProjectStatus,
    apiKey,
    getEffectiveBaseURL,
    startGeneration,
    handleStreamEvent,
    setError,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      {/* Header: Brand + Auth */}
      <header className="absolute top-6 left-6 right-6 flex items-center justify-between">
        <h1 className="text-[var(--text-title-lg)] font-semibold text-[var(--color-text-primary)] font-[var(--font-display)]">
          Atoms
        </h1>
        <HomeAuthControls />
      </header>

      {/* Main content */}
      <div className="max-w-[640px] w-full space-y-8">
        {/* Title */}
        <div className="text-center space-y-4">
          <h2 className="text-[42px] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--color-text-primary)] font-[var(--font-display)]">
            把一句需求，变成能跑的应用。
          </h2>
          <p className="text-[var(--text-body)] leading-[1.65] text-[var(--color-text-secondary)]">
            描述想法，AI 团队生成网页应用，即时预览。
          </p>
        </div>

        {/* Input area */}
        <div className="relative">
          <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-[14px] p-4 focus-within:border-[var(--color-border-strong)] focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-all duration-[140ms]">
            {/* 生成中显示进度 */}
            {isGenerating ? (
              <div className="flex items-center gap-3 py-2">
                <Icon icon="lucide:hammer" width={18} height={18} className="text-[var(--color-accent)] animate-spin" />
                <span className="text-[15px] text-[var(--color-text-primary)]">{stageMessage}</span>
              </div>
            ) : (
              <textarea
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="描述你想做的应用，例如：一个番茄钟，可以记录每天的专注时长。"
                className="w-full bg-transparent text-[var(--text-body)] leading-[1.65] text-[var(--color-text-primary)] placeholder:text-[var(--color-placeholder)] resize-none outline-none min-h-[52px] max-h-[160px]"
                rows={1}
              />
            )}

            {/* Footer */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--color-border-default)]">
              <span className="text-[12px] text-[var(--color-text-secondary)]">
                {isGenerating ? '生成中，请稍候...' : '支持多轮修改，生成结果自动保存在本地。'}
              </span>
              <div className="flex items-center gap-3">
                {!isGenerating && (
                  <span className="text-[12px] font-mono text-[var(--color-text-secondary)]">
                    {charCount}/2000
                  </span>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={!inputValue.trim() || isGenerating}
                  className="flex items-center justify-center w-8 h-8 rounded-[10px] bg-[var(--color-accent)] text-[var(--color-text-on-accent)] disabled:bg-transparent disabled:text-[var(--color-text-tertiary)] disabled:border disabled:border-[var(--color-border-default)] transition-all duration-[80ms] hover:bg-[var(--color-accent-hover)] active:scale-[0.98]"
                >
                  <Icon icon="lucide:send" width={16} height={16} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Template chips */}
        <div className="flex flex-wrap justify-center gap-2">
          {TEMPLATE_CHIPS.map((chip) => (
            <button
              key={chip.id}
              onClick={() => handleChipClick(chip.prompt)}
              disabled={isGenerating}
              className="px-4 py-2 rounded-full text-[14px] text-[var(--color-text-secondary)] bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] transition-all duration-[140ms] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}