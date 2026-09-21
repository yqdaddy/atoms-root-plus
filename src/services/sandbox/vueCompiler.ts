/**
 * Vue 3 浏览器内编译器。
 * 支持 Vue 3 SFC（单文件组件）和 Options API/Composition API 代码。
 *
 * 设计原则：
 * - Vue 3 与编译器均从 CDN（cdn.jsdelivr.net）加载，主应用零依赖
 * - SFC 编译使用 @vue/compiler-sfc，模板编译使用 @vue/compiler-dom
 * - 编译执行使用 new Function，沙箱 CSP 需开放 unsafe-eval
 * - 编译/运行错误统一通过 window error 事件传播
 */

/** Vue 3 UMD CDN 脚本地址（jsdelivr） */
export const VUE_CDN_SCRIPTS: readonly string[] = [
  'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js',
];

/** Vue SFC 编译器 CDN（jsdelivr 全局构建） */
export const VUE_SFC_COMPILER_CDN: string =
  'https://cdn.jsdelivr.net/npm/@vue/compiler-sfc@3/dist/compiler-sfc.global.prod.js';

/** Vue CDN 模式约定的挂载点 id */
export const VUE_ROOT_ID = 'app';

/**
 * 检测代码是否包含 Vue SFC 语法
 * SFC 特征：<template> 标签包裹的模板部分
 */
export function containsVueSfc(code: string): boolean {
  return /<template[\s>]/i.test(code) && /<\/template>/i.test(code);
}

/**
 * 检测代码是否使用 Vue API（Options API 或 Composition API）
 * 特征：createApp() 调用、defineComponent()、setup() 函数、data() 返回对象等
 */
export function containsVueApi(code: string): boolean {
  // createApp 调用
  if (/Vue\.createApp\s*\(|createApp\s*\(/.test(code)) return true;
  // Vue 3 Composition API
  if (/setup\s*\(\s*\)\s*\{/.test(code)) return true;
  // Options API data/methods
  if (/data\s*\(\s*\)\s*\{[\s\S]*return\s*\{/.test(code)) return true;
  return false;
}

/**
 * 检测代码是否为 Vue 代码（SFC 或 Vue API）
 */
export function containsVueCode(code: string): boolean {
  return containsVueSfc(code) || containsVueApi(code);
}

/**
 * 生成 Vue 3 CDN 注入脚本
 * UMD 全局暴露 Vue，供编译后的代码引用
 */
export function generateVueCdnRuntime(): string {
  const scripts = VUE_CDN_SCRIPTS.map((src) => `<script crossorigin src="${src}"></script>`).join('\n');
  return `${scripts}
<script>
  window.Vue = window.Vue || Vue;
</script>`;
}

/**
 * 生成 Vue SFC 编译器注入与执行辅助脚本
 *
 * 加载模型：编译器经 script 标签同步加载；
 * 用户脚本执行时调用 __compileVueSfc 编译 SFC。
 *
 * __compileVueSfc(code, fileName)：
 * 1. 使用 @vue/compiler-sfc 解析 SFC（template + script + style）
 * 2. 编译 template 为 render 函数
 * 3. 编译 script 为组件选项对象
 * 4. 使用 Vue.createApp() 创建应用并挂载到 #app
 */
export function generateVueSfcCompilerRuntime(): string {
  return `<script crossorigin src="${VUE_SFC_COMPILER_CDN}"></script>
<script>
(function() {
  function reportAndRethrow(err) {
    if (err instanceof Error && err.message.indexOf('[Vue]') !== 0) {
      err.message = '[Vue] ' + err.message;
    }
    setTimeout(function() { throw err; }, 0);
  }

  // 编译队列：编译器加载期间，编译请求先入队
  window.__vueQueue = window.__vueQueue || [];

  /**
   * 编译并执行 Vue SFC
   * @param code SFC 代码
   * @param fileName 文件名（用于错误定位）
   */
  window.__compileVueSfc = function(code, fileName) {
    if (!window.__vueSfcReady) {
      window.__vueQueue.push([code, fileName]);
      return;
    }

    try {
      if (typeof Vue === 'undefined') {
        reportAndRethrow(new Error('Vue 运行时加载失败，请检查网络后刷新重试'));
        return;
      }
      if (typeof VueCompilerSFC === 'undefined') {
        reportAndRethrow(new Error('Vue 编译器加载失败，请检查网络后刷新重试'));
        return;
      }

      const { parse, compileScript, compileTemplate } = VueCompilerSFC;

      // 1. 解析 SFC
      const { descriptor } = parse(code, { filename: fileName || 'App.vue' });

      // 2. 编译 script
      const scriptCompiled = compileScript(descriptor, {
        id: 'vue-sfc-' + Date.now(),
        inlineTemplate: false, // 单独编译 template
      });

      // 3. 编译 template
      let renderCode = '';
      if (descriptor.template) {
        const templateCompiled = compileTemplate({
          source: descriptor.template.content,
          filename: fileName || 'App.vue',
          id: 'vue-sfc-' + Date.now(),
          compilerOptions: {
            isCustomElement: () => false,
          },
        });
        renderCode = templateCompiled.code;
      }

      // 4. 组装组件定义并执行
      var componentCode = scriptCompiled.content + '\\n' + renderCode + '\\n' +
        ';\\n' +
        '// 将 render 函数附加到导出的组件\\n' +
        'if (typeof __sfc_render !== "undefined") {\\n' +
        '  __sfc__.render = __sfc_render;\\n' +
        '}\\n' +
        '__sfc__;';

      var getComponent = new Function('Vue', componentCode);
      const component = getComponent(Vue);

      // 5. 创建并挂载 Vue 应用
      const app = Vue.createApp(component);
      app.mount('#${VUE_ROOT_ID}');

      return component;
    } catch (err) {
      reportAndRethrow(err);
    }
  };

  // 超时兜底
  setTimeout(function() {
    if (!window.__vueSfcReady) {
      reportAndRethrow(new Error('Vue 编译器加载超时，请检查网络后刷新重试'));
    }
  }, 15000);

  // 标记编译器就绪
  window.__vueSfcReady = true;

  // Flush 队列
  var queue = window.__vueQueue || [];
  window.__vueQueue = [];
  for (var i = 0; i < queue.length; i++) {
    window.__compileVueSfc(queue[i][0], queue[i][1]);
  }
})();
</script>`;
}

/**
 * 包装 Vue SFC 代码为浏览器内编译执行的脚本块
 */
export function wrapVueSfc(code: string, fileName?: string): string {
  return `<script>
__compileVueSfc(${JSON.stringify(code)}, ${JSON.stringify(fileName || 'App.vue')});
</script>`;
}

/**
 * 生成 Vue 应用挂载点
 */
export function generateVueAppBootstrap(): string {
  return `<div id="${VUE_ROOT_ID}"></div>`;
}

/**
 * 生成 Vue CDN 模式的代码示例（供 AI 工程师提示词引用）
 *
 * 支持两种格式：
 * 1. Vue SFC（单文件组件）：推荐，最贴近 Vue 开发习惯
 * 2. Vue Options API / Composition API：直接使用 Vue 全局 API
 */
export function generateVueCdnCodeExample(): string {
  return `## Vue SFC 示例（推荐）

\`\`\`html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Vue CDN 应用</title>
</head>
<body>
  <!-- 挂载点：id 固定为 app -->
  <div id="app"></div>

  <script>
    // Vue SFC 格式（单文件组件）
    // 在 <script> 标签内直接写 SFC 代码，框架会自动编译
  </script>

  <!-- Vue SFC 代码（将被编译器处理） -->
  <template>
    <div class="app">
      <h1>{{ title }}</h1>
      <button @click="count++">点击 {{ count }} 次</button>
    </div>
  </template>

  <script>
  export default {
    data() {
      return {
        title: 'Vue 计数器',
        count: 0
      }
    }
  }
  </script>

  <style scoped>
  .app {
    text-align: center;
    padding: 20px;
  }
  </style>
</body>
</html>
\`\`\`

## Vue Options API 示例（直接使用）

\`\`\`html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Vue CDN 应用</title>
</head>
<body>
  <!-- 挂载点：id 固定为 app -->
  <div id="app"></div>

  <script>
    // CDN 模式约定：
    // 1. 全局 Vue 对象由 CDN 注入
    // 2. 使用 Vue.createApp() 创建应用
    // 3. 挂载到 #app 元素

    const { createApp, ref } = Vue;

    createApp({
      setup() {
        const count = ref(0);
        const title = ref('Vue 计数器');

        return { count, title };
      },
      template: \`
        <div class="app">
          <h1>{{ title }}</h1>
          <button @click="count++">点击 {{ count }} 次</button>
        </div>
      \`
    }).mount('#app');
  </script>
</body>
</html>
\`\`\`

## 关键约定

1. **挂载点**：必须有 \`<div id="app"></div>\`，Vue 应用挂载到此元素
2. **SFC 格式**：直接在 HTML 中写 \`<template>\`、\`<script>\`、\`<style>\` 标签
3. **Options API**：使用 \`Vue.createApp({ ... })\` 并提供 \`template\` 或 \`render\` 选项
4. **Composition API**：使用 \`setup()\` 函数和 \`ref\`/\`reactive\` 等 API
5. **外部资源**：只允许 \`https://cdn.jsdelivr.net\`
6. **数据持久化**：只用 \`localStorage\``;
}