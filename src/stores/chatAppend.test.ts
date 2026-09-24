// @vitest-environment jsdom
/**
 * 消息追加诊断测试
 * 验证 addMessage 后状态是否正确更新，以及项目详情的 localStorage 持久化。
 *
 * 持久化键名结构（storageKey 约定）：litpp:v1:projects:<id>
 * 信封结构：{ schemaVersion, savedAt, data: Project }（data.chat 为消息数组）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../stores/projectStore';
import type { ChatMessage, Project } from '../types/project';
import { CURRENT_SCHEMA_VERSION, type StorageEnvelope } from '../types/storage';

describe('消息追加诊断', () => {
  beforeEach(() => {
    localStorage.clear();
    // 重置 store
    useProjectStore.setState({
      currentId: null,
      currentProject: null,
      summaries: [],
      versions: [],
      currentVersionId: null,
    });
  });

  it('addMessage 应该正确追加消息到 chat 数组', () => {
    // 1. 创建项目
    const project = useProjectStore.getState().createProject('测试项目');
    expect(project).toBeDefined();
    expect(project.id).toBeDefined();

    // 2. 验证当前项目状态
    const state1 = useProjectStore.getState();
    expect(state1.currentProject).toBeDefined();
    expect(state1.currentProject?.chat).toEqual([]);

    // 3. 添加第一条消息
    useProjectStore.getState().addMessage({
      role: 'user',
      content: '测试消息 1',
      runId: 'run-1',
      intentType: 'create',
    });

    // 4. 验证消息已追加
    const state2 = useProjectStore.getState();
    expect(state2.currentProject?.chat.length).toBe(1);
    const msg1 = state2.currentProject?.chat[0] as ChatMessage | undefined;
    expect(msg1).toBeDefined();
    expect(msg1?.role).toBe('user');
    expect(msg1?.content).toBe('测试消息 1');
    expect(msg1?.runId).toBe('run-1');

    // 5. 添加第二条消息（assistant）
    useProjectStore.getState().addMessage({
      role: 'assistant',
      content: '这是回复',
      runId: 'run-1',
      intentType: 'create',
    });

    // 6. 验证第二条消息已追加
    const state3 = useProjectStore.getState();
    expect(state3.currentProject?.chat.length).toBe(2);
    const msg2 = state3.currentProject?.chat[1] as ChatMessage | undefined;
    expect(msg2).toBeDefined();
    expect(msg2?.role).toBe('assistant');
    expect(msg2?.content).toBe('这是回复');
    expect(msg2?.runId).toBe('run-1');

    // 7. 添加第二条 run 的消息
    useProjectStore.getState().addMessage({
      role: 'user',
      content: '修改请求',
      runId: 'run-2',
      intentType: 'modify',
    });

    // 8. 验证第三条消息已追加
    const state4 = useProjectStore.getState();
    expect(state4.currentProject?.chat.length).toBe(3);
    const msg3 = state4.currentProject?.chat[2] as ChatMessage | undefined;
    expect(msg3).toBeDefined();
    expect(msg3?.role).toBe('user');
    expect(msg3?.runId).toBe('run-2');
    expect(msg3?.intentType).toBe('modify');
  });

  it('消息应该持久化到 localStorage', () => {
    // 1. 创建项目
    const project = useProjectStore.getState().createProject('持久化测试');

    // 2. 添加消息（addMessage 内部同步调用 persistProjectDetail）
    useProjectStore.getState().addMessage({
      role: 'user',
      content: '测试持久化',
      runId: 'run-test',
    });

    // 3. 从 localStorage 读取项目详情
    // 键名：storageKey('projects', id) = litpp:v1:projects:<id>（含 v1 代际段）
    const key = `litpp:v1:projects:${project.id}`;
    const raw = localStorage.getItem(key);
    expect(raw).not.toBeNull();

    // 4. 解析信封并验证：{ schemaVersion, savedAt, data: Project }
    const envelope = JSON.parse(raw as string) as StorageEnvelope<Project>;
    expect(envelope.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(typeof envelope.savedAt).toBe('string');
    expect(Array.isArray(envelope.data.chat)).toBe(true);
    expect(envelope.data.chat.length).toBe(1);
    expect(envelope.data.chat[0]?.content).toBe('测试持久化');
    expect(envelope.data.chat[0]?.runId).toBe('run-test');
  });

  it('zustand persist 索引键不应包含 chat（详情走独立键）', () => {
    // zustand persist 中间件写 litpp:v1:projects（无 id 段），
    // partialize 只含 currentId/summaries/currentVersionId，不含 currentProject。
    // 项目详情（含 chat）由 persistProjectDetail 写入 litpp:v1:projects:<id>
    const project = useProjectStore.getState().createProject('索引分离测试');
    useProjectStore.getState().addMessage({ role: 'user', content: '分离验证', runId: 'run-sep' });

    // 索引键存在但不含 chat
    const indexRaw = localStorage.getItem('litpp:v1:projects');
    expect(indexRaw).not.toBeNull();
    const indexState = JSON.parse(indexRaw as string) as { state?: Record<string, unknown> };
    expect(indexState.state?.currentId).toBe(project.id);
    expect(indexState.state?.currentProject).toBeUndefined();
    expect(indexState.state?.chat).toBeUndefined();

    // 详情键存在且含 chat
    const detailRaw = localStorage.getItem(`litpp:v1:projects:${project.id}`);
    expect(detailRaw).not.toBeNull();
    const detail = JSON.parse(detailRaw as string) as StorageEnvelope<Project>;
    expect(detail.data.chat.length).toBe(1);
    expect(detail.data.chat[0]?.content).toBe('分离验证');
  });

  it('多次 addMessage 应该保持消息顺序', () => {
    // 1. 创建项目
    useProjectStore.getState().createProject('顺序测试');

    // 2. 添加多条消息
    const messages = [
      { role: 'user' as const, content: '消息 1', runId: 'run-1' },
      { role: 'assistant' as const, content: '回复 1', runId: 'run-1' },
      { role: 'user' as const, content: '消息 2', runId: 'run-2' },
      { role: 'assistant' as const, content: '回复 2', runId: 'run-2' },
    ];

    for (const msg of messages) {
      useProjectStore.getState().addMessage(msg);
    }

    // 3. 验证顺序
    const chat = useProjectStore.getState().currentProject?.chat ?? [];
    expect(chat.length).toBe(4);
    expect(chat[0]?.content).toBe('消息 1');
    expect(chat[1]?.content).toBe('回复 1');
    expect(chat[2]?.content).toBe('消息 2');
    expect(chat[3]?.content).toBe('回复 2');
  });
});