/**
 * 模块运行时生成器（mini-bundler，路线 B）。
 *
 * 产物为一段普通脚本源码（无 script 标签，由调用方决定包装方式），提供：
 * - __defineModule(path, factory)：注册模块（CJS 形参 module / exports / require）
 * - __requireModule(path)：带缓存的惰性执行 require
 * - 循环依赖：返回部分导出并 console.warn（与 Node 心智一致）
 * - 模块执行错误：try/catch 捕获后附模块路径前缀重抛
 * - bare 说明符：交给 bareImportShims 生成的 __loadBareModule
 *
 * 设计约定：所有 require 说明符在构建期已被改写为绝对路径或 bare 原文，
 * 运行时不做任何相对路径解析（解析逻辑单点存在于 importScanner）。
 */

import { generateBareShimLoader, CSS_MODULE_SENTINEL } from './bareImportShims';

/**
 * 生成模块运行时脚本源码。
 * 声明的标识符（__registry / __defineModule / __requireModule）位于调用方
 * 提供的作用域内（bundler 会把运行时与模块注册、入口启动包进同一 IIFE）；
 * 同时在 window 上暴露 __modules / __requireModule 便于沙箱内调试。
 */
export function generateModuleRuntimeScript(): string {
  return `'use strict';
  var __registry = Object.create(null);

  function __defineModule(path, factory) {
    __registry[path] = { factory: factory, exports: {}, state: 'pending' };
  }

${generateBareShimLoader()}

  function __loadModule(path) {
    if (path === ${JSON.stringify(CSS_MODULE_SENTINEL)}) { return {}; }
    var mod = __registry[path];
    if (mod) {
      if (mod.state === 'executing') {
        console.warn('[litpp 模块运行时] 检测到循环依赖: ' + path + '（本次返回部分导出）');
        return mod.exports;
      }
      if (mod.state === 'pending') {
        var module = { exports: mod.exports };
        mod.state = 'executing';
        try {
          mod.factory(module, module.exports, __requireModule);
          mod.exports = module.exports;
          mod.state = 'done';
        } catch (err) {
          mod.state = 'error';
          var msg = (err && typeof err.message === 'string') ? err.message : String(err);
          if (msg.indexOf('[模块] ') !== 0) {
            var target = (err && typeof err === 'object') ? err : new Error(String(err));
            target.message = '[模块] ' + path + ': ' + msg;
            throw target;
          }
          throw err;
        }
      }
      return mod.exports;
    }
    if (path.charAt(0) === '/') {
      throw new Error('模块不存在: ' + path + '（检查 import 拼写，或该文件是否已在项目中创建）');
    }
    return __loadBareModule(path);
  }

  function __requireModule(path) {
    return __loadModule(path);
  }

  window.__modules = __registry;
  window.__requireModule = __requireModule;
  window.__defineModule = __defineModule;`;
}

/**
 * 组装最终可执行的 bundle 脚本：运行时 + 模块注册 + 入口启动，包进单一 IIFE。
 * 入口 __requireModule 置于末尾（CJS 惰性语义下顺序不影响正确性，
 * 但依赖先注册保持输出与依赖图一致，便于人工阅读与调试）。
 * 入口启动包 try/catch：错误附上下文后异步重抛，走 window error 事件桥接。
 */
export function assembleBundleScript(runtimeScript: string, moduleEntries: readonly { readonly path: string; readonly body: string }[], entryPath: string): string {
  const registrations = moduleEntries
    .map((entry) => `  __defineModule(${JSON.stringify(entry.path)}, function (module, exports, require) {\n${entry.body}\n  });`)
    .join('\n');
  return `(function () {
${runtimeScript}

${registrations}

  try {
    __requireModule(${JSON.stringify(entryPath)});
  } catch (err) {
    var entryMsg = (err && typeof err.message === 'string') ? err.message : String(err);
    if (entryMsg.indexOf('[入口] ') !== 0) {
      var target = (err && typeof err === 'object') ? err : new Error(String(err));
      target.message = '[入口] ' + ${JSON.stringify(entryPath)} + ': ' + entryMsg;
      err = target;
    }
    setTimeout(function () { throw err; }, 0);
  }
})();`;
}
