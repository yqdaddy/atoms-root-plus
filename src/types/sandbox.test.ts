/**
 * buildPreviewCsp / buildSandboxAttribute 单测（自托管 vendor 方案配套）。
 *
 * 关键约束：
 * - srcdoc 文档为 opaque origin，'self' 关键字不可依赖，同源 /vendor/ 本地
 *   运行时必须由调用方显式传入宿主 origin 并入 script-src
 * - sandbox 标志最小化：allow-same-origin 与 allow-scripts 同用即逃逸，代码层抛错兜底
 */
import { describe, it, expect } from 'vitest';
import { buildPreviewCsp, buildSandboxAttribute, DEFAULT_CDN_HOSTS } from './sandbox';

describe('buildPreviewCsp', () => {
  it('基线：default-src none、script-src 含 unsafe-inline 与 https 化白名单域名', () => {
    const csp = buildPreviewCsp(DEFAULT_CDN_HOSTS);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.tailwindcss.com");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
  });

  it('缺省不开放 unsafe-eval，evalAllowed=true 时追加', () => {
    expect(buildPreviewCsp(DEFAULT_CDN_HOSTS).includes('unsafe-eval')).toBe(false);
    expect(buildPreviewCsp(DEFAULT_CDN_HOSTS, true)).toContain("'unsafe-eval'");
  });

  it('selfOrigin 注入 script-src，放行同源 /vendor/ 本地运行时（react.vendor.js / sucrase.vendor.js）', () => {
    const csp = buildPreviewCsp(DEFAULT_CDN_HOSTS, false, 'http://localhost:5173');
    expect(csp).toContain('http://localhost:5173');
    // 顺序：unsafe-inline -> 白名单 CDN -> selfOrigin ->（可选）unsafe-eval
    expect(csp.indexOf("'unsafe-inline'")).toBeLessThan(csp.indexOf('https://cdn.jsdelivr.net'));
    expect(csp.indexOf('https://cdn.jsdelivr.net')).toBeLessThan(csp.indexOf('http://localhost:5173'));
  });

  it('selfOrigin 与 unsafe-eval 并存时顺序稳定（源表达式在前，eval 关键字在后）', () => {
    const csp = buildPreviewCsp([], true, 'https://demo.example.com');
    const originIdx = csp.indexOf('https://demo.example.com');
    const evalIdx = csp.indexOf("'unsafe-eval'");
    expect(originIdx).toBeGreaterThan(-1);
    expect(evalIdx).toBeGreaterThan(originIdx);
  });

  it('selfOrigin 为空串时不追加空源表达式（保持向后兼容）', () => {
    const csp = buildPreviewCsp([], false, '');
    expect(csp).toContain("script-src 'unsafe-inline';");
  });

  it('不传 selfOrigin 时与既有产物一致（存量调用兼容）', () => {
    expect(buildPreviewCsp(['cdn.jsdelivr.net'])).toBe(
      buildPreviewCsp(['cdn.jsdelivr.net'], false, undefined)
    );
  });
});

describe('buildSandboxAttribute（安全铁律锚点）', () => {
  it('默认仅 allow-scripts', () => {
    expect(buildSandboxAttribute([])).toBe('allow-scripts');
  });

  it('allow-same-origin 与 allow-scripts 同用直接抛错（逃逸兜底）', () => {
    expect(() => buildSandboxAttribute(['allow-same-origin' as never])).toThrow('禁止的 sandbox 标志');
  });

  it('allow-top-navigation 同样被禁止', () => {
    expect(() => buildSandboxAttribute(['allow-top-navigation' as never])).toThrow('禁止的 sandbox 标志');
  });
});
