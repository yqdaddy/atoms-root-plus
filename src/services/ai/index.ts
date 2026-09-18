/**
 * AI 服务层统一入口。
 *
 * 后端代理模式：
 * - 前端调用本地后端 `/api/llm/generate`，后端代理 LLM 调用
 * - API Key 由后端环境变量持有，前端不再接触密钥
 * - 后端不可用（网络错误、5xx）时回退 demoEngine（本地模板）
 * - 前端只消费同一套 StreamEvent，不感知引擎差异
 *
 * 取消语义：cancelGeneration 只影响「当前正在进行的那一次生成」；
 * 重复调用安全。
 */
import { createDemoEngine } from './demoEngine';
import { createLiveEngine, DEFAULT_LIVE_CONFIG } from './liveEngine';
import { cancelActiveRun } from './activeRun';
import type { AIEngine, AIGenerationAPI, GenerateOptions, StreamEventHandler } from './types';

export { DEMO_TEMPLATES } from './demoTemplates';
export type { DemoTemplate, DemoTemplateConfig, DemoTemplateId } from './demoTemplates';
export { PROVIDER_PRESETS } from './liveEngine';
export type { ProviderPreset } from './liveEngine';
export type {
  AIGenerationAPI,
  AIEngine,
  DeltaPhase,
  EngineMode,
  ErrorCode,
  FeatureItem,
  FeatureList,
  GenerationStatus,
  GenerateOptions,
  GenerateResult,
  GenerateStats,
  PipelineStage,
  ReviewCheck,
  ReviewVerdict,
  StageEventPayload,
  StreamEvent,
  StreamEventHandler,
} from './types';
export { validateGeneratedHtml, validateGeneratedHtml as runProgrammaticValidation } from './htmlValidator';
export type { HtmlValidationIssue, HtmlValidationResult } from './htmlValidator';
export { cancelActiveRun, hasActiveRun } from './activeRun';

/* ---------------- 工厂函数 ---------------- */

/**
 * 根据配置返回对应引擎。
 *
 * 后端代理模式：始终尝试 liveEngine（后端代理），降级逻辑在 generateStream 中处理。
 * 传入的 apiKey/baseURL 参数会被忽略（保留参数签名以兼容旧代码）。
 *
 * @param options 保留参数签名，实际不使用（后端代理模式）
 */
export function getEngine(
  _options?: { apiKey?: string; baseURL?: string },
): AIEngine {
  // 后端代理模式：直接返回 live 引擎
  // apiKey/baseURL 由后端环境变量配置，前端不再需要
  return createLiveEngine();
}

/**
 * 为 UI 层构造一次完整的 AIGenerationAPI。
 *
 * 内部持有引擎引用与运行注册表，cancelGeneration 保证可取消当前活动生成。
 * 若后端不可用（网络错误、5xx），会自动降级为演示模式重试一次。
 */
export function createAIAPI(
  _options?: { apiKey?: string; baseURL?: string },
): AIGenerationAPI {
  const engine = getEngine(_options);

  async function generateStream(
    prompt: string,
    onEvent: StreamEventHandler,
    generateOptions?: GenerateOptions,
  ): Promise<void> {
    try {
      // 优先尝试后端代理
      await engine.generateStream(prompt, onEvent, generateOptions);
    } catch (error) {
      // 未预期异常：兜底重试用 demo engine
      console.warn('[AIGenerationAPI] 引擎异常，回退演示模式', error);
      const fallbackEngine = createDemoEngine();
      try {
        await fallbackEngine.generateStream(prompt, onEvent, generateOptions);
        return;
      } catch (fallbackError) {
        console.error('[AIGenerationAPI] 演示模式也出现未预期错误', fallbackError);
        onEvent({
          type: 'error',
          payload: {
            runId: String(Date.now()),
            code: 'PARSE_FAILED',
            message: 'AI 生成服务异常，请检查配置或稍后重试',
            retryable: false,
            fallbackToDemo: false,
          },
        });
        return;
      }
    }
  }

  function cancelGeneration(): void {
    engine.cancelGeneration();
  }

  return { generateStream, cancelGeneration, isDemoMode: () => engine.mode === 'demo' };
}

/**
 * 快捷入口（供调用方直接拿 API，无需自己保存引擎实例）。
 *
 * 后端代理模式：参数会被忽略，保留签名以兼容旧代码。
 */
export function getAIAPI(
  _apiKey?: string | null,
  _baseURL?: string,
): AIGenerationAPI {
  return createAIAPI();
}

/**
 * 外部模块级取消入口（如全局「停止生成」按钮调用）。
 * 直接操作活跃运行注册表，与任何 AIGenerationAPI 实例绑定无关。
 */
export function cancelCurrentGeneration(): void {
  cancelActiveRun();
}

/* ---------------- 兼容性导出 ---------------- */

/**
 * @deprecated 后端代理模式下不再需要，保留以避免破坏性变更。
 */
export { DEFAULT_LIVE_CONFIG } from './liveEngine';

/**
 * @deprecated 后端代理模式下不再需要，保留以避免破坏性变更。
 */
function resolveDefaultModel(_baseURL: string): string {
  return DEFAULT_LIVE_CONFIG.model;
}

export { resolveDefaultModel };