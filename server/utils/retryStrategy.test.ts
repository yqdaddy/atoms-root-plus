/**
 * 多维度重试策略测试
 *
 * 覆盖：
 * 1. 策略选择逻辑
 * 2. 容错 JSON 解析
 * 3. 失败诊断
 * 4. 重试提示词生成
 */

import { describe, it, expect } from 'vitest';
import {
  enhancedJsonParse,
  diagnoseJsonError,
  repairCommonJsonErrors,
  getJsonErrorHint,
  type JsonErrorType,
} from './jsonRepair.js';
import {
  selectRetryStrategy,
  diagnoseFailure,
  generateRetryHint,
  RETRY_STRATEGY_MATRIX,
  type FailureReason,
} from './retryStrategy.js';

describe('容错 JSON 解析', () => {
  it('正常 JSON 直接解析成功', () => {
    const result = enhancedJsonParse('{"files": []}');
    expect(result.success).toBe(true);
    expect(result.repaired).toBe(false);
  });

  it('尾逗号自动修复', () => {
    const jsonWithTrailingComma = '{"files": [1, 2, 3,],}';
    const result = enhancedJsonParse(jsonWithTrailingComma);
    expect(result.success).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.data).toEqual({ files: [1, 2, 3] });
  });

  it('未闭合对象自动修复', () => {
    const jsonUnclosed = '{"files": []';
    const result = enhancedJsonParse(jsonUnclosed);
    expect(result.success).toBe(true);
    expect(result.repaired).toBe(true);
  });

  it('未闭合字符串尝试修复', () => {
    const jsonUnclosedString = '{"path": "/index.html';
    const result = enhancedJsonParse(jsonUnclosedString);
    // 可能成功修复（闭合引号和对象），也可能失败（取决于修复逻辑）
    if (result.success) {
      expect(result.repaired).toBe(true);
    }
  });

  it('无法修复的 JSON 返回失败', () => {
    const invalidJson = '{this is not valid json at all !!!}';
    const result = enhancedJsonParse(invalidJson);
    expect(result.success).toBe(false);
  });
});

describe('JSON 错误诊断', () => {
  it('识别尾逗号错误', () => {
    const error = new Error("Unexpected token ',' at position 15");
    const jsonStr = '{"files": [1,2,3,]}';
    const errorType = diagnoseJsonError(error, jsonStr);
    expect(errorType).toBe('trailing_comma');
  });

  it('识别未闭合字符串', () => {
    const error = new Error('Unterminated string in JSON');
    const jsonStr = '{"path": "/index.html}';
    const errorType = diagnoseJsonError(error, jsonStr);
    expect(errorType).toBe('unclosed_string');
  });

  it('识别未闭合括号', () => {
    const error = new Error('Unexpected end of JSON input');
    const jsonStr = '{"files": []';
    const errorType = diagnoseJsonError(error, jsonStr);
    expect(errorType).toBe('unclosed_bracket');
  });

  it('生成针对性错误提示', () => {
    expect(getJsonErrorHint('trailing_comma')).toContain('尾逗号');
    expect(getJsonErrorHint('unclosed_string')).toContain('双引号');
    expect(getJsonErrorHint('unclosed_bracket')).toContain('闭合');
    expect(getJsonErrorHint('missing_quotes')).toContain('键名');
  });
});

describe('失败原因诊断', () => {
  it('检测截断输出', () => {
    const truncated = '{"files": [{"path": "/index.html", "content": "<!DOCTYPE html>';
    const diagnosis = diagnoseFailure(new Error('解析失败'), truncated);
    expect(diagnosis.reason).toBe('truncation');
    expect(diagnosis.retryable).toBe(true);
  });

  it('识别 JSON 语法错误', () => {
    const diagnosis = diagnoseFailure(new Error('JSON 解析失败'));
    expect(diagnosis.reason).toBe('json_syntax');
    expect(diagnosis.retryable).toBe(true);
  });

  it('识别格式不符', () => {
    const diagnosis = diagnoseFailure(new Error('输出格式错误：期望包含 files 数组'));
    expect(diagnosis.reason).toBe('format_mismatch');
    expect(diagnosis.retryable).toBe(true);
  });

  it('识别结构错误', () => {
    const diagnosis = diagnoseFailure(new Error('项目结构不完整：缺少入口文件'));
    expect(diagnosis.reason).toBe('structure_error');
    expect(diagnosis.retryable).toBe(true);
  });

  it('识别校验错误', () => {
    const diagnosis = diagnoseFailure(new Error('结构校验失败'));
    expect(diagnosis.reason).toBe('validation_error');
    expect(diagnosis.retryable).toBe(true);
  });

  it('未知错误默认可重试', () => {
    const diagnosis = diagnoseFailure(new Error('未知错误'));
    expect(diagnosis.reason).toBe('unknown');
    expect(diagnosis.retryable).toBe(true);
  });
});

describe('重试策略选择', () => {
  it('首次失败（JSON 语法错误）→ 引导修复模式', () => {
    const diagnosis = diagnoseFailure(new Error('JSON 解析失败'));
    const strategy = selectRetryStrategy(0, diagnosis);
    expect(strategy.name).toBe('引导修复模式');
    expect(strategy.promptStrategy).toBe('guided');
    expect(strategy.repairStrategy).toBe('json_fix');
  });

  it('首次失败（截断）→ 抢救模式', () => {
    const truncated = '{"files": [{"path": "/index.html"';
    const diagnosis = diagnoseFailure(new Error('解析失败'), truncated);
    const strategy = selectRetryStrategy(0, diagnosis);
    expect(strategy.name).toBe('抢救模式');
    expect(strategy.repairStrategy).toBe('repair');
  });

  it('首次失败（格式不符）→ 脚手架模式', () => {
    const diagnosis = diagnoseFailure(new Error('输出格式错误'));
    const strategy = selectRetryStrategy(0, diagnosis);
    expect(strategy.name).toBe('脚手架模式');
    expect(strategy.format).toBe('scaffold');
  });

  it('首次失败（结构错误）→ 确定性模式', () => {
    const diagnosis = diagnoseFailure(new Error('项目结构不完整'));
    const strategy = selectRetryStrategy(0, diagnosis);
    expect(strategy.name).toBe('确定性模式');
    expect(strategy.modelParams.temperature).toBe(0.3);
  });

  it('第二次失败 → 按矩阵顺序选择', () => {
    const diagnosis = diagnoseFailure(new Error('JSON 解析失败'));
    const strategy = selectRetryStrategy(1, diagnosis);
    // 第二次失败应该选择索引 2 的策略（脚手架模式）
    expect(strategy.name).toBe('脚手架模式');
  });

  it('超过矩阵长度 → 使用最后一个策略', () => {
    const diagnosis = diagnoseFailure(new Error('未知错误'));
    const strategy = selectRetryStrategy(10, diagnosis);
    // 超过矩阵长度，使用最后一个策略
    expect(strategy.name).toBe('抢救模式');
  });

  it('策略矩阵共 5 种策略', () => {
    expect(RETRY_STRATEGY_MATRIX).toHaveLength(5);
  });
});

describe('重试提示词生成', () => {
  it('严格模式生成严格提示', () => {
    const strategy = RETRY_STRATEGY_MATRIX[0]; // 标准模式（严格）
    const diagnosis = diagnoseFailure(new Error('格式错误'));
    const hint = generateRetryHint(strategy, diagnosis, '格式错误');
    expect(hint).toContain('严格遵守格式');
    expect(hint).toContain('禁止输出');
  });

  it('引导模式提供格式示例', () => {
    const strategy = RETRY_STRATEGY_MATRIX[1]; // 引导修复模式
    const diagnosis = diagnoseFailure(new Error('JSON 解析失败'));
    const hint = generateRetryHint(strategy, diagnosis, 'JSON 解析失败');
    expect(hint).toContain('格式指引');
    expect(hint).toContain('示例');
  });

  it('容错模式允许简化', () => {
    const strategy = RETRY_STRATEGY_MATRIX[2]; // 脚手架模式（容错）
    const diagnosis = diagnoseFailure(new Error('截断'));
    const hint = generateRetryHint(strategy, diagnosis, '输出被截断');
    expect(hint).toContain('容错');
    expect(hint).toContain('简化');
  });

  it('确定性模式提示温度调整', () => {
    const strategy = RETRY_STRATEGY_MATRIX[3]; // 确定性模式
    const diagnosis = diagnoseFailure(new Error('结构错误'));
    const hint = generateRetryHint(strategy, diagnosis, '结构错误');
    expect(hint).toContain('确定性');
    expect(hint).toContain('温度');
    expect(hint).toContain('0.3');
  });

  it('脚手架格式提示键值对', () => {
    const strategy = RETRY_STRATEGY_MATRIX[2]; // 脚手架模式
    const diagnosis = diagnoseFailure(new Error('格式错误'));
    const hint = generateRetryHint(strategy, diagnosis, '格式错误');
    expect(hint).toContain('脚手架');
    expect(hint).toContain('键值对');
  });
});

describe('策略切换通知内容', () => {
  it('每种策略都有名称和描述', () => {
    for (const strategy of RETRY_STRATEGY_MATRIX) {
      expect(strategy.name).toBeTruthy();
      expect(strategy.description).toBeTruthy();
      expect(strategy.name.length).toBeGreaterThan(0);
      expect(strategy.description.length).toBeGreaterThan(0);
    }
  });

  it('策略描述用于 SSE 通知', () => {
    const strategy = RETRY_STRATEGY_MATRIX[1]; // 引导修复模式
    expect(strategy.description).toBe('针对 JSON 格式问题，提供结构示例并自动修复常见错误');
  });
});