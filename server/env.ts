/**
 * 零依赖 .env 加载器。
 * 在服务端入口最先导入，确保后续模块可读取 process.env。
 * 仅设置尚未定义的环境变量（CLI 传入或已设置优先）。
 * 支持 KEY=VALUE 与 export KEY=VALUE 两种格式，自动去除引号。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '.env');

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  if (!existsSync(ENV_PATH)) {
    console.log('[env] .env 文件不存在，跳过加载');
    return;
  }

  const content = readFileSync(ENV_PATH, 'utf-8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // 支持 export KEY=VALUE 格式
    let normalized = line;
    if (normalized.startsWith('export ')) {
      normalized = normalized.slice(7).trim();
    }

    const eq = normalized.indexOf('=');
    if (eq <= 0) continue;

    const key = normalized.slice(0, eq).trim();
    let value = normalized.slice(eq + 1).trim();

    // 去除引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (typeof process.env[key] === 'undefined') {
      process.env[key] = value;
    }
  }

  console.log('[env] .env 已加载');
}

// 模块导入时自动执行（确保在其他模块读取 env 前完成）
loadEnv();