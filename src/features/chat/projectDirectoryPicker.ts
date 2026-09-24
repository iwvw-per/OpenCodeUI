// ============================================
// 项目目录选择器的入口选择
//
// 「添加项目」有两条路径：
//   1. 系统文件夹选择器（Tauri dialog 插件）—— 只能浏览本机磁盘；
//   2. 内置 ProjectDialog —— 通过 listDirectory(serverId) 浏览任意服务器的
//      文件系统，远程服务器也适用。
//
// 选择哪条只取决于「要往哪台服务器加目录」：
//   - 本地服务器：系统选择器体验更好，可用；
//   - 远程服务器：必须走内置对话框。用系统选择器会把本机路径当成远程项目的
//     目录写进列表，用户点「添加项目」看到的却是自己的本地目录。
// ============================================

import { LOCAL_SERVER_ID } from '../../store/serverStore'
import { isTauri, isTauriMobile } from '../../utils/tauri'

/**
 * 是否可以对给定服务器使用系统文件夹选择器。
 *
 * `focusedServerId` 为空表示尚未确定焦点，按本地处理（与多服务器 store 的
 * 缺省焦点一致）。
 */
export function canUseNativeDirectoryPicker(focusedServerId: string | null | undefined): boolean {
  if (!isTauri() || isTauriMobile()) return false
  return !focusedServerId || focusedServerId === LOCAL_SERVER_ID
}
