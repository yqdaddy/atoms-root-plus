/**
 * 类名合并工具。
 * 基于 clsx 的简化实现，用于合并条件类名。
 */

type ClassValue = string | undefined | null | false | ClassValue[];

/**
 * 合并类名字符串。
 * @example cn('base', isActive && 'active', 'extra')
 */
export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = [];

  for (const input of inputs) {
    if (!input) continue;

    if (typeof input === 'string') {
      classes.push(input);
    } else if (Array.isArray(input)) {
      const nested = cn(...input);
      if (nested) classes.push(nested);
    }
  }

  return classes.join(' ');
}