/**
 * 对话状态管理。
 * 负责流式渲染状态、生成阶段、当前消息缓冲。
 */
import { create } from 'zustand';
import type { GenerationStatus, PipelineStage, DeltaPhase } from '../services/ai/types';

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
}

interface ChatActions {
  /** 开始新的生成 */
  startGeneration: (runId: string) => void;
  /** 更新阶段 */
  updateStage: (stage: PipelineStage, attempt: number, message: string) => void;
  /** 追加 delta 文本 */
  appendDelta: (phase: DeltaPhase, text: string) => void;
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
}

const initialStreamBuffer: StreamBuffer = {
  runId: null,
  stage: 'idle',
  attempt: 0,
  analyzeText: '',
  generateText: '',
  repairText: '',
  stageMessage: '',
};

export type ChatStore = ChatState & ChatActions;

export const useChatStore = create<ChatStore>()((set) => ({
  streamBuffer: initialStreamBuffer,
  isGenerating: false,
  error: null,
  currentInput: '',

  startGeneration: (runId) => {
    set({
      streamBuffer: {
        ...initialStreamBuffer,
        runId,
        stage: 'analyzing',
        attempt: 1,
        stageMessage: '正在分析需求...',
      },
      isGenerating: true,
      error: null,
    });
  },

  updateStage: (stage, attempt, message) => {
    set((state) => ({
      streamBuffer: {
        ...state.streamBuffer,
        stage,
        attempt,
        stageMessage: message,
      },
    }));
  },

  appendDelta: (phase, text) => {
    set((state) => {
      const buffer = state.streamBuffer;
      return {
        streamBuffer: {
          ...buffer,
          analyzeText: phase === 'analyze' ? buffer.analyzeText + text : buffer.analyzeText,
          generateText: phase === 'generate' ? buffer.generateText + text : buffer.generateText,
          repairText: phase === 'repair' ? buffer.repairText + text : buffer.repairText,
        },
      };
    });
  },

  finishGeneration: () => {
    set((state) => ({
      streamBuffer: {
        ...state.streamBuffer,
        stage: 'done',
        stageMessage: '生成完成',
      },
      isGenerating: false,
    }));
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