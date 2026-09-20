/**
 * 提示词优化器状态管理。
 * 设计文档：docs/tech-prompt-optimizer.md 5.4 节。
 *
 * 职责：驱动「优化中 → 确认中 → 已确认 / 已跳过」的前置流程状态机，
 * 消费 src/services/ai/optimizer 的调用契约（optimizeRequirement / cancelActiveOptimizer）。
 * 面板组件（RequirementPanel）与 HomePage 均只通过本 store 读写优化器状态。
 */
import { create } from 'zustand';
import {
  optimizeRequirement,
  cancelActiveOptimizer,
  OptimizerError,
  type ConfirmedRequirement,
  type OptimizedRequirement,
} from '../services/ai/optimizer';

/** 用户确认状态 */
export type ConfirmationStatus = 'pending' | 'accepted' | 'edited' | 'skipped';

interface OptimizerData {
  /** 是否启用优化器（控制「帮我完善需求」入口是否展示） */
  enabled: boolean;

  /** 优化结果（完成后填充） */
  result: OptimizedRequirement | null;

  /** 是否正在优化 */
  isOptimizing: boolean;

  /** 用户确认状态 */
  confirmationStatus: ConfirmationStatus;

  /** 用户编辑内容摘要 */
  editNotes: string;

  /** 优化失败信息（null 表示无错误） */
  error: string | null;

  /** 触发本次优化的原始用户输入（用于错误重试与组装 ConfirmedRequirement） */
  originalPrompt: string;

  /** 优化器流式输出的原始 JSON 文本（loading 态展示用） */
  streamText: string;
}

interface OptimizerActions {
  /** 开始优化（输入为用户原始需求） */
  startOptimize: (input: string) => Promise<void>;

  /** 取消进行中的优化（重复调用安全） */
  cancelOptimize: () => void;

  /** 确认（一键接受） */
  accept: () => void;

  /** 确认（手动编辑后提交） */
  acceptWithEdits: (edited: OptimizedRequirement, notes: string) => void;

  /** 跳过优化器并放弃当前确认 */
  skip: () => void;

  /** 重置全部状态（保留 enabled 开关） */
  reset: () => void;

  /** 清除错误信息 */
  clearError: () => void;

  /**
   * 由当前状态组装 ConfirmedRequirement（传递给三阶段流水线）。
   * 仅在确认状态为 accepted / edited 且存在结果时返回，否则返回 null。
   */
  buildConfirmedRequirement: () => ConfirmedRequirement | null;
}

export type OptimizerStore = OptimizerData & OptimizerActions;

const INITIAL_MUTABLE_STATE = {
  result: null as OptimizedRequirement | null,
  isOptimizing: false,
  confirmationStatus: 'pending' as ConfirmationStatus,
  editNotes: '',
  error: null as string | null,
  originalPrompt: '',
  streamText: '',
};

export const useOptimizerStore = create<OptimizerStore>()((set, get) => ({
  enabled: true,
  ...INITIAL_MUTABLE_STATE,

  startOptimize: async (input: string) => {
    const userPrompt = input.trim();
    if (!userPrompt || get().isOptimizing) return;

    set({
      ...INITIAL_MUTABLE_STATE,
      isOptimizing: true,
      originalPrompt: userPrompt,
    });

    try {
      const result = await optimizeRequirement(
        { userPrompt, locale: 'zh-CN' },
        (event) => {
          switch (event.type) {
            case 'optimizer_delta':
              set((state) => ({ streamText: state.streamText + event.payload.text }));
              break;
            case 'optimizer_done':
              set({ result: event.payload.result });
              break;
            case 'optimizer_error':
              // 取消不算错误，静默收尾
              if (event.payload.code !== 'CANCELLED') {
                set({ error: event.payload.message });
              }
              break;
            case 'optimizer_stage':
              // 阶段提示当前由面板固定文案展示，无需入库
              break;
          }
        },
      );

      // 正常完成：进入确认态（result 已在 done 事件中写入）
      set({ isOptimizing: false, result });
    } catch (error) {
      if (error instanceof OptimizerError && error.code === 'CANCELLED') {
        // 用户主动取消：回到空闲态，不提示错误
        set({ isOptimizing: false });
        return;
      }
      const message = error instanceof Error ? error.message : '优化失败，请稍后重试';
      set({ isOptimizing: false, error: message });
    }
  },

  cancelOptimize: () => {
    cancelActiveOptimizer();
    set({ isOptimizing: false });
  },

  accept: () => {
    if (!get().result) return;
    set({ confirmationStatus: 'accepted' });
  },

  acceptWithEdits: (edited, notes) => {
    set({
      result: edited,
      confirmationStatus: 'edited',
      editNotes: notes,
    });
  },

  skip: () => {
    set({
      result: null,
      confirmationStatus: 'skipped',
    });
  },

  reset: () => {
    cancelActiveOptimizer();
    set({ ...INITIAL_MUTABLE_STATE });
  },

  clearError: () => {
    set({ error: null });
  },

  buildConfirmedRequirement: () => {
    const { result, confirmationStatus, editNotes, originalPrompt } = get();
    if (!result) return null;
    if (confirmationStatus !== 'accepted' && confirmationStatus !== 'edited') return null;

    const userEdited = confirmationStatus === 'edited';
    return {
      originalPrompt,
      optimized: result,
      userEdited,
      // editNotes 为可选属性：未编辑时不得显式写入 undefined（exactOptionalPropertyTypes）
      ...(userEdited ? { editNotes } : {}),
    };
  },
}));
