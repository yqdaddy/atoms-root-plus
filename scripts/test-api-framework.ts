/**
 * API 测试脚本：验证框架选择功能
 * 需要先启动服务器：npm run dev
 * 然后运行：npx tsx scripts/test-api-framework.ts
 */

const API_BASE = 'http://localhost:3000/api';

// 测试用例
const testCases = [
  {
    name: 'HTML 框架',
    framework: 'html',
    expectedPatterns: [
      /<script src="https:\/\/cdn\.tailwindcss\.com"/,
      /class="[^"]*"/, // Tailwind 类名
    ],
    unexpectedPatterns: [
      /ReactDOM\.createRoot/,
      /Vue\./,
      /createApp\(/,
    ],
  },
  {
    name: 'React CDN 框架',
    framework: 'react-cdn',
    expectedPatterns: [
      /react@18/,
      /react-dom@18/,
      /babel\.min\.js/,
      /type="text\/babel"/,
      /ReactDOM\.createRoot/,
    ],
    unexpectedPatterns: [
      /Vue\./,
      /createApp\(/,
    ],
  },
  {
    name: 'Vue CDN 框架',
    framework: 'vue-cdn',
    expectedPatterns: [
      /Vue\./,
      /createApp\(/,
      /id="app"/,
    ],
    unexpectedPatterns: [
      /ReactDOM\.createRoot/,
      /react@18/,
    ],
  },
];

async function testFrameworkGeneration(framework: string, expectedPatterns: RegExp[], unexpectedPatterns: RegExp[]) {
  console.log(`\n测试 ${framework.toUpperCase()} 框架...`);

  try {
    const response = await fetch(`${API_BASE}/llm/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: '创建一个简单的计数器应用',
        options: {
          framework,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 读取 SSE 流
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let generatedCode = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'delta' && data.payload?.text) {
              generatedCode += data.payload.text;
            }

            if (data.type === 'done') {
              console.log('生成完成');

              // 检查预期模式
              const missingPatterns: string[] = [];
              for (const pattern of expectedPatterns) {
                if (!pattern.test(generatedCode)) {
                  missingPatterns.push(pattern.toString());
                }
              }

              // 检查不应出现的模式
              const unexpectedFound: string[] = [];
              for (const pattern of unexpectedPatterns) {
                if (pattern.test(generatedCode)) {
                  unexpectedFound.push(pattern.toString());
                }
              }

              if (missingPatterns.length === 0 && unexpectedFound.length === 0) {
                console.log('  ✓ 所有检查通过');
                console.log(`  生成代码长度: ${generatedCode.length} 字符`);
              } else {
                if (missingPatterns.length > 0) {
                  console.log(`  ✗ 缺少预期模式: ${missingPatterns.join(', ')}`);
                }
                if (unexpectedFound.length > 0) {
                  console.log(`  ✗ 不应出现的模式: ${unexpectedFound.join(', ')}`);
                }
              }

              return;
            }

            if (data.type === 'error') {
              console.error('生成错误:', data.payload?.message);
              return;
            }
          } catch (e) {
            // 忽略 JSON 解析错误
          }
        }
      }
    }
  } catch (error) {
    console.error('测试失败:', error);
  }
}

async function main() {
  console.log('=== 框架选择 API 测试 ===');
  console.log('确保服务器已启动：npm run dev');
  console.log('API 地址:', API_BASE);

  // 检查服务器是否运行
  try {
    const healthCheck = await fetch(`${API_BASE}/health`);
    if (!healthCheck.ok) {
      throw new Error('健康检查失败');
    }
    console.log('服务器运行正常\n');
  } catch (error) {
    console.error('服务器未运行，请先启动服务器：npm run dev');
    process.exit(1);
  }

  for (const testCase of testCases) {
    await testFrameworkGeneration(
      testCase.framework,
      testCase.expectedPatterns,
      testCase.unexpectedPatterns
    );
  }

  console.log('\n=== 测试完成 ===');
}

main().catch(console.error);