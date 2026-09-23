/**
 * 对话状态管理。
 * 负责流式渲染状态、生成阶段、当前消息缓冲、文件生成进度、审查摘要。
 */
import { create } from 'zustand';
import type { GenerationStatus, PipelineStage, DeltaPhase, IntentResult } from '../services/ai/types';
import type { ReviewCheckItem } from '../components/ReviewSummary';

/** 文件生成状态 */
export interface FileGenerationStatus {
  /** 文件路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 状态：pending 等待中 / generating 生成中 / completed 已完成 / failed 失败 */
  status: 'pending' | 'generating' | 'completed' | 'failed';
  /** 已生成字符数 */
  charCount: number;
  /** 行数估算 */
  lineCount: number;
  /** 操作类型：create 新建 / modify 修改 */
  operation?: 'create' | 'modify';
}

export interface StreamBuffer {
  /** 当前运行 ID */
  runId: string | null;
  /** 生成阶段 */
  stage: GenerationStatus;
  /** 当前轮次（1=首轮，2=修复轮） */
  attempt: number;
  /** analyze 阶段累积文本 */
  analyzeText: string;
  /** generate 阶段累积文本 */
  generateText: string;
  /** repair 阶段累积文本 */
  repairText: string;
  /** 当前阶段提示消息 */
  stageMessage: string;
  /** 是否等待用户批准（approval_required 时设为 true，批准后继续生成时设为 false） */
  awaitingApproval: boolean;
  /** 文件生成进度列表（工具参数流式渲染） */
  files: FileGenerationStatus[];
  /** 当前正在生成的文件路径 */
  activeFilePath: string | null;
  /** 意图识别结果（仅首个 stage 事件携带） */
  intent: IntentResult | null;
  /** 生成开始时间戳（用于运行时钟持久化） */
  startTime: number | null;
}

interface ChatState {
  /** 流式缓冲 */
  streamBuffer: StreamBuffer;
  /** 是否正在生成 */
  isGenerating: boolean;
  /** 错误消息（null 表示无错误） */
  error: string | null;
  /** 当前用户输入 */
  currentInput: string;
  /** 审查检查结果（生成完成后展示折叠摘要，null 表示无审查结果） */
  reviewChecks: ReviewCheckItem[] | null;
}

interface ChatActions {
  /** 开始新的生成 */
  startGeneration: (runId: string) => void;
  /** 更新阶段 */
  updateStage: (stage: PipelineStage, attempt: number, message: string, intent?: IntentResult) => void;
  /** 追加 delta 文本（fileName/operation 用于文件级进度追踪） */
  appendDelta: (phase: DeltaPhase, text: string, fileName?: string, operation?: 'create' | 'modify') => void;
  /** 完成生成 */
  finishGeneration: () => void;
  /** 设置错误 */
  setError: (message: string) => void;
  /** 清除错误 */
  clearError: () => void;
  /** 设置输入 */
  setInput: (input: string) => void;
  /** 重置流式缓冲 */
  resetStreamBuffer: () => void;
  /** 设置等待批准状态 */
  setAwaitingApproval: (awaiting: boolean) => void;
  /** 更新文件生成状态 */
  updateFileStatus: (path: string, status: FileGenerationStatus['status'], charCount?: number, lineCount?: number) => void;
  /** 设置审查检查结果（用于折叠摘要展示） */
  setReviewChecks: (checks: ReviewCheckItem[] | null) => void;
  /** 设置意图识别结果 */
  setIntent: (intent: IntentResult | null) => void;
  /** 从 sessionStorage 恢复 startTime（刷新页面后恢复运行时钟） */
  restoreStartTime: (runId: string) => void;
}

const initialStreamBuffer: StreamBuffer = {
  runId: null,
  stage: 'idle',
  attempt: 0,
  analyzeText: '',
  generateText: '',
  repairText: '',
  stageMessage: '',
  awaitingApproval: false,
  files: [],
  activeFilePath: null,
  intent: null,
  startTime: null,
};

export type ChatStore = ChatState & ChatActions;

/** sessionStorage 键名模板 */
const START_TIME_KEY_PREFIX = 'litpp:run:';

/** 保存 startTime 到 sessionStorage */
function saveStartTime(runId: string, startTime: number): void {
  try {
    sessionStorage.setItem(`${START_TIME_KEY_PREFIX}${runId}:startTime`, String(startTime));
  } catch {
    // sessionStorage 可能不可用（隐私模式），忽略错误
  }
}

/** 从 sessionStorage 读取 startTime */
function loadStartTime(runId: string): number | null {
  try {
    const value = sessionStorage.getItem(`${START_TIME_KEY_PREFIX}${runId}:startTime`);
    return value ? parseInt(value, 10) : null;
  } catch {
    return null;
  }
}

/** 清除 sessionStorage 中的 startTime */
function clearStartTime(runId: string): void {
  try {
    sessionStorage.removeItem(`${START_TIME_KEY_PREFIX}${runId}:startTime`);
  } catch {
    // 忽略错误
  }
}

export const useChatStore = create<ChatStore>()((set) => ({
  streamBuffer: initialStreamBuffer,
  isGenerating: false,
  error: null,
  currentInput: '',
  reviewChecks: null,

  startGeneration: (runId) => {
    const startTime = Date.now();
    // 持久化 startTime 到 sessionStorage
    saveStartTime(runId, startTime);
    set({
      streamBuffer: {
        ...initialStreamBuffer,
        runId,
        stage: 'analyzing',
        attempt: 1,
        stageMessage: '正在分析功能...',
        startTime,
      },
      isGenerating: true,
      error: null,
      reviewChecks: null,
    });
  },

  updateStage: (stage, attempt, message, intent) => {
    set((state) => ({
      streamBuffer: {
        ...state.streamBuffer,
        stage,
        attempt,
        stageMessage: message,
        ...(intent ? { intent } : {}),
      },
    }));
  },

  appendDelta: (phase, text, fileName, operation) => {
    set((state) => {
      const buffer = state.streamBuffer;
      const isThinkingPhase = phase === 'analyze';
      const isGeneratePhase = phase === 'generate';
      const isRepairPhase = phase === 'repair';
      const nextBuffer: StreamBuffer = {
        ...buffer,
        analyzeText: isThinkingPhase ? buffer.analyzeText + text : buffer.analyzeText,
        generateText: isGeneratePhase ? buffer.generateText + text : buffer.generateText,
        repairText: isRepairPhase ? buffer.repairText + text : buffer.repairText,
      };

      // 文件生成进度追踪（仅在 generate/repair 阶段且携带文件名时）
      if ((isGeneratePhase || isRepairPhase) && fileName) {
        const existingIdx = buffer.files.findIndex((f) => f.path === fileName);

        if (existingIdx !== -1) {
          const updatedFiles = [...buffer.files];
          const existing = updatedFiles[existingIdx];
          if (existing) {
            // 累加当前 delta 的长度，跟踪每个文件的独立字符计数
            const newCharCount = existing.charCount + text.length;
            const newLineCount = existing.lineCount + (text.match(/\n/g) || []).length;
            updatedFiles[existingIdx] = {
              ...existing,
              status: 'generating',
              charCount: newCharCount,
              lineCount: newLineCount,
            };
          }
          nextBuffer.files = updatedFiles;
        } else {
          // 新文件：初始化字符计数为当前 delta 的长度
          const initialCharCount = text.length;
          const initialLineCount = 1 + (text.match(/\n/g) || []).length;
          nextBuffer.files = [
            ...buffer.files,
            {
              path: fileName,
              name: fileName.split('/').pop() ?? fileName,
              status: 'generating',
              charCount: initialCharCount,
              lineCount: initialLineCount,
              operation: operation ?? 'create',
            },
          ];
        }
        nextBuffer.activeFilePath = fileName;
      }

      return { streamBuffer: nextBuffer };
    });
  },

  finishGeneration: () => {
    set((state) => {
      // 清除 sessionStorage 中的 startTime
      if (state.streamBuffer.runId) {
        clearStartTime(state.streamBuffer.runId);
      }
      return {
        streamBuffer: {
          ...state.streamBuffer,
          stage: 'done',
          stageMessage: '生成完成',
        },
        isGenerating: false,
      };
    });
  },

  setError: (message) => {
    set((state) => ({
      streamBuffer: {
        ...state.streamBuffer,
        stage: 'error',
        stageMessage: message,
      },
      isGenerating: false,
      error: message,
    }));
  },

  clearError: () => {
    set({ error: null });
  },

  setInput: (input) => {
    set({ currentInput: input });
  },

  resetStreamBuffer: () => {
    set({ streamBuffer: initialStreamBuffer, error: null });
  },

  setAwaitingApproval: (awaiting) => {
    set((state) => ({
      streamBuffer: {
        ...state.streamBuffer,
        awaitingApproval: awaiting,
      },
    }));
  },

  updateFileStatus: (path, status, charCount, lineCount) => {
    set((state) => {
      const buffer = state.streamBuffer;
      const idx = buffer.files.findIndex((f) => f.path === path);

      if (idx !== -1) {
        const updatedFiles = [...buffer.files];
        const existing = updatedFiles[idx];
        if (existing) {
          updatedFiles[idx] = {
            ...existing,
            status,
            charCount: charCount ?? existing.charCount,
            lineCount: lineCount ?? existing.lineCount,
          };
        }
        return {
          streamBuffer: {
            ...buffer,
            files: updatedFiles,
            activeFilePath: status === 'generating' ? path : buffer.activeFilePath,
          },
        };
      }

      // 添加新文件（用于完成阶段补记未追踪的文件）
      return {
        streamBuffer: {
          ...buffer,
          files: [
            ...buffer.files,
            {
              path,
              name: path.split('/').pop() ?? path,
              status,
              charCount: charCount ?? 0,
              lineCount: lineCount ?? 0,
            },
          ],
        },
      };
    });
  },

  setReviewChecks: (checks) => {
    set({ reviewChecks: checks });
  },

  setIntent: (intent) => {
    set((state) => ({
      streamBuffer: {
        ...state.streamBuffer,
        intent,
      },
    }));
  },

  restoreStartTime: (runId) => {
    const startTime = loadStartTime(runId);
    if (startTime) {
      set((state) => ({
        streamBuffer: {
          ...state.streamBuffer,
          runId,
          startTime,
          stage: 'generating', // 恢复时默认为 generating 状态
        },
        isGenerating: true,
      }));
    }
  },
}));

/** 获取当前阶段的累积文本 */
export function getCurrentPhaseText(buffer: StreamBuffer): string {
  if (buffer.attempt > 1) {
    // 修复轮显示 repair 文本
    return buffer.repairText || buffer.generateText;
  }
  // 首轮显示 analyze 或 generate 文本
  if (buffer.stage === 'analyzing') {
    return buffer.analyzeText;
  }
  return buffer.generateText || buffer.analyzeText;
}
