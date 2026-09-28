/**
 * 澄清面板组件（Phase 2：意图澄清机制）
 * 当 AI 需要更多信息时展示，等待用户回答问题或跳过
 */
import React, { useState, useCallback } from 'react';
import { Icon } from '@iconify/react';

interface ClarificationQuestion {
  id: string;
  question: string;
  options?: string[];
  required: boolean;
}

interface ClarificationPanelProps {
  reason: string;
  questions: ClarificationQuestion[];
  onAnswer: (answers: Record<string, string>) => void;
  onSkip: () => void;
  isProcessing?: boolean;
}

export const ClarificationPanel: React.FC<ClarificationPanelProps> = ({
  reason,
  questions,
  onAnswer,
  onSkip,
  isProcessing = false,
}) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 更新答案
  const handleAnswerChange = useCallback((questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
    // 清除该问题的错误
    if (errors[questionId]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    }
  }, [errors]);

  // 提交答案
  const handleSubmit = useCallback(() => {
    // 验证必填问题
    const newErrors: Record<string, string> = {};
    for (const q of questions) {
      if (q.required && !answers[q.id]?.trim()) {
        newErrors[q.id] = '此问题必填';
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onAnswer(answers);
  }, [questions, answers, onAnswer]);

  return (
    <div className="clarification-panel bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-4 my-3">
      {/* 标题栏 */}
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <Icon icon="lucide:help-circle" className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
            需要更多信息
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {reason}
          </p>
        </div>
      </div>

      {/* 问题列表 */}
      <div className="space-y-4 mb-4">
        {questions.map((q, index) => (
          <div key={q.id} className="question-item">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {index + 1}. {q.question}
              {q.required && <span className="text-red-500 ml-1">*</span>}
            </label>

            {/* 选项模式 */}
            {q.options && q.options.length > 0 ? (
              <div className="space-y-2">
                {q.options.map((option, optIndex) => (
                  <label
                    key={optIndex}
                    className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={option}
                      checked={answers[q.id] === option}
                      onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                      disabled={isProcessing}
                      className="w-4 h-4 text-blue-600 dark:text-blue-400 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{option}</span>
                  </label>
                ))}
                {/* 自定义输入选项 */}
                <label className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name={q.id}
                    value="__custom__"
                    checked={answers[q.id] === '__custom__'}
                    onChange={() => handleAnswerChange(q.id, '__custom__')}
                    disabled={isProcessing}
                    className="w-4 h-4 text-blue-600 dark:text-blue-400 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">其他（自定义输入）</span>
                </label>
                {answers[q.id] === '__custom__' && (
                  <input
                    type="text"
                    placeholder="请输入您的答案..."
                    value=""
                    onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                    disabled={isProcessing}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-200"
                    autoFocus
                  />
                )}
              </div>
            ) : (
              /* 自由输入模式 */
              <input
                type="text"
                placeholder="请输入您的答案..."
                value={answers[q.id] || ''}
                onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                disabled={isProcessing}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-200"
              />
            )}

            {/* 错误提示 */}
            {errors[q.id] && (
              <p className="mt-1 text-xs text-red-500">{errors[q.id]}</p>
            )}
          </div>
        ))}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onSkip}
          disabled={isProcessing}
          className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
        >
          跳过，直接生成
        </button>
        <button
          onClick={handleSubmit}
          disabled={isProcessing}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {isProcessing ? (
            <>
              <Icon icon="lucide:loader-2" className="w-4 h-4 animate-spin" />
              处理中...
            </>
          ) : (
            <>
              <Icon icon="lucide:check" className="w-4 h-4" />
              继续生成
            </>
          )}
        </button>
      </div>
    </div>
  );
};