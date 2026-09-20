/**
 * 需求编辑器复杂区块：核心功能列表、数据模型列表。
 * 每个区块接收草稿切片与更新回调，由 RequirementEditor 统一组装。
 */
import { Icon } from '@iconify/react';
import { INPUT_CLASS, FieldLabel, RemoveButton, AddButton } from './editorUi';
import type { CoreFeatureDraft, EntityDraft } from './editorHelpers';

/** 核心功能区块 Props */
export interface CoreFeaturesSectionProps {
  features: CoreFeatureDraft[];
  /** 更新整个核心功能草稿列表 */
  onChange: (next: CoreFeatureDraft[]) => void;
}

/** 核心功能编辑区块（约束：2 至 4 条） */
export function CoreFeaturesSection({ features, onChange }: CoreFeaturesSectionProps) {
  const updateAt = (idx: number, partial: Partial<CoreFeatureDraft>) => {
    const next = [...features];
    next[idx] = { ...features[idx]!, ...partial };
    onChange(next);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
          核心功能（{features.length}）
        </span>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">2 至 4 条</span>
      </div>
      <div className="space-y-2">
        {features.map((feature, idx) => (
          <div key={`core-${idx}`} className="rounded-lg border border-[var(--color-border-default)] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="shrink-0 px-1.5 py-0.5 rounded bg-[var(--color-accent)]/10 text-[10px] font-medium text-[var(--color-accent)]">
                F{idx + 1}
              </span>
              <input
                value={feature.name}
                onChange={(e) => updateAt(idx, { name: e.target.value })}
                className={INPUT_CLASS}
                placeholder="功能名称"
              />
              <RemoveButton
                label={`删除核心功能 F${idx + 1}`}
                disabled={features.length <= 2}
                onClick={() => onChange(features.filter((_, i) => i !== idx))}
              />
            </div>
            <textarea
              value={feature.description}
              onChange={(e) => updateAt(idx, { description: e.target.value })}
              className={`${INPUT_CLASS} resize-none`}
              rows={2}
              placeholder="功能描述（含具体交互方式）"
            />
            <input
              value={feature.ui}
              onChange={(e) => updateAt(idx, { ui: e.target.value })}
              className={INPUT_CLASS}
              placeholder="界面元素描述（如：带数字显示的圆形计时器）"
            />
            <input
              value={feature.interactionsText}
              onChange={(e) => updateAt(idx, { interactionsText: e.target.value })}
              className={INPUT_CLASS}
              placeholder="交互方式，用顿号分隔（如：点击开始、点击暂停）"
            />
          </div>
        ))}
      </div>
      <div className="mt-2">
        <AddButton
          text="添加核心功能"
          disabled={features.length >= 4}
          onClick={() => onChange([...features, { name: '', description: '', ui: '', interactionsText: '' }])}
        />
      </div>
    </section>
  );
}

/** 数据模型区块 Props */
export interface DataModelSectionProps {
  entities: EntityDraft[];
  storageKey: string;
  onEntitiesChange: (next: EntityDraft[]) => void;
  onStorageKeyChange: (next: string) => void;
}

/** 数据模型编辑区块（实体列表 + 存储键） */
export function DataModelSection({ entities, storageKey, onEntitiesChange, onStorageKeyChange }: DataModelSectionProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">数据模型</span>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">字段格式：名称:类型（文本/数字/布尔/数组/对象）</span>
      </div>
      <div className="space-y-2">
        {entities.map((entity, idx) => (
          <div key={`entity-${idx}`} className="rounded-lg border border-[var(--color-border-default)] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={entity.name}
                onChange={(e) => {
                  const next = [...entities];
                  next[idx] = { ...entity, name: e.target.value };
                  onEntitiesChange(next);
                }}
                className={INPUT_CLASS}
                placeholder="实体名称（如：任务）"
              />
              <RemoveButton
                label={`删除实体 ${entity.name || idx + 1}`}
                onClick={() => onEntitiesChange(entities.filter((_, i) => i !== idx))}
              />
            </div>
            <input
              value={entity.fieldsText}
              onChange={(e) => {
                const next = [...entities];
                next[idx] = { ...entity, fieldsText: e.target.value };
                onEntitiesChange(next);
              }}
              className={INPUT_CLASS}
              placeholder="字段列表（如：任务名:string、已完成:boolean）"
            />
          </div>
        ))}
      </div>
      <div className="mt-2">
        <AddButton
          text="添加实体"
          onClick={() => onEntitiesChange([...entities, { name: '', fieldsText: '' }])}
        />
      </div>
      <div className="mt-2">
        <FieldLabel text="localStorage 存储键" />
        <input
          value={storageKey}
          onChange={(e) => onStorageKeyChange(e.target.value)}
          className={INPUT_CLASS}
          placeholder="如：pomodoro-tasks"
        />
      </div>
    </section>
  );
}

/** 区块标题复用（带图标） */
export function SectionIconLabel({ icon, text }: { icon: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-text-secondary)]">
      <Icon icon={icon} width={13} height={13} className="text-[var(--color-text-tertiary)]" />
      {text}
    </span>
  );
}
