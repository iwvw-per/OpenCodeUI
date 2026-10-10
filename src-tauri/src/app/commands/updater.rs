//! 桌面端自更新自定义命令。
//!
//! 为什么不直接用 tauri-plugin-updater 的 JS `check()`：它只能使用
//! tauri.conf.json 里静态配置的 endpoints，无法在运行时按通道切换。canary
//! 的更新清单在各自 release tag 下（vX.Y.Z-canary.N/latest.json），而
//! `releases/latest/download/latest.json` 只会解析到正式版——因此由前端把
//! 目标清单 URL 传进来，这里用 `UpdaterBuilder::endpoints` 动态构建。

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{ipc::Channel, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;

/// 下载/安装过程推送给前端的事件，形状与 @tauri-apps/plugin-updater 的
/// DownloadEvent 保持一致，前端无需区分来源。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum UpdaterDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress { chunk_length: usize },
    Finished,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterInstallResult {
    /// 本次实际安装到的版本号；为 null 表示清单里的版本不高于当前版本，未安装。
    installed_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterInstallOptions {
    /// 是否在安装后自动重启（Windows 的 NSIS 由安装器接管，此参数无效）
    restart_after_install: Option<bool>,
    /// 检查清单请求超时（毫秒）
    timeout: Option<u64>,
}

/// 按指定清单 URL 执行「检查 → 下载 → 安装」。
///
/// manifest_url 为 None 时回退到 tauri.conf.json 里配置的静态 endpoints
/// （稳定通道的 releases/latest/download/latest.json）。
/// 清单里的版本必须高于当前版本才会下载安装（与插件默认的版本比较一致：
/// semver 语义，prerelease 小于同号正式版），否则直接返回未安装。
#[tauri::command]
pub async fn updater_install<R: Runtime>(
    webview: Webview<R>,
    manifest_url: Option<String>,
    on_event: Channel<UpdaterDownloadEvent>,
    options: Option<UpdaterInstallOptions>,
) -> Result<UpdaterInstallResult, String> {
    let mut builder = webview.updater_builder();

    if let Some(manifest_url) = manifest_url.as_deref() {
        let endpoint = tauri::Url::parse(manifest_url).map_err(|err| err.to_string())?;
        builder = builder
            .endpoints(vec![endpoint])
            .map_err(|err| err.to_string())?;
    }

    if let Some(timeout) = options.as_ref().and_then(|options| options.timeout) {
        builder = builder.timeout(Duration::from_millis(timeout));
    }

    let update = builder
        .build()
        .map_err(|err| err.to_string())?
        .check()
        .await
        .map_err(|err| err.to_string())?;

    let Some(update) = update else {
        return Ok(UpdaterInstallResult {
            installed_version: None,
        });
    };

    let version = update.version.clone();
    let restart_after_install = options
        .as_ref()
        .and_then(|options| options.restart_after_install);

    let mut first_chunk = true;
    let mut update = update;
    if let Some(restart_after_install) = restart_after_install {
        update = update.restart_after_install(restart_after_install);
    }

    update
        .download_and_install(
            |chunk_length, content_length| {
                if first_chunk {
                    first_chunk = false;
                    let _ = on_event.send(UpdaterDownloadEvent::Started { content_length });
                }
                let _ = on_event.send(UpdaterDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(UpdaterDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|err| err.to_string())?;

    Ok(UpdaterInstallResult {
        installed_version: Some(version),
    })
}
