/**
 * FINAL-1 路由级测试：framework 字段在 POST / GET / PUT 同步链路的保留与防御。
 *
 * 隔离：顶层在动态 import 之前设置 ATOMS_DATA_DIR 指向临时目录，
 * db.ts 按该目录初始化 SQLite，绝不触碰真实 data/atoms.db。
 * 存量无 framework 项目通过手工 INSERT 历史形态行模拟，绕开当前代码路径。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'atoms-projects-framework-test-'));
process.env.ATOMS_DATA_DIR = tmpDataDir;

// 环境变量就位后再加载被测模块（db.ts 在模块加载期打开数据库）
const { projectsRouter } = await import('./projects.js');
const dbModule = await import('../db.js');

const REACT_CDN = 'react-cdn' as const;
const VUE_CDN = 'vue-cdn' as const;

function fixedUuid(seed: string): string {
  // 8-4-4-4-12，用 seed 填充保证每个用例 id 固定且互不相同
  const hex = Array.from(seed).map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function postBody(id: string, framework: unknown) {
  return JSON.stringify({
    id,
    name: '同步项目',
    description: 'FINAL-1 回归',
    ...(framework !== undefined ? { framework } : {}),
  });
}

async function createProject(id: string, framework: unknown) {
  return projectsRouter.request('/', {
    method: 'POST',
    body: postBody(id, framework),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getProject(id: string): Promise<{ status: number; body: { data?: Record<string, unknown> } }> {
  const res = await projectsRouter.request(`/${id}`, { method: 'GET' });
  return { status: res.status, body: (await res.json()) as { data?: Record<string, unknown> } };
}

async function putProject(id: string, body: Record<string, unknown>) {
  return projectsRouter.request(`/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function listSummaries(): Promise<Array<Record<string, unknown>>> {
  const res = await projectsRouter.request('/', { method: 'GET' });
  expect(res.status).toBe(200);
  return (await res.json()) as Array<Record<string, unknown>>;
}

afterAll(() => {
  try {
    rmSync(tmpDataDir, { recursive: true, force: true });
  } catch {
    // 尽力清理，失败不影响测试结论
  }
});

describe('FINAL-1：POST/PUT 收录 framework，同步链路原样往返', () => {
  it('create 带 react-cdn → get 往返保留，落库 data 含 framework', async () => {
    const id = fixedUuid('f1react0000000000000000000000a');
    const created = await createProject(id, REACT_CDN);
    expect(created.status).toBe(201);

    const { status, body } = await getProject(id);
    expect(status).toBe(200);
    expect(body.data?.framework).toBe('react-cdn');
  });

  it('create→update→get 链路：PUT 换 vue-cdn 保留，PUT 不带 framework 保持现值', async () => {
    const id = fixedUuid('f1roundtrip0000000000000000000b');
    expect((await createProject(id, REACT_CDN)).status).toBe(201);

    const putRes = await putProject(id, { framework: VUE_CDN, name: '改名后' });
    expect(putRes.status).toBe(200);
    expect(((await putRes.json()) as { success: boolean }).success).toBe(true);

    const afterSwitch = await getProject(id);
    expect(afterSwitch.body.data?.framework).toBe('vue-cdn');
    expect(afterSwitch.body.data?.name).toBe('改名后');

    // PUT 不携带 framework：保持库内现值，不得回退或丢失
    await putProject(id, { name: '再改名' });
    const afterOmitted = await getProject(id);
    expect(afterOmitted.body.data?.framework).toBe('vue-cdn');
  });

  it('create 不带 framework → 不主动补写字段（缺省语义，后续 PUT 携带时再落库）', async () => {
    const id = fixedUuid('f1omitcreate0000000000000000000g');
    const created = await createProject(id, undefined);
    expect(created.status).toBe(201);

    const { status, body } = await getProject(id);
    expect(status).toBe(200);
    expect('framework' in (body.data ?? {})).toBe(false);
  });

  it('GET / 列表 summary 原样带出 framework', async () => {
    const id = fixedUuid('f1summary000000000000000000000c');
    expect((await createProject(id, REACT_CDN)).status).toBe(201);

    const summaries = await listSummaries();
    const hit = summaries.find((s) => s.id === id);
    expect(hit).toBeDefined();
    expect(hit?.framework).toBe('react-cdn');
  });
});

describe('FINAL-1：非法 framework 防御性回退 html，不 500', () => {
  it.each(['angular', 123, null, true, { framework: 'react-cdn' }])(
    'create 非法 framework（%p）→ 201，落库回退 html',
    async (bad) => {
      const id = fixedUuid(`f1badcreate${String(JSON.stringify(bad)).slice(0, 4)}`.padEnd(32, 'x').slice(0, 32));
      const created = await createProject(id, bad);
      expect(created.status).toBe(201);

      const { status, body } = await getProject(id);
      expect(status).toBe(200);
      expect(body.data?.framework).toBe('html');
    },
  );

  it('PUT 非法 framework → 200，落库回退 html（不炸、不保留非法值）', async () => {
    const id = fixedUuid('f1badput00000000000000000000000d');
    expect((await createProject(id, REACT_CDN)).status).toBe(201);

    const putRes = await putProject(id, { framework: 'svelte' });
    expect(putRes.status).toBe(200);

    const { status, body } = await getProject(id);
    expect(status).toBe(200);
    expect(body.data?.framework).toBe('html');
  });
});

describe('FINAL-1：存量无 framework 项目行为不变', () => {
  function insertLegacyRow(id: string): void {
    // 手工构造历史形态行：envelope JSON 完全不含 framework 键（绕开当前写入路径）
    const now = new Date().toISOString();
    const legacyEnvelope = {
      schemaVersion: 1,
      savedAt: now,
      data: {
        id,
        name: '存量项目',
        description: '',
        status: 'ready',
        files: {
          '/index.html': {
            path: '/index.html',
            content: '<!DOCTYPE html><html><body>legacy</body></html>',
            language: 'html',
            updatedAt: now,
          },
        },
        chat: [],
        preview: { extraSandboxFlags: [], sizeMode: 'autoHeight' },
        createdAt: now,
        updatedAt: now,
      },
    };
    dbModule.db
      .prepare(
        'INSERT OR IGNORE INTO projects (id, data, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, NULL)',
      )
      .run(id, JSON.stringify(legacyEnvelope), now, now);
  }

  it('GET /:id 原样返回：data 无 framework 键（服务端不补写，前端缺省 html）', async () => {
    const id = fixedUuid('f1legacyget00000000000000000000e');
    insertLegacyRow(id);

    const { status, body } = await getProject(id);
    expect(status).toBe(200);
    expect('framework' in (body.data ?? {})).toBe(false);
    expect(body.data?.name).toBe('存量项目');
  });

  it('GET / 列表 summary 同样不补写 framework 键', async () => {
    const id = fixedUuid('f1legacylist0000000000000000000f');
    insertLegacyRow(id);

    const summaries = await listSummaries();
    const hit = summaries.find((s) => s.id === id);
    expect(hit).toBeDefined();
    expect('framework' in (hit ?? {})).toBe(false);
  });

  it('存量项目 PUT 更新其他字段（不带 framework）→ 仍无 framework 键，不意外补写', async () => {
    const id = fixedUuid('f1legacyput000000000000000000010');
    insertLegacyRow(id);

    const putRes = await putProject(id, { name: '存量改名' });
    expect(putRes.status).toBe(200);

    const { status, body } = await getProject(id);
    expect(status).toBe(200);
    expect('framework' in (body.data ?? {})).toBe(false);
    expect(body.data?.name).toBe('存量改名');
  });
});
