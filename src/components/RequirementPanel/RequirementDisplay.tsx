/**
 * 需求文档只读展示区。
 * 按区块渲染 OptimizedRequirement 的全部字段：
 * 标题、类型、概述、核心功能、辅助功能、数据模型、布局与主题、假设、待确认问题。
 */
import { Icon } from '@iconify/react';
import type { OptimizedRequirement } from '../../services/ai/optimizer';
import { APP_TYPE_LABELS, THEME_TONE_LABELS, FIELD_TYPE_LABELS } from './types';

/** 区块标题（图标 + 文案） */
function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon icon={icon} width={13} height={13} className="text-[var(--color-text-tertiary)]" />
      <h4 className="text-[12px] font-medium text-[var(--color-text-secondary)]">{title}</h4>
    </div>
  );
}

/** 核心功能条目 */
function CoreFeatureItem({
  id,
  name,
  description,
  ui,
  interactions,
}: {
  id: string;
  name: string;
  description: string;
  ui: string;
  interactions: string[];
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border-default)] p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="shrink-0 px-1.5 py-0.5 rounded bg-[var(--color-accent)]/10 text-[10px] font-medium text-[var(--color-accent)]">
          {id}
        </span>
        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{name}</span>
      </div>
      <p className="text-[12px] leading-[1.6] text-[var(--color-text-secondary)]">{description}</p>
      {ui && (
        <p className="mt-1.5 text-[12px] leading-[1.6] text-[var(--color-text-tertiary)]">
          <span className="text-[var(--color-text-secondary)]">界面：</span>
          {ui}
        </p>
      )}
      {interactions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {interactions.map((item, idx) => (
            <span
              key={`${id}-interaction-${idx}`}
              className="px-1.5 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[11px] text-[var(--color-text-secondary)]"
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 数据模型区块 */
function DataModelSection({ entities, storageKey }: { entities: OptimizedRequirement['dataModel']['entities']; storageKey: string }) {
  return (
    <div className="space-y-2">
      {/* 防御：validator 仅保证 dataModel 为对象，entities 缺失时按空列表处理 */}
      {(Array.isArray(entities) ? entities : []).map((entity, idx) => (
        <div key={`entity-${idx}`} className="rounded-lg bg-[var(--color-bg-base)] px-3 py-2">
          <span className="text-[12px] font-medium text-[var(--color-text-primary)]">{entity.name}</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {entity.fields.map((field, fIdx) => (
              <span
                key={`field-${fIdx}`}
                className="px-1.5 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[11px] text-[var(--color-text-secondary)] font-mono"
                title={FIELD_TYPE_LABELS[field.type] ?? field.type}
              >
                {field.name}
                <span className="text-[var(--color-text-tertiary)]">: {field.type}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
      {storageKey && (
        <p className="text-[11px] text-[var(--color-text-tertiary)]">
          存储键：<code className="font-mono text-[var(--color-text-secondary)]">{storageKey}</code>（localStorage）
        </p>
      )}
    </div>
  );
}

/** 只读展示主体 */
export function RequirementDisplay({ requirement }: { requirement: OptimizedRequirement }) {
  const typeLabel = APP_TYPE_LABELS[requirement.appType] ?? requirement.appType;

  return (
    <div className="space-y-4">
      {/* 标题 + 类型 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)] truncate">
            {requirement.appTitle}
          </h3>
          <p className="mt-1 text-[13px] leading-[1.6] text-[var(--color-text-secondary)]">
            {requirement.summary}
          </p>
        </div>
        <span className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--color-bg-elevated)] text-[11px] text-[var(--color-text-secondary)]">
          <Icon icon="lucide:layout-template" width={12} height={12} />
          {typeLabel}
        </span>
      </div>

      {/* 核心功能 */}
      {requirement.coreFeatures.length > 0 && (
        <section>
          <SectionHeader icon="lucide:list-checks" title={`核心功能（${requirement.coreFeatures.length}）`} />
          <div className="space-y-2">
            {requirement.coreFeatures.map((feature) => (
              <CoreFeatureItem
                key={feature.id || feature.name}
                id={feature.id}
                name={feature.name}
                description={feature.description}
                ui={feature.ui}
                interactions={feature.interactions}
              />
            ))}
          </div>
        </section>
      )}

      {/* 辅助功能 */}
      {requirement.auxFeatures.length > 0 && (
        <section>
          <SectionHeader icon="lucide:plus" title="辅助功能" />
          <div className="space-y-2">
            {requirement.auxFeatures.map((feature) => (
              <div key={feature.id || feature.name} className="flex items-start gap-2">
                <span className="shrink-0 px-1.5 py-0.5 rounded bg-[var(--color-text-tertiary)]/10 text-[10px] text-[var(--color-text-secondary)]">
                  {feature.id}
                </span>
                <p className="text-[12px] leading-[1.6] text-[var(--color-text-secondary)]">
                  <span className="text-[var(--color-text-primary)]">{feature.name}</span>
                  {feature.description ? `：${feature.description}` : ''}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 数据模型 */}
      {Array.isArray(requirement.dataModel?.entities) && requirement.dataModel.entities.length > 0 && (
        <section>
          <SectionHeader icon="lucide:database" title="数据模型" />
          <DataModelSection
            entities={requirement.dataModel.entities}
            storageKey={requirement.dataModel.storageKey}
          />
        </section>
      )}

      {/* 布局与主题 */}
      {(requirement.uiLayout || requirement.theme) && (
        <section>
          <SectionHeader icon="lucide:palette" title="布局与主题" />
          <div className="rounded-lg bg-[var(--color-bg-base)] px-3 py-2 space-y-1.5">
            {requirement.uiLayout && (
              <p className="text-[12px] leading-[1.6] text-[var(--color-text-secondary)]">
                <span className="text-[var(--color-text-tertiary)]">布局：</span>
                {requirement.uiLayout}
              </p>
            )}
            {requirement.theme && (
              <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
                <span className="text-[var(--color-text-tertiary)]">主题：</span>
                <span
                  className="inline-block w-3.5 h-3.5 rounded border border-[var(--color-border-default)]"
                  style={{ backgroundColor: requirement.theme.primary || 'transparent' }}
                  title={requirement.theme.primary}
                />
                <span className="font-mono text-[11px]">{requirement.theme.primary}</span>
                <span className="text-[var(--color-text-tertiary)]">
                  （{THEME_TONE_LABELS[requirement.theme.tone] ?? requirement.theme.tone}）
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 假设 */}
      {requirement.assumptions.length > 0 && (
        <section>
          <SectionHeader icon="lucide:lightbulb" title="AI 假设" />
          <div className="space-y-1.5">
            {requirement.assumptions.map((item, idx) => (
              <div key={`assumption-${idx}`} className="flex items-start gap-2">
                <span className="mt-[7px] w-1 h-1 shrink-0 rounded-full bg-[var(--color-text-tertiary)]" />
                <p className="text-[12px] leading-[1.6] text-[var(--color-text-secondary)]">
                  {item.assumption}
                  {item.reason && (
                    <span className="text-[var(--color-text-tertiary)]">（{item.reason}）</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 待确认问题 */}
      {requirement.questions.length > 0 && (
        <section>
          <SectionHeader icon="lucide:help-circle" title="待确认问题" />
          <div className="space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            {requirement.questions.map((question, idx) => (
              <div key={`question-${idx}`} className="flex items-start gap-2">
                <span className="text-[12px] text-amber-500 font-medium">{idx + 1}.</span>
                <p className="text-[12px] leading-[1.6] text-[var(--color-text-secondary)]">{question}</p>
              </div>
            ))}
            <p className="text-[11px] text-[var(--color-text-tertiary)]">
              如需调整，可点击「编辑修改」直接改写相关内容。
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
