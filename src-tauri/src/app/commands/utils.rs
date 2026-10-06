use crate::app::dir_state::OpenDirectoryState;
use serde::Serialize;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::process::Command;
use std::sync::Arc;
use tauri::State;

#[derive(Serialize)]
pub struct DroppedPathInfo {
    #[serde(rename = "type")]
    kind: &'static str,
    path: String,
    name: String,
}

/// 获取启动时传入的目录路径（一次性读取后清空）
#[tauri::command]
pub fn get_cli_directory(
    window: tauri::Window,
    state: State<'_, OpenDirectoryState>,
) -> Option<Arc<str>> {
    state.pending().pin().remove(window.label()).cloned()
}

/// 新建桌面窗口
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn open_new_window(app: tauri::AppHandle, directory: Option<String>) {
    crate::app::create_new_window(&app, directory);
}

/// 桌面窗口前端首帧完成后，通知 Rust 显示真实窗口并关闭 loading 窗口
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn desktop_window_ready(window: tauri::Window) -> Result<(), String> {
    crate::app::mark_window_ready(&window).map_err(|err| err.to_string())
}

/// 判断路径是否是本机存在的目录。
///
/// 「打开项目目录」用它区分「目录在这台机器上」与「目录在远程主机上」：AI Agent
/// 实例可能就跑在本机，此时远程服务器的目录路径同样存在于本机磁盘，应当用系统
/// 文件管理器打开；只有本机不存在的远程路径才退回应用内文件树。
#[tauri::command]
pub fn is_local_directory(path: String) -> bool {
    std::fs::metadata(&path)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
}

/// 用指定的本机程序打开项目目录。
///
/// target：`file_manager`（系统资源管理器）/ `vscode` / `terminal`。三者都只对
/// 「本机存在的目录」有意义，调用方需先用 `is_local_directory` 确认。进程以分离
/// 方式启动（不等待退出），最终以其它程序窗口的形式出现在用户在系统上。
#[tauri::command]
pub fn open_directory_with(path: String, target: String) -> Result<(), String> {
    open_directory_with_impl(path, target)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn open_directory_with_impl(path: String, target: String) -> Result<(), String> {
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    match target.as_str() {
        "file_manager" => open_in_file_manager(&path),
        "vscode" => open_in_vscode(&path),
        "terminal" => open_in_terminal(&path),
        other => Err(format!("Unknown open target: {other}")),
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn open_directory_with_impl(_path: String, _target: String) -> Result<(), String> {
    Err("Opening directories natively is unsupported on this platform".to_string())
}

#[cfg(target_os = "windows")]
fn open_in_file_manager(path: &str) -> Result<(), String> {
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn open_in_vscode(path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // `code` 在 Windows 上是 .cmd 垫片（内部再启动 Code.exe），必须经 cmd 解析。
    // 但绝不能用 `start`：start 对批处理会新开一个控制台窗口（用户会看到黑框）。
    // 改为隐藏窗口的 `cmd /C code <path>`——code.cmd 启动 VS Code 后自身即返回，
    // 不需要 start 来脱离；CREATE_NO_WINDOW 保证不弹控制台。
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    Command::new("cmd")
        .args(["/C", "code", path])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn open_in_terminal(path: &str) -> Result<(), String> {
    // 优先 Windows Terminal（wt），缺失时退回 cmd。`start /D` 设定新窗口的工作目录。
    if Command::new("wt").args(["-d", path]).spawn().is_ok() {
        return Ok(());
    }
    Command::new("cmd")
        .args(["/C", "start", "", "/D", path, "cmd"])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_in_file_manager(path: &str) -> Result<(), String> {
    Command::new("open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_in_vscode(path: &str) -> Result<(), String> {
    // 优先 code CLI；未安装时退回按应用名打开。
    if Command::new("code").arg(path).spawn().is_ok() {
        return Ok(());
    }
    Command::new("open")
        .args(["-a", "Visual Studio Code", path])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_in_terminal(path: &str) -> Result<(), String> {
    Command::new("open")
        .args(["-a", "Terminal", path])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn open_in_file_manager(path: &str) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn open_in_vscode(path: &str) -> Result<(), String> {
    Command::new("code")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn open_in_terminal(path: &str) -> Result<(), String> {
    let working_dir = format!("--working-directory={path}");
    let candidates: [(&str, Vec<String>); 4] = [
        ("x-terminal-emulator", vec![working_dir.clone()]),
        ("gnome-terminal", vec![working_dir.clone()]),
        ("konsole", vec!["--workdir".to_string(), path.to_string()]),
        ("xterm", vec![]),
    ];
    for (binary, args) in candidates {
        let mut cmd = Command::new(binary);
        cmd.args(&args);
        if binary == "xterm" {
            cmd.current_dir(path);
        }
        if cmd.spawn().is_ok() {
            return Ok(());
        }
    }
    Err("No terminal emulator found".to_string())
}

#[cfg(not(any(
    target_os = "windows",
    target_os = "macos",
    target_os = "linux",
    target_os = "android",
    target_os = "ios"
)))]
fn open_in_file_manager(_path: &str) -> Result<(), String> {
    Err("Unsupported platform".to_string())
}

#[cfg(not(any(
    target_os = "windows",
    target_os = "macos",
    target_os = "linux",
    target_os = "android",
    target_os = "ios"
)))]
fn open_in_vscode(_path: &str) -> Result<(), String> {
    Err("Unsupported platform".to_string())
}

#[cfg(not(any(
    target_os = "windows",
    target_os = "macos",
    target_os = "linux",
    target_os = "android",
    target_os = "ios"
)))]
fn open_in_terminal(_path: &str) -> Result<(), String> {
    Err("Unsupported platform".to_string())
}

/// 获取拖入路径的基础信息，用于前端区分文件/目录并生成 @ 引用。
#[tauri::command]
pub fn get_dropped_paths_info(paths: Vec<String>) -> Vec<DroppedPathInfo> {
    paths
        .into_iter()
        .filter_map(|path| {
            let metadata = std::fs::metadata(&path).ok()?;
            let kind = if metadata.is_dir() {
                "folder"
            } else if metadata.is_file() {
                "file"
            } else {
                return None;
            };

            let name = std::path::Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| path.clone());

            Some(DroppedPathInfo { kind, path, name })
        })
        .collect()
}
