/**
 * 需求编辑器纯逻辑：草稿模型、文本解析、规范化与修改说明生成。
 * 不含 JSX，便于独立复用与测试。
 *
 * 编辑期约定：交互列表与数据字段保持原始文本（以「、」分隔），
 * 仅在提交时解析，避免输入过程中的受控值回写抖动。
 */
import type {
  OptimizedRequirement,
  CoreFeature,
  AuxFeature,
  DataField,
  Assumption,
} from '../../services/ai/optimizer';

/** 可编辑草稿：核心功能 */
export interface CoreFeatureDraft {
  name: string;
  description: string;
  ui: string;
  interactionsText: string;
}

/** 可编辑草稿：辅助功能 */
export interface AuxFeatureDraft {
  name: string;
  description: string;
}

/** 可编辑草稿：数据实体 */
export interface EntityDraft {
  name: string;
  fieldsText: string;
}

/** 可编辑草稿：假设 */
export interface AssumptionDraft {
  assumption: string;
  reason: string;
}

/** 完整编辑草稿 */
export interface EditDraft {
  appTitle: string;
  appType: OptimizedRequirement['appType'];
  summary: string;
  coreFeatures: CoreFeatureDraft[];
  auxFeatures: AuxFeatureDraft[];
  entities: EntityDraft[];
  storageKey: string;
  uiLayout: string;
  themePrimary: string;
  themeTone: OptimizedRequirement['theme']['tone'];
  assumptions: AssumptionDraft[];
  questions: string[];
}

/** 分隔符：中英文逗号、顿号、换行均可 */
const SPLIT_RE = /[，,、\n]+/;

/** 合法的字段类型集合 */
const VALID_FIELD_TYPES = new Set(['string', 'number', 'boolean', 'array', 'object']);

/** 由结构化需求初始化编辑草稿 */
export function toDraft(req: OptimizedRequirement): EditDraft {
  return {
    appTitle: req.appTitle,
    appType: req.appType,
    summary: req.summary,
    coreFeatures: req.coreFeatures.map((f) => ({
      name: f.name,
      description: f.description,
      ui: f.ui,
      interactionsText: f.interactions.join('、'),
    })),
    auxFeatures: req.auxFeatures.map((f) => ({ name: f.name, description: f.description })),
    entities: req.dataModel.entities.map((e) => ({
      name: e.name,
      fieldsText: e.fields.map((f) => `${f.name}:${f.type}`).join('、'),
    })),
    storageKey: req.dataModel.storageKey,
    uiLayout: req.uiLayout,
    themePrimary: req.theme.primary,
    themeTone: req.theme.tone,
    assumptions: req.assumptions.map((a) => ({ assumption: a.assumption, reason: a.reason })),
    questions: [...req.questions],
  };
}

/** 解析「名称:类型」字段文本为 DataField 数组（非法类型回退 string） */
export function parseFieldsText(text: string): DataField[] {
  return text
    .split(SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const sepIdx = part.search(/[:：]/);
      if (sepIdx === -1) return { name: part, type: 'string' as const };
      const name = part.slice(0, sepIdx).trim();
      const rawType = part.slice(sepIdx + 1).trim().toLowerCase();
      const type = (VALID_FIELD_TYPES.has(rawType) ? rawType : 'string') as DataField['type'];
      return { name: name || '字段', type };
    });
}

/** 解析交互方式文本为数组 */
export function parseInteractionsText(text: string): string[] {
  return text.split(SPLIT_RE).map((s) => s.trim()).filter(Boolean);
}

/** 规范化草稿为可提交的结构化需求（过滤空条目并重排编号） */
export function fromDraft(draft: EditDraft): OptimizedRequirement {
  const coreFeatures: CoreFeature[] = draft.coreFeatures
    .map((f) => ({
      id: '',
      name: f.name.trim(),
      description: f.description.trim(),
      ui: f.ui.trim(),
      interactions: parseInteractionsText(f.interactionsText),
    }))
    .filter((f) => f.name.length > 0)
    .map((f, idx) => ({ ...f, id: `F${idx + 1}` }));

  const auxFeatures: AuxFeature[] = draft.auxFeatures
    .map((f) => ({ id: '', name: f.name.trim(), description: f.description.trim() }))
    .filter((f) => f.name.length > 0)
    .map((f, idx) => ({ ...f, id: `A${idx + 1}` }));

  const assumptions: Assumption[] = draft.assumptions
    .map((a) => ({ assumption: a.assumption.trim(), reason: a.reason.trim() }))
    .filter((a) => a.assumption.length > 0);

  return {
    appTitle: draft.appTitle.trim(),
    appType: draft.appType,
    summary: draft.summary.trim(),
    coreFeatures,
    auxFeatures,
    dataModel: {
      entities: draft.entities
        .map((e) => ({ name: e.name.trim(), fields: parseFieldsText(e.fieldsText) }))
        .filter((e) => e.name.length > 0),
      storageKey: draft.storageKey.trim(),
    },
    uiLayout: draft.uiLayout.trim(),
    theme: {
      primary: draft.themePrimary.trim(),
      tone: draft.themeTone,
    },
    assumptions,
    questions: draft.questions.map((q) => q.trim()).filter(Boolean),
  };
}

/** 比较两个值是否等价（用于生成修改说明） */
function isSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 根据修改前后差异生成 editNotes（返回发生变化的区块名列表） */
export function buildEditNotes(original: OptimizedRequirement, edited: OptimizedRequirement): string[] {
  const notes: string[] = [];
  if (original.appTitle !== edited.appTitle) notes.push('应用标题');
  if (original.appType !== edited.appType) notes.push('应用类型');
  if (original.summary !== edited.summary) notes.push('概述');
  if (!isSame(original.coreFeatures, edited.coreFeatures)) notes.push('核心功能');
  if (!isSame(original.auxFeatures, edited.auxFeatures)) notes.push('辅助功能');
  if (!isSame(original.dataModel, edited.dataModel)) notes.push('数据模型');
  if (original.uiLayout !== edited.uiLayout) notes.push('布局');
  if (!isSame(original.theme, edited.theme)) notes.push('主题');
  if (!isSame(original.assumptions, edited.assumptions)) notes.push('假设');
  if (!isSame(original.questions, edited.questions)) notes.push('待确认问题');
  return notes;
}
