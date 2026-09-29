/**
 * 作品广场路由测试：发布 / 列表 / fork / 删除权限。
 *
 * 隔离：顶层在动态 import 之前设置 ATOMS_DATA_DIR 指向临时目录，
 * db.ts 按该目录初始化 SQLite，绝不触碰真实 data/atoms.db。
 * 认证：走真实 authRouter 注册流程拿会话 cookie，requireAuth 全链路真实生效。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'atoms-gallery-test-'));
process.env.ATOMS_DATA_DIR = tmpDataDir;

// 环境变量就位后再加载被测模块（db.ts 在模块加载期打开数据库）
const { galleryRouter } = await import('./gallery.js');
const { authRouter } = await import('./auth.js');
const dbModule = await import('../db.js');
import type { Project, ProjectFramework } from '../types.js';

/** 固定 UUID（seed 填充，用例间互不相同） */
function fixedUuid(seed: string): string {
  const hex = Array.from(seed).map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** 注册用户并返回会话令牌与用户 ID */
async function registerUser(username: string): Promise<{ token: string; userId: string }> {
  const res = await authRouter.request('/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'test-password-123' }),
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status).toBe(201);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = /atoms_session=([^;]+)/.exec(setCookie);
  if (!match) throw new Error('注册响应缺少会话 cookie');
  const body = (await res.json()) as { user: { id: string } };
  return { token: match[1], userId: body.user.id };
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Cookie: `atoms_session=${token}` };
}

function makeEntryFile(content: string): Project['files'] {
  const now = new Date().toISOString();
  return {
    '/index.html': {
      path: '/index.html',
      content,
      language: 'html',
      updatedAt: now,
    },
  };
}

/** 直接经 db 层创建属于指定用户的项目（发布前置数据） */
function createOwnedProject(
  id: string,
  userId: string,
  name: string,
  files: Project['files'],
  framework?: ProjectFramework,
): void {
  const now = new Date().toISOString();
  const project: Project = {
    id,
    name,
    description: '',
    status: 'ready',
    framework,
    files,
    chat: [],
    preview: { extraSandboxFlags: [], sizeMode: 'autoHeight' },
    createdAt: now,
    updatedAt: now,
  };
  dbModule.createProject(project, userId);
}

/** 迭代既有项目（createProject 是 INSERT OR IGNORE，同 id 更新必须走 updateProject） */
function updateOwnedProject(
  id: string,
  userId: string,
  name: string,
  files: Project['files'],
): void {
  const existing = dbModule.getProject(id, userId);
  if (!existing) throw new Error(`测试前置失败：项目 ${id} 不存在`);
  const now = new Date().toISOString();
  const updated: Project = {
    ...existing.data,
    name,
    files,
    updatedAt: now,
  };
  if (!dbModule.updateProject(id, updated, userId)) {
    throw new Error(`测试前置失败：项目 ${id} 更新失败`);
  }
}

/** 以指定用户身份发布项目，返回响应 */
function publish(token: string, projectId: string, description?: string) {
  return galleryRouter.request('/', {
    method: 'POST',
    body: JSON.stringify({ projectId, ...(description !== undefined ? { description } : {}) }),
    headers: authHeaders(token),
  });
}

afterAll(() => {
  try {
    rmSync(tmpDataDir, { recursive: true, force: true });
  } catch {
    // 尽力清理，失败不影响测试结论
  }
});

describe('作品广场：发布快照', () => {
  const alice = { token: '', userId: '' };

  it('前置：注册用户 alice 并创建项目', async () => {
    const session = await registerUser('gallery_alice');
    alice.token = session.token;
    alice.userId = session.userId;
    createOwnedProject(fixedUuid('gal-alice-proj-0000000000000001'), alice.userId, '画廊项目', makeEntryFile('<html>v1</html>'), 'react-cdn');
  });

  it('未登录发布 → 401', async () => {
    const res = await galleryRouter.request('/', {
      method: 'POST',
      body: JSON.stringify({ projectId: fixedUuid('gal-alice-proj-0000000000000001') }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('发布成功 → 201；详情公开可读，含快照 files/html/作者名/框架', async () => {
    const projectId = fixedUuid('gal-alice-proj-0000000000000001');
    const res = await publish(alice.token, projectId, '我的第一个作品');
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(id).toBeTruthy();

    // 公开访问详情（无 cookie）
    const detailRes = await galleryRouter.request(`/${id}`, { method: 'GET' });
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      id: string;
      project_id: string;
      project_name: string;
      owner_name: string;
      description: string | null;
      framework?: string;
      files: Record<string, { content: string }> | null;
      html: string;
      fork_count: number;
    };
    expect(detail.project_id).toBe(projectId);
    expect(detail.project_name).toBe('画廊项目');
    expect(detail.owner_name).toBe('gallery_alice');
    expect(detail.description).toBe('我的第一个作品');
    expect(detail.framework).toBe('react-cdn');
    expect(detail.files?.['/index.html']?.content).toBe('<html>v1</html>');
    expect(detail.html).toBe('<html>v1</html>');
    expect(detail.fork_count).toBe(0);
  });

  it('重复发布 → 更新快照（200 updated:true），总数不变，内容为新版本', async () => {
    const projectId = fixedUuid('gal-alice-proj-0000000000000001');

    // 项目迭代到 v2 后再次发布
    updateOwnedProject(projectId, alice.userId, '画廊项目 v2', makeEntryFile('<html>v2</html>'));
    const res = await publish(alice.token, projectId, '更新后的简介');
    expect(res.status).toBe(200);
    const { id, updated } = (await res.json()) as { id: string; updated: boolean };
    expect(updated).toBe(true);

    const listRes = await galleryRouter.request('/', { method: 'GET' });
    const list = (await listRes.json()) as { items: unknown[]; total: number };
    expect(list.total).toBe(1);

    const detailRes = await galleryRouter.request(`/${id}`, { method: 'GET' });
    const detail = (await detailRes.json()) as { html: string; description: string | null; project_name: string };
    expect(detail.html).toBe('<html>v2</html>');
    expect(detail.description).toBe('更新后的简介');
    expect(detail.project_name).toBe('画廊项目 v2');
  });

  it('发布校验：缺 projectId → 400；简介超 200 字符 → 400；非字符串简介 → 400', async () => {
    const missing = await galleryRouter.request('/', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: authHeaders(alice.token),
    });
    expect(missing.status).toBe(400);

    const tooLong = await publish(alice.token, fixedUuid('gal-alice-proj-0000000000000001'), '长'.repeat(201));
    expect(tooLong.status).toBe(400);

    const notString = await galleryRouter.request('/', {
      method: 'POST',
      body: JSON.stringify({ projectId: fixedUuid('gal-alice-proj-0000000000000001'), description: 123 }),
      headers: authHeaders(alice.token),
    });
    expect(notString.status).toBe(400);
  });

  it('发布他人项目 → 404（不泄露存在性）；项目不存在 → 404', async () => {
    const bob = await registerUser('gallery_bob');
    const othersProject = fixedUuid('gal-alice-proj-0000000000000001');
    const res = await publish(bob.token, othersProject);
    expect(res.status).toBe(404);

    const missing = await publish(alice.token, fixedUuid('gal-not-exist-000000000000000001'));
    expect(missing.status).toBe(404);
  });
});

describe('作品广场：公开列表', () => {
  it('列表公开访问；列表项不含 files/html 大字段', async () => {
    const carol = await registerUser('gallery_carol');
    createOwnedProject(fixedUuid('gal-carol-proj-0000000000000001'), carol.userId, '列表项目', makeEntryFile('<html>list</html>'));
    const publishRes = await publish(carol.token, fixedUuid('gal-carol-proj-0000000000000001'), '列表简介');
    expect(publishRes.status).toBe(201);

    const res = await galleryRouter.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const list = (await res.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    expect(list.total).toBeGreaterThanOrEqual(2);
    const hit = list.items.find((item) => item.project_name === '列表项目');
    expect(hit).toBeDefined();
    expect(hit?.owner_name).toBe('gallery_carol');
    expect(hit?.description).toBe('列表简介');
    expect(hit && ('files' in hit || 'html' in hit)).toBe(false);
  });

  it('limit 钳制：limit=1 只返回 1 条且 total 不变；非法 limit 回退默认', async () => {
    const res = await galleryRouter.request('/?limit=1', { method: 'GET' });
    const list = (await res.json()) as { items: unknown[]; total: number };
    expect(list.items.length).toBe(1);

    const fallback = await galleryRouter.request('/?limit=abc', { method: 'GET' });
    const fallbackList = (await fallback.json()) as { items: unknown[]; total: number };
    expect(fallbackList.items.length).toBe(Math.min(fallbackList.total, 20));
  });

  it('sort=forks：被 fork 过的作品排在前', async () => {
    const dave = await registerUser('gallery_dave');
    const projId = fixedUuid('gal-dave-proj-000000000000000001');
    createOwnedProject(projId, dave.userId, '被复刻项目', makeEntryFile('<html>fork me</html>'));
    const publishRes = await publish(dave.token, projId);
    expect(publishRes.status).toBe(201);
    const { id } = (await publishRes.json()) as { id: string };

    const forkRes = await galleryRouter.request(`/${id}/fork`, {
      method: 'POST',
      headers: authHeaders(dave.token),
    });
    expect(forkRes.status).toBe(201);

    const res = await galleryRouter.request('/?sort=forks', { method: 'GET' });
    const list = (await res.json()) as { items: Array<{ id: string; fork_count: number }> };
    expect(list.items[0]?.id).toBe(id);
    expect(list.items[0]?.fork_count).toBe(1);
  });
});

describe('作品广场：fork 复刻', () => {
  it('未登录 fork → 401；作品不存在 → 404', async () => {
    const unauth = await galleryRouter.request(`/${fixedUuid('gal-fork-missing-000000000000001')}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(unauth.status).toBe(401);

    const someone = await registerUser('gallery_forker');
    const missing = await galleryRouter.request(`/${fixedUuid('gal-fork-missing-000000000000001')}/fork`, {
      method: 'POST',
      headers: authHeaders(someone.token),
    });
    expect(missing.status).toBe(404);
  });

  it('fork 成功 → 新项目落在 fork 用户名下，名称带（复刻）后缀，files/framework 复制，fork_count +1', async () => {
    const erin = await registerUser('gallery_erin');
    const projId = fixedUuid('gal-erin-proj-000000000000000001');
    createOwnedProject(projId, erin.userId, '复刻源项目', makeEntryFile('<html>origin</html>'), 'vue-cdn');
    const publishRes = await publish(erin.token, projId, '复刻源简介');
    expect(publishRes.status).toBe(201);
    const { id } = (await publishRes.json()) as { id: string };

    const forkRes = await galleryRouter.request(`/${id}/fork`, {
      method: 'POST',
      headers: authHeaders(erin.token),
    });
    expect(forkRes.status).toBe(201);
    const { projectId: forkedId } = (await forkRes.json()) as { projectId: string };
    expect(forkedId).toBeTruthy();

    // 新项目落在当前用户名下且内容复制
    const envelope = dbModule.getProject(forkedId, erin.userId);
    expect(envelope).not.toBeNull();
    const forkedProject = envelope!.data;
    expect(forkedProject.name).toBe('复刻源项目（复刻）');
    expect(forkedProject.description).toBe('复刻源简介');
    expect(forkedProject.framework).toBe('vue-cdn');
    expect(forkedProject.files['/index.html']?.content).toBe('<html>origin</html>');
    expect(forkedProject.status).toBe('ready');

    // fork_count +1
    const detailRes = await galleryRouter.request(`/${id}`, { method: 'GET' });
    const detail = (await detailRes.json()) as { fork_count: number };
    expect(detail.fork_count).toBe(1);

    // fork 后项目继续迭代不影响已发布快照（快照语义）
    const detailBefore = (await (await galleryRouter.request(`/${id}`, { method: 'GET' })).json()) as { html: string };
    updateOwnedProject(projId, erin.userId, '复刻源项目 v2', makeEntryFile('<html>changed</html>'));
    const detailAfter = (await (await galleryRouter.request(`/${id}`, { method: 'GET' })).json()) as { html: string };
    expect(detailAfter.html).toBe(detailBefore.html);
  });
});

describe('作品广场：删除权限', () => {
  it('非作者删除 → 403；作者删除 → success；删除后详情 404；再删 → 404', async () => {
    const frank = await registerUser('gallery_frank');
    const grace = await registerUser('gallery_grace');
    const projId = fixedUuid('gal-frank-proj-00000000000000001');
    createOwnedProject(projId, frank.userId, '待删除项目', makeEntryFile('<html>del</html>'));
    const publishRes = await publish(frank.token, projId);
    expect(publishRes.status).toBe(201);
    const { id } = (await publishRes.json()) as { id: string };

    // 非作者删除 → 403
    const forbidden = await galleryRouter.request(`/${id}`, {
      method: 'DELETE',
      headers: authHeaders(grace.token),
    });
    expect(forbidden.status).toBe(403);

    // 删除后确认仍存在（403 路径不得误删）
    const stillThere = await galleryRouter.request(`/${id}`, { method: 'GET' });
    expect(stillThere.status).toBe(200);

    // 作者删除 → success
    const ok = await galleryRouter.request(`/${id}`, {
      method: 'DELETE',
      headers: authHeaders(frank.token),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { success: boolean }).success).toBe(true);

    // 删除后详情 404，重复删除 404
    const gone = await galleryRouter.request(`/${id}`, { method: 'GET' });
    expect(gone.status).toBe(404);
    const again = await galleryRouter.request(`/${id}`, {
      method: 'DELETE',
      headers: authHeaders(frank.token),
    });
    expect(again.status).toBe(404);
  });

  it('未登录删除 → 401', async () => {
    const res = await galleryRouter.request(`/${fixedUuid('gal-del-unauth-000000000000001')}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });
});
