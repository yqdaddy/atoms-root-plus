/**
 * 需求文档编辑表单。
 * 点击「编辑修改」后展示：全部字段变为可编辑输入框，
 * 提交时将草稿规范化为 OptimizedRequirement，并自动生成修改说明（editNotes）。
 *
 * 结构：纯逻辑见 editorHelpers.ts，基础控件见 editorUi.tsx，
 * 核心功能与数据模型区块见 editorSections.tsx，本文件只做表单组装。
 */
import { useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { OptimizedRequirement } from '../../services/ai/optimizer';
import { APP_TYPE_LABELS } from './types';
import {
  toDraft,
  fromDraft,
  buildEditNotes,
  type EditDraft,
} from './editorHelpers';
import { INPUT_CLASS, FieldLabel, RemoveButton, AddButton } from './editorUi';
import { CoreFeaturesSection, DataModelSection, SectionIconLabel } from './editorSections';

export interface RequirementEditorProps {
  /** 当前结构化需求（草稿来源） */
  requirement: OptimizedRequirement;
  /** 优化器原始输出（生成修改说明的对照基准） */
  original: OptimizedRequirement;
  /** 提交编辑 */
  onSubmit: (edited: OptimizedRequirement, notes: string) => void;
  /** 取消编辑（回到只读态） */
  onCancel: () => void;
}

/** 需求文档编辑表单 */
export function RequirementEditor({ requirement, original, onSubmit, onCancel }: RequirementEditorProps) {
  const [draft, setDraft] = useState<EditDraft>(() => toDraft(requirement));

  /** 更新草稿的任意顶层字段 */
  const patch = (partial: Partial<EditDraft>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  /** 规范化后的可提交草稿（同时用于校验与提交） */
  const built = useMemo(() => fromDraft(draft), [draft]);
  const canSubmit =
    built.appTitle.length > 0 &&
    built.coreFeatures.length >= 2 &&
    built.coreFeatures.length <= 4;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const changed = buildEditNotes(original, built);
    const notes = changed.length > 0 ? `用户修改了：${changed.join('、')}` : '用户查看后确认，内容未改动';
    onSubmit(built, notes);
  };

  return (
    <div className="space-y-4">
      {/* 基础信息 */}
      <section className="space-y-3">
        <div>
          <FieldLabel text="应用标题" hint="1 至 20 字" />
          <input
            value={draft.appTitle}
            onChange={(e) => patch({ appTitle: e.target.value.slice(0, 20) })}
            className={INPUT_CLASS}
            placeholder="例如：番茄时钟"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel text="应用类型" />
            <select
              value={draft.appType}
              onChange={(e) => patch({ appType: e.target.value as EditDraft['appType'] })}
              className={INPUT_CLASS}
            >
              {Object.entries(APP_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel text="主题色调" />
            <select
              value={draft.themeTone}
              onChange={(e) => patch({ themeTone: e.target.value as EditDraft['themeTone'] })}
              className={INPUT_CLASS}
            >
              <option value="light">浅色</option>
              <option value="dark">深色</option>
              <option value="auto">跟随系统</option>
            </select>
          </div>
        </div>
        <div>
          <FieldLabel text="一句话概述" />
          <textarea
            value={draft.summary}
            onChange={(e) => patch({ summary: e.target.value.slice(0, 80) })}
            className={`${INPUT_CLASS} resize-none`}
            rows={2}
            placeholder="用一句话说明这个应用做什么"
          />
        </div>
      </section>

      {/* 核心功能 */}
      <CoreFeaturesSection
        features={draft.coreFeatures}
        onChange={(coreFeatures) => patch({ coreFeatures })}
      />

      {/* 辅助功能 */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <SectionIconLabel icon="lucide:plus" text="辅助功能" />
          <span className="text-[11px] text-[var(--color-text-tertiary)]">最多 2 条</span>
        </div>
        <div className="space-y-2">
          {draft.auxFeatures.map((feature, idx) => (
            <div key={`aux-${idx}`} className="flex items-center gap-2">
              <span className="shrink-0 px-1.5 py-0.5 rounded bg-[var(--color-text-tertiary)]/10 text-[10px] text-[var(--color-text-secondary)]">
                A{idx + 1}
              </span>
              <input
                value={feature.name}
                onChange={(e) => {
                  const next = [...draft.auxFeatures];
                  next[idx] = { ...feature, name: e.target.value };
                  patch({ auxFeatures: next });
                }}
                className={`${INPUT_CLASS} max-w-[140px]`}
                placeholder="名称"
              />
              <input
                value={feature.description}
                onChange={(e) => {
                  const next = [...draft.auxFeatures];
                  next[idx] = { ...feature, description: e.target.value };
                  patch({ auxFeatures: next });
                }}
                className={INPUT_CLASS}
                placeholder="描述"
              />
              <RemoveButton
                label={`删除辅助功能 A${idx + 1}`}
                onClick={() => patch({ auxFeatures: draft.auxFeatures.filter((_, i) => i !== idx) })}
              />
            </div>
          ))}
        </div>
        <div className="mt-2">
          <AddButton
            text="添加辅助功能"
            disabled={draft.auxFeatures.length >= 2}
            onClick={() => patch({ auxFeatures: [...draft.auxFeatures, { name: '', description: '' }] })}
          />
        </div>
      </section>

      {/* 数据模型 */}
      <DataModelSection
        entities={draft.entities}
        storageKey={draft.storageKey}
        onEntitiesChange={(entities) => patch({ entities })}
        onStorageKeyChange={(storageKey) => patch({ storageKey })}
      />

      {/* 布局与主题色 */}
      <section className="space-y-3">
        <div>
          <FieldLabel text="布局描述" />
          <input
            value={draft.uiLayout}
            onChange={(e) => patch({ uiLayout: e.target.value })}
            className={INPUT_CLASS}
            placeholder="如：顶部标题栏 + 中间主内容 + 底部操作栏"
          />
        </div>
        <div>
          <FieldLabel text="主题色" />
          <input
            value={draft.themePrimary}
            onChange={(e) => patch({ themePrimary: e.target.value })}
            className={INPUT_CLASS}
            placeholder="十六进制值（如：#16bf80）"
          />
        </div>
      </section>

      {/* 假设 */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <SectionIconLabel icon="lucide:lightbulb" text="AI 假设" />
          <span className="text-[11px] text-[var(--color-text-tertiary)]">修改假设可让生成结果更贴近预期</span>
        </div>
        <div className="space-y-2">
          {draft.assumptions.map((item, idx) => (
            <div key={`assumption-${idx}`} className="flex items-center gap-2">
              <input
                value={item.assumption}
                onChange={(e) => {
                  const next = [...draft.assumptions];
                  next[idx] = { ...item, assumption: e.target.value };
                  patch({ assumptions: next });
                }}
                className={INPUT_CLASS}
                placeholder="假设内容"
              />
              <input
                value={item.reason}
                onChange={(e) => {
                  const next = [...draft.assumptions];
                  next[idx] = { ...item, reason: e.target.value };
                  patch({ assumptions: next });
                }}
                className={`${INPUT_CLASS} max-w-[160px]`}
                placeholder="理由（可选）"
              />
              <RemoveButton
                label={`删除假设 ${idx + 1}`}
                onClick={() => patch({ assumptions: draft.assumptions.filter((_, i) => i !== idx) })}
              />
            </div>
          ))}
        </div>
        <div className="mt-2">
          <AddButton
            text="添加假设"
            onClick={() => patch({ assumptions: [...draft.assumptions, { assumption: '', reason: '' }] })}
          />
        </div>
      </section>

      {/* 待确认问题 */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <SectionIconLabel icon="lucide:help-circle" text="待确认问题" />
          <span className="text-[11px] text-[var(--color-text-tertiary)]">最多 3 个</span>
        </div>
        <div className="space-y-2">
          {draft.questions.map((question, idx) => (
            <div key={`question-${idx}`} className="flex items-center gap-2">
              <span className="text-[12px] text-amber-500 font-medium shrink-0">{idx + 1}.</span>
              <input
                value={question}
                onChange={(e) => {
                  const next = [...draft.questions];
                  next[idx] = e.target.value;
                  patch({ questions: next });
                }}
                className={INPUT_CLASS}
                placeholder="需要确认的问题"
              />
              <RemoveButton
                label={`删除问题 ${idx + 1}`}
                onClick={() => patch({ questions: draft.questions.filter((_, i) => i !== idx) })}
              />
            </div>
          ))}
        </div>
        <div className="mt-2">
          <AddButton
            text="添加问题"
            disabled={draft.questions.length >= 3}
            onClick={() => patch({ questions: [...draft.questions, ''] })}
          />
        </div>
      </section>

      {/* 操作栏 */}
      <div className="flex items-center gap-3 pt-3 border-t border-[var(--color-border-default)]">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-base)] transition-colors"
        >
          取消编辑
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          title={canSubmit ? undefined : '需填写应用标题，且核心功能为 2 至 4 条'}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-[13px] font-medium hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Icon icon="lucide:rocket" width={14} height={14} />
          保存并生成
        </button>
      </div>
    </div>
  );
}
