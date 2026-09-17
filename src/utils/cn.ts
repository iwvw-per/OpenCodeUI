// ============================================
// cn - 类名合并工具
//
// 用 clsx 处理条件类名，再用 tailwind-merge 消解冲突：后出现的同类
// Tailwind 类会覆盖先出现的（如默认 `px-3` 与调用方传入 `px-5`）。
// 这是所有 ui/ 组件接受 className 覆盖的约定基础。
// ============================================

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
