/**
 * 模块级活动运行注册表。
 * cancelGeneration 必须能取消「当前正在进行的那次生成」，与 API 实例的创建时序无关
 * （UI 层可能每次发消息都调用 getAIAPI 新建实例），因此取消句柄挂在模块作用域。
 */

type CancelFn = () => void;

const registry: { current: CancelFn | null } = { current: null };

/**
 * 注册当前活动运行，返回注销函数。
 * 后注册的运行覆盖前一个；注销时只在「自己仍是当前运行」时清空，避免误清新运行的句柄。
 */
export function registerActiveRun(cancel: CancelFn): () => void {
  registry.current = cancel;
  let unregistered = false;
  return () => {
    if (unregistered) {
      return;
    }
    unregistered = true;
    if (registry.current === cancel) {
      registry.current = null;
    }
  };
}

/** 取消当前活动运行（若有）。重复调用安全 */
export function cancelActiveRun(): void {
  const cancel = registry.current;
  registry.current = null;
  cancel?.();
}

export function hasActiveRun(): boolean {
  return registry.current !== null;
}
