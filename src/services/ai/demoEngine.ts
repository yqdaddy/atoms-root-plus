/**
 * 演示引擎（DemoPipeline）：无 API key 可运行的本地模板流水线。
 * 复用与 Live 引擎完全一致的状态机与流式事件协议，仅数据来源为本地：
 * analyzing 流式吐出预写的分析 JSON；generating 逐块吐出实例化后的 HTML；
 * reviewing 真实跑一遍程序化硬校验（模板必过，兼作模板回归测试）。
 * 迭代修改支持：色词改主题色、深浅色词切主题、引号文本改标题（docs 6.4）。
 */
import {
  makeDeltaEvent,
  makeErrorEvent,
  makeStageEvent,
  type AIEngine,
  type DeltaPhase,
  type GenerateOptions,
  type StreamEvent,
  type StreamEventHandler,
} from './types';
import { validateGeneratedHtml } from './htmlValidator';
import { cancelActiveRun, registerActiveRun } from './activeRun';
import {
  DEFAULT_TEMPLATE_ID,
  findTemplate,
  instantiateTemplate,
  matchTemplate,
  type DemoTemplate,
  type DemoTemplateConfig,
} from './demoTemplates';

/* generating 阶段分块节奏（Iteration 3 任务约定：每块 200~400 字符，间隔 30~80ms） */
const GEN_CHUNK_MIN = 200;
const GEN_CHUNK_MAX = 400;
const GEN_DELAY_MIN_MS = 30;
const GEN_DELAY_MAX_MS = 80;
/* analyzing 阶段分块节奏（docs 6.4：40~90 字符，60~120ms） */
const ANALYZE_CHUNK_MIN = 40;
const ANALYZE_CHUNK_MAX = 90;
const ANALYZE_DELAY_MIN_MS = 60;
const ANALYZE_DELAY_MAX_MS = 120;
/* reviewing 阶段停顿（docs 6.4：0.8s~1.2s） */
const REVIEW_MIN_MS = 800;
const REVIEW_MAX_MS = 1200;

/** 用户主动取消的内部信号 */
class CancelledError extends Error {}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function newRunId(): string {
  return `d_${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CancelledError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(new CancelledError());
    };
    function cleanup(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/* ---------------- 演示意图识别（色词 / 深浅色 / 引号标题） ---------------- */

const ACCENT_RULES: ReadonlyArray<readonly [string, string]> = [
  ['蓝色', '#2563eb'],
  ['蓝', '#2563eb'],
  ['绿色', '#059669'],
  ['绿', '#059669'],
  ['红色', '#dc2626'],
  ['红', '#dc2626'],
  ['橙色', '#ea580c'],
  ['橙', '#ea580c'],
  ['青色', '#0d9488'],
  ['青', '#0d9488'],
  ['粉色', '#db2777'],
  ['粉', '#db2777'],
];

const DARK_TONE_PATTERN = /深色|暗色|夜间|黑色/;
const LIGHT_TONE_PATTERN = /浅色|亮色|白色|日间/;
const QUOTED_TITLE_PATTERN = /[「『“"]([^「」『』”"']{1,24})[」』”"']/;

function findAccent(prompt: string): string | null {
  for (const [word, accent] of ACCENT_RULES) {
    if (prompt.includes(word)) {
      return accent;
    }
  }
  return null;
}

function extractQuotedTitle(prompt: string): string | null {
  const match = QUOTED_TITLE_PATTERN.exec(prompt);
  const title = match?.[1];
  return title && title.trim().length > 0 ? title.trim() : null;
}

interface DemoPlan {
  template: DemoTemplate;
  config: DemoTemplateConfig;
  /** analyzing 阶段如实展示的说明文案 */
  note: string;
}

interface LastSelection {
  templateId: DemoTemplate['id'];
  config: DemoTemplateConfig;
}

function planForPrompt(prompt: string, last: LastSelection | null): DemoPlan {
  const match = matchTemplate(prompt);
  const accent = findAccent(prompt);
  const wantsDark = DARK_TONE_PATTERN.test(prompt);
  const wantsLight = LIGHT_TONE_PATTERN.test(prompt);
  const quotedTitle = extractQuotedTitle(prompt);

  // 强指向命中视为新建应用；否则视为对当前模板的迭代修改或重生成
  if (match.score >= 2) {
    const config: DemoTemplateConfig = { ...match.template.defaults };
    if (accent) config.accent = accent;
    if (wantsDark) config.dark = true;
    else if (wantsLight) config.dark = false;
    if (quotedTitle) config.title = quotedTitle;
    const extras: string[] = [];
    if (accent) extras.push('主题色');
    if (wantsDark || wantsLight) extras.push('深浅色');
    if (quotedTitle) extras.push('标题');
    let note = `演示模式：识别为「${match.template.name}」，正在分析需求与拆解功能清单…`;
    if (extras.length > 0) {
      note = `演示模式：识别为「${match.template.name}」，并应用修改（${extras.join('、')}），正在拆解功能清单…`;
    }
    return { template: match.template, config, note };
  }

  const baseTemplate = last ? findTemplate(last.templateId) : findTemplate(DEFAULT_TEMPLATE_ID);
  const config: DemoTemplateConfig = last ? { ...last.config } : { ...baseTemplate.defaults };
  if (accent || wantsDark || wantsLight || quotedTitle) {
    if (accent) config.accent = accent;
    if (wantsDark) config.dark = true;
    else if (wantsLight) config.dark = false;
    if (quotedTitle) config.title = quotedTitle;
    return {
      template: baseTemplate,
      config,
      note: '演示模式：已按修改要求更新当前模板，正在重新生成…',
    };
  }
  return {
    template: baseTemplate,
    config,
    note: '演示模式：未能识别具体修改，已按当前模板重新生成',
  };
}

/* ---------------- 引擎实现 ---------------- */

export function createDemoEngine(): AIEngine {
  let lastSelection: LastSelection | null = null;

  async function streamInChunks(
    runId: string,
    text: string,
    phase: DeltaPhase,
    chunkMin: number,
    chunkMax: number,
    delayMin: number,
    delayMax: number,
    signal: AbortSignal,
    emit: (event: StreamEvent) => void,
  ): Promise<void> {
    let cursor = 0;
    while (cursor < text.length) {
      if (signal.aborted) {
        throw new CancelledError();
      }
      const size = randomInt(chunkMin, chunkMax);
      const piece = text.slice(cursor, cursor + size);
      cursor += piece.length;
      emit(makeDeltaEvent(runId, phase, piece));
      await sleep(randomFloat(delayMin, delayMax), signal);
    }
  }

  return {
    mode: 'demo',

    async generateStream(
      prompt: string,
      onEvent: StreamEventHandler,
      _options?: GenerateOptions,
    ): Promise<void> {
      // 新提交隐式取消进行中的旧任务（其监听器会收到 CANCELLED 事件）
      cancelActiveRun();

      const controller = new AbortController();
      const unregister = registerActiveRun(() => controller.abort());
      const runId = newRunId();
      const startedAt = Date.now();
      const emit = (event: StreamEvent): void => {
        onEvent(event);
      };

      try {
        const plan = planForPrompt(prompt, lastSelection);
        lastSelection = { templateId: plan.template.id, config: { ...plan.config } };

        // 阶段一：analyzing，流式吐出预写的分析 JSON
        emit(makeStageEvent(runId, 'analyzing', 1, plan.note));
        const analystJson = JSON.stringify(plan.template.analystScript, null, 2);
        await streamInChunks(
          runId,
          analystJson,
          'analyze',
          ANALYZE_CHUNK_MIN,
          ANALYZE_CHUNK_MAX,
          ANALYZE_DELAY_MIN_MS,
          ANALYZE_DELAY_MAX_MS,
          controller.signal,
          emit,
        );

        // 阶段二：generating，逐块吐出实例化后的完整 HTML
        emit(makeStageEvent(runId, 'generating', 1, '正在生成应用代码…', {
          matchedTemplate: plan.template.id,
        }));
        const html = instantiateTemplate(plan.template, plan.config);
        await streamInChunks(
          runId,
          html,
          'generate',
          GEN_CHUNK_MIN,
          GEN_CHUNK_MAX,
          GEN_DELAY_MIN_MS,
          GEN_DELAY_MAX_MS,
          controller.signal,
          emit,
        );

        // 阶段三：reviewing，真实执行程序化硬校验（兼作模板回归测试）
        emit(makeStageEvent(runId, 'reviewing', 1, '正在校验代码完整性与功能覆盖…'));
        await sleep(randomFloat(REVIEW_MIN_MS, REVIEW_MAX_MS), controller.signal);
        const validation = validateGeneratedHtml(html);
        if (!validation.ok) {
          // 模板必过；走到这里说明模板出现回归缺陷，如实报错而非静默交付
          const detail = validation.issues.map((i) => `${i.check}: ${i.message}`).join('; ');
          emit(makeErrorEvent(
            runId,
            'PARSE_FAILED',
            '演示模板未通过完整性校验，属于模板缺陷，请重试或反馈',
            false,
            false,
            detail,
          ));
          return;
        }

        emit({
          type: 'done',
          payload: {
            runId,
            html,
            warnings: [],
            stats: {
              mode: 'demo',
              inputTokens: 0,
              outputTokens: 0,
              durationMs: Date.now() - startedAt,
              rounds: 1,
            },
          },
        });
      } catch (error) {
        if (error instanceof CancelledError) {
          emit(makeErrorEvent(runId, 'CANCELLED', '已停止生成', false, false));
          return;
        }
        console.error('[demoEngine] 未预期的流水线错误', error);
        emit(makeErrorEvent(
          runId,
          'PARSE_FAILED',
          '演示模式出现内部错误，请重试',
          false,
          false,
          error instanceof Error ? error.message : String(error),
        ));
      } finally {
        unregister();
      }
    },

    cancelGeneration(): void {
      cancelActiveRun();
    },
  };
}
