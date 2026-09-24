/**
 * 存储同步层回归测试：
 * - mergeProjects：服务端项目缺 framework 时的字段级合并保护（D-2 脏写修复）
 * - persistProjectDetail：写回前字段完整性校验与恢复
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mergeProjects } from './apiSync';
import { persistProjectDetail } from './localPersistence';
import { storageKey } from '../../types/storage';
import type { Project } from '../../types/project';

function makeProject(overrides: Partial<Project> = {}): Project {
  const files: Project['files'] = {
    '/index.html': {
      path: '/index.html',
      content: '<!DOCTYPE html><html><body>demo</body></html>',
      language: 'html',
      updatedAt: '2026-09-24T00:00:00.000Z',
    },
  };
  return {
    id: 'p-1',
    name: '测试项目',
    description: '',
    status: 'ready',
    files,
    chat: [],
    preview: { extraSandboxFlags: [], sizeMode: 'autoHeight' },
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('mergeProjects', () => {
  it('远程更新时覆盖本地，但本地独有字段（framework）保留', () => {
    const local = makeProject({ framework: 'react-cdn', updatedAt: '2026-09-24T01:00:00.000Z' });
    // 模拟服务端项目：契约未收录 framework，字段天然缺失，且 updatedAt 更新
    const remote = makeProject({
      id: 'p-1',
      updatedAt: '2026-09-24T02:00:00.000Z',
      name: '服务端版本',
    });
    remote.framework = undefined;

    const merged = mergeProjects([local], [remote]);
    const project = merged.find((p) => p.id === 'p-1');

    expect(project).toBeDefined();
    expect(project?.name).toBe('服务端版本');
    expect(project?.updatedAt).toBe('2026-09-24T02:00:00.000Z');
    expect(project?.framework).toBe('react-cdn');
  });

  it('远程未更新时本地整体保留', () => {
    const local = makeProject({ framework: 'react-cdn', updatedAt: '2026-09-24T03:00:00.000Z' });
    const remote = makeProject({ id: 'p-1', updatedAt: '2026-09-24T01:00:00.000Z', name: '旧版本' });

    const merged = mergeProjects([local], [remote]);
    const project = merged.find((p) => p.id === 'p-1');

    expect(project?.name).toBe('测试项目');
    expect(project?.framework).toBe('react-cdn');
  });

  it('本地不存在的远程项目直接并入', () => {
    const remote = makeProject({ id: 'p-new', name: '新项目' });
    const merged = mergeProjects([], [remote]);

    expect(merged.find((p) => p.id === 'p-new')?.name).toBe('新项目');
  });
});

describe('persistProjectDetail 字段完整性防御', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
  });

  it('内存态对象缺 framework 时用既有持久化值补齐', () => {
    const key = storageKey('projects', 'p-1');
    // 预置完整的既有数据
    persistProjectDetail(makeProject({ framework: 'react-cdn' }));

    // 模拟脏对象：framework 丢失
    const dirty = makeProject({ updatedAt: '2026-09-24T04:00:00.000Z' });
    dirty.framework = undefined;
    persistProjectDetail(dirty);

    const saved = JSON.parse(store.get(key) ?? '{}') as { data: Project };
    expect(saved.data.framework).toBe('react-cdn');
    expect(saved.data.updatedAt).toBe('2026-09-24T04:00:00.000Z');
  });

  it('字段齐全的对象按原样写入，不引入多余字段', () => {
    const key = storageKey('projects', 'p-1');
    const project = makeProject({ framework: 'html' });
    persistProjectDetail(project);

    const saved = JSON.parse(store.get(key) ?? '{}') as { data: Project };
    expect(saved.data).toEqual(project);
  });

  it('既有详情也缺 framework 时从摘要索引兜底恢复', () => {
    // 预置摘要索引（zustand persist 信封格式），其中 framework 仍在
    store.set(
      storageKey('projects'),
      JSON.stringify({
        state: {
          currentId: 'p-1',
          summaries: [{ id: 'p-1', name: '测试项目', status: 'ready', framework: 'react-cdn', updatedAt: '', entryBytes: 0 }],
          currentVersionId: null,
        },
        version: 0,
      }),
    );

    const dirty = makeProject();
    dirty.framework = undefined;
    persistProjectDetail(dirty);

    const saved = JSON.parse(store.get(storageKey('projects', 'p-1')) ?? '{}') as { data: Project };
    expect(saved.data.framework).toBe('react-cdn');
  });
});
