// ============================================
// 本机文件系统集成（系统文件管理器 / 文件夹选择器）
//
// 有一类操作依赖「运行本应用的这台机器」的磁盘：
//   - 系统文件夹选择器（Tauri dialog 插件）
//   - 在系统文件管理器里打开 / 定位路径（Tauri opener 插件）
//
// 多服务器模式下，项目目录可能位于**远程主机**上（经网关访问其文件系统）。
// 远程路径在本机并不存在，调用这些本机能力只会打开本机的同名路径或报错，
// 表现为「点远程项目却打开了本地目录」。因此调用方必须先判断目标服务器是否
// 是本机，再决定用本机能力还是应用内等价功能（如内置目录对话框、右侧文件树）。
// ============================================

import { LOCAL_SERVER_ID } from '../store/serverStore'
import { isTauri, isTauriMobile } from './tauri'

/**
 * 目标服务器是否就是运行本应用的本机。
 *
 * `serverId` 为空表示尚未确定目标，按本机处理（与多服务器 store 的缺省焦点一致）。
 */
export function isLocalServer(serverId: string | null | undefined): boolean {
  return !serverId || serverId === LOCAL_SERVER_ID
}

/**
 * 是否可以对目标服务器使用本机文件系统集成。
 *
 * 需要同时满足：桌面客户端（Tauri 且非移动端）+ 目标服务器是本机。
 */
export function canUseNativeFileIntegration(serverId: string | null | undefined): boolean {
  if (!isTauri() || isTauriMobile()) return false
  return isLocalServer(serverId)
}

/**
 * 是否可以对目标服务器使用系统文件夹选择器。
 *
 * 与 {@link canUseNativeFileIntegration} 同义，命名更贴近调用点语义：
 * 「添加项目」需要选目录，远程必须改用内置目录对话框。
 */
export function canUseNativeDirectoryPicker(serverId: string | null | undefined): boolean {
  return canUseNativeFileIntegration(serverId)
}

/**
 * 是否可以使用系统文件夹选择器（不限制目标服务器）。
 *
 * 用于内置目录对话框里的「系统文件夹」按钮：用户主要连接云端/远程服务器时，
 * 焦点服务器几乎总是远程，若沿用 {@link canUseNativeDirectoryPicker} 的限制，
 * 该按钮永远不会出现。这里放宽为「桌面客户端即可」，让用户始终能通过系统
 * 资源管理器挑一个目录；远程服务器仍可用上方的路径浏览。
 */
export function canUseSystemDirectoryPicker(): boolean {
  return isTauri() && !isTauriMobile()
}
