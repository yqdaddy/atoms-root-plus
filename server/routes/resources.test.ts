/**
 * 项目知识库资源路由测试：CRUD + 大小/数量/总量限制 + 用户隔离。
 *
 * 隔离：顶层在动态 import 之前设置 ATOMS_DATA_DIR 指向临时目录，
 * db.ts 按该目录初始化 SQLite，绝不触碰真实 data/atoms.db。
 * 认证：走真实 authRouter 注册流程拿会话 cookie，requireAuth 全链路真实生效。
 * 另覆盖 routes/llm.ts 的 buildProjectResourcesBlock（资料注入块：标记 / 截断）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'atoms-resources-test-'));
process.env.ATOMS_DATA_DIR = tmpDataDir;

// 环境变量就位后再加载被测模块（db.ts 在模块加载期打开数据库）
const { resourcesRouter, listProjectResources } = await import('./resources.js');
const { authRouter } = await import('./auth.js');
const { buildProjectResourcesBlock } = await import('./llm.js');

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

function createResource(token: string, projectId: string, name: string, content: string) {
  return resourcesRouter.request(`/${projectId}/resources`, {
    method: 'POST',
    body: JSON.stringify({ name, content }),
    headers: authHeaders(token),
  });
}

async function listResources(
  token: string,
  projectId: string,
): Promise<Array<{ id: string; name: string; content: string; size: number; created_at: number }>> {
  const res = await resourcesRouter.request(`/${projectId}/resources`, {
    method: 'GET',
    headers: authHeaders(token),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Array<{ id: string; name: string; content: string; size: number; created_at: number }>;
}

afterAll(() => {
  try {
    rmSync(tmpDataDir, { recursive: true, force: true });
  } catch {
    // 尽力清理，失败不影响测试结论
  }
});

describe('项目知识库：认证边界', () => {
  const projectId = 'res-proj-auth-00000000000000000001';

  it('未登录 GET / POST / DELETE → 全部 401', async () => {
    const getRes = await resourcesRouter.request(`/${projectId}/resources`, { method: 'GET' });
    expect(getRes.status).toBe(401);

    const postRes = await resourcesRouter.request(`/${projectId}/resources`, {
      method: 'POST',
      body: JSON.stringify({ name: '资料', content: '内容' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(postRes.status).toBe(401);

    const delRes = await resourcesRouter.request(`/${projectId}/resources/res-r-00000001`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(401);
  });
});

describe('项目知识库：CRUD', () => {
  const tokenPromise = registerUser('resource_crud');
  let token = '';
  const projectId = 'res-proj-crud-0000000000000000001';

  it('前置：注册用户', async () => {
    token = (await tokenPromise).token;
    expect(token).toBeTruthy();
  });

  it('POST 创建 → 201 响应含完整条目（content 回显）；GET 列表含 content/size/created_at', async () => {
    const res = await createResource(token, projectId, '需求说明', '应用需要深色主题');
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; name: string; content: string; size: number; created_at: number };
    expect(created.name).toBe('需求说明');
    expect(created.content).toBe('应用需要深色主题');
    expect(created.size).toBe(Buffer.byteLength('应用需要深色主题', 'utf8'));
    expect(created.created_at).toBeGreaterThan(0);

    const items = await listResources(token, projectId);
    expect(items.length).toBe(1);
    expect(items[0]?.name).toBe('需求说明');
    expect(items[0]?.content).toBe('应用需要深色主题');
    expect(items[0]?.size).toBe(created.size);
  });

  it('DELETE → success；重复删除 → 404；删除后列表为空', async () => {
    const items = await listResources(token, projectId);
    const resourceId = items[0]?.id;
    expect(resourceId).toBeTruthy();

    const delRes = await resourcesRouter.request(`/${projectId}/resources/${resourceId}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(delRes.status).toBe(200);
    expect(((await delRes.json()) as { success: boolean }).success).toBe(true);

    const again = await resourcesRouter.request(`/${projectId}/resources/${resourceId}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    expect(again.status).toBe(404);

    const after = await listResources(token, projectId);
    expect(after.length).toBe(0);
  });
});

describe('项目知识库：输入校验与大小限制', () => {
  let token = '';
  const projectId = 'res-proj-limit-0000000000000000001';

  it('前置：注册用户', async () => {
    token = (await registerUser('resource_limit')).token;
  });

  it('name 缺失 / 空 / 超 60 字符 → 400', async () => {
    expect((await createResource(token, projectId, '', '内容')).status).toBe(400);
    expect((await createResource(token, projectId, 'x'.repeat(61), '内容')).status).toBe(400);
    expect((await createResource(token, projectId, 'x'.repeat(60), '内容')).status).toBe(201);
  });

  it('content 缺失 / 空串 → 400', async () => {
    const missing = await resourcesRouter.request(`/${projectId}/resources`, {
      method: 'POST',
      body: JSON.stringify({ name: '无内容' }),
      headers: authHeaders(token),
    });
    expect(missing.status).toBe(400);
    expect((await createResource(token, projectId, '空内容', '')).status).toBe(400);
  });

  it('单条 16KB 按字节计量：16384 字节通过，16385 字节拒绝；中文按 UTF-8 字节算', async () => {
    expect((await createResource(token, projectId, '恰好16KB', 'a'.repeat(16384))).status).toBe(201);
    expect((await createResource(token, projectId, '超一个字节', 'a'.repeat(16385))).status).toBe(400);

    // '中' 为 3 字节：5462 个汉字 = 16386 字节 → 超限
    expect((await createResource(token, projectId, '中文超限', '中'.repeat(5462))).status).toBe(400);
  });

  it('条数上限：单项目第 21 条 → 400 带中文错误信息', async () => {
    const projectId = 'res-proj-count-0000000000000000001';
    for (let i = 1; i <= 20; i++) {
      const res = await createResource(token, projectId, `资料${i}`, 'x');
      expect(res.status).toBe(201);
    }
    const overflow = await createResource(token, projectId, '资料21', 'x');
    expect(overflow.status).toBe(400);
    const body = (await overflow.json()) as { error: string };
    expect(body.error).toContain('20');
  });

  it('总量上限：两条 16KB 恰好 32KB 通过，再加任意内容 → 400 带中文错误信息', async () => {
    const projectId = 'res-proj-total-0000000000000000001';
    expect((await createResource(token, projectId, '第一条', 'a'.repeat(16384))).status).toBe(201);
    expect((await createResource(token, projectId, '第二条', 'b'.repeat(16384))).status).toBe(201);
    const overflow = await createResource(token, projectId, '第三条', 'c');
    expect(overflow.status).toBe(400);
    const body = (await overflow.json()) as { error: string };
    expect(body.error).toContain('32');
  });
});

describe('项目知识库：用户隔离', () => {
  it('用户 B 看不到用户 A 的资料列表；B 删除 A 的资料 → 404', async () => {
    const { token: ownerToken } = await registerUser('resource_owner');
    const stranger = (await registerUser('resource_stranger')).token;
    const projectId = 'res-proj-iso-000000000000000000001';

    const created = await createResource(ownerToken, projectId, '机密资料', '仅作者可见');
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    // B 的列表为空（资料按 owner_id 隔离）
    const strangerItems = await listResources(stranger, projectId);
    expect(strangerItems.length).toBe(0);

    // B 删除 A 的资料 → 404（DELETE 条件含 owner_id）
    const delRes = await resourcesRouter.request(`/${projectId}/resources/${id}`, {
      method: 'DELETE',
      headers: authHeaders(stranger),
    });
    expect(delRes.status).toBe(404);

    // 作者仍可见（403/404 路径未误删）
    const ownerItems = await listResources(ownerToken, projectId);
    expect(ownerItems.length).toBe(1);
  });

  it('listProjectResources 返回含 content 的全文（供生成注入）', async () => {
    const { token, userId } = await registerUser('resource_llm');
    const projectId = 'res-proj-llm-000000000000000000001';
    await createResource(token, projectId, '色彩规范', '主色用深蓝');
    await createResource(token, projectId, '字体规范', '标题用衬线体');

    const items = listProjectResources(projectId, userId);
    expect(items.length).toBe(2);
    // 同毫秒创建的条目 created_at 并列，返回顺序不稳定：按名称断言，不依赖索引
    const contentByName = new Map(items.map((item) => [item.name, item.content]));
    expect(contentByName.get('色彩规范')).toBe('主色用深蓝');
    expect(contentByName.get('字体规范')).toBe('标题用衬线体');
  });
});

describe('生成注入：buildProjectResourcesBlock', () => {
  it('空资料 → 空串（不产生多余注入）', () => {
    expect(buildProjectResourcesBlock([])).toBe('');
  });

  it('带【项目参考资料】标记，逐条以名称分节，内容完整包含', () => {
    const block = buildProjectResourcesBlock([
      { name: '色彩规范', content: '主色用深蓝' },
      { name: '字体规范', content: '标题用衬线体' },
    ]);
    expect(block).toContain('【项目参考资料】');
    expect(block).toContain('### 色彩规范');
    expect(block).toContain('主色用深蓝');
    expect(block).toContain('### 字体规范');
    expect(block).toContain('标题用衬线体');
  });

  it('总量截断到 32768 字符（防止放大 LLM 请求体）', () => {
    const block = buildProjectResourcesBlock([
      { name: '大资料一', content: 'a'.repeat(20000) },
      { name: '大资料二', content: 'b'.repeat(20000) },
      { name: '大资料三', content: 'c'.repeat(20000) },
    ]);
    expect(block.length).toBe(32768);
    expect(block).toContain('【项目参考资料】');
  });
});
