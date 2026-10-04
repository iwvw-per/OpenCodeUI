package com.opencodeui.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.activity.enableEdgeToEdge
import androidx.core.app.NotificationCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject

class MainActivity : TauriActivity() {

  private val handler = Handler(Looper.getMainLooper())
  private var cachedInsetsJs: String? = null
  private var themeSyncRunnable: Runnable? = null
  private var cachedWebView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // 初始状态栏样式（后续由 WebView 主题同步驱动）
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.isAppearanceLightStatusBars = true
    controller.isAppearanceLightNavigationBars = true
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT

    // 禁用系统对比度强制（避免状态栏自动加黑/渐变）
    if (Build.VERSION.SDK_INT >= 29) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }

    // 监听 WindowInsets 变化：
    // 1. 顶部交给 Web surface 自己绘制，状态栏透明叠在 WebView 上
    // 2. 底部仍由原生 padding 处理，让键盘弹出时 WebView 物理 resize
    val contentView = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(contentView) { view, windowInsets ->
      val systemInsets = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val imeInsets = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
      val statusBarInsets = windowInsets.getInsets(WindowInsetsCompat.Type.statusBars())
      val density = resources.displayMetrics.density
      val topInsetCssPx = maxOf(statusBarInsets.top, systemInsets.top) / density

      // 键盘弹出时底部取 IME 和系统栏的较大值，让 WebView 整体 resize
      val bottomPadding = maxOf(imeInsets.bottom, systemInsets.bottom)
      view.setPadding(
        systemInsets.left,
        0,
        systemInsets.right,
        bottomPadding
      )

      cachedInsetsJs = """
        (function() {
          var s = document.documentElement.style;
          s.setProperty('--safe-area-inset-top', '${topInsetCssPx}px');
          s.setProperty('--safe-area-inset-bottom', '0px');
          s.setProperty('--safe-area-inset-left', '0px');
          s.setProperty('--safe-area-inset-right', '0px');
        })();
      """.trimIndent()

      // 立即尝试注入
      tryInjectInsets(view)

      WindowInsetsCompat.CONSUMED
    }

    // WebView 可能还没创建好，轮询几次确保注入成功
    scheduleInsetsInjection(contentView, 0)
  }

  override fun onResume() {
    super.onResume()
    startThemeSync()
  }

  override fun onPause() {
    stopThemeSync()
    super.onPause()
  }

  private fun startThemeSync() {
    if (themeSyncRunnable != null) return
    themeSyncRunnable = Runnable {
      val rootView = window.decorView.findViewById<View>(android.R.id.content)
      syncSystemBars(rootView)
      handler.postDelayed(themeSyncRunnable!!, 800L)
    }
    handler.post(themeSyncRunnable!!)
  }

  private fun stopThemeSync() {
    themeSyncRunnable?.let { handler.removeCallbacks(it) }
    themeSyncRunnable = null
  }

  private fun syncSystemBars(rootView: View) {
    val webView = cachedWebView ?: findWebView(rootView) ?: return
    // 在 JS 端用 Canvas 2D 将 getComputedStyle 返回的任意格式颜色
    // 统一转为 #rrggbb hex，避免不同 WebView 版本返回不同格式
    // (rgb 逗号/空格分隔, color(srgb ...), oklch(...) 等)
    val js = """
      (function() {
        var mode = document.documentElement.getAttribute('data-mode') || 'system';
        var raw = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-100').trim();
        if (!raw) return JSON.stringify({ mode: mode, bg: '' });
        var c = document.createElement('canvas').getContext('2d');
        c.fillStyle = raw;
        var hex = c.fillStyle;
        return JSON.stringify({ mode: mode, bg: hex });
      })();
    """.trimIndent()
    webView.evaluateJavascript(js) { result ->
      applySystemBarsFromJs(result)
    }
  }

  private fun applySystemBarsFromJs(result: String?) {
    if (result == null || result == "null") return
    val unescaped = result
      .trim('"')
      .replace("\\\\", "\\")
      .replace("\\\"", "\"")
    val json = try {
      org.json.JSONObject(unescaped)
    } catch (_: Exception) {
      return
    }
    val mode = json.optString("mode", "system")
    val bg = json.optString("bg", "")
    val color = parseCssColor(bg) ?: return
    val isLightBg = isColorLight(color)
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.isAppearanceLightStatusBars = isLightBg && mode != "dark"
    controller.isAppearanceLightNavigationBars = isLightBg && mode != "dark"
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    window.decorView.setBackgroundColor(color)
  }

  private inner class SystemBarBridge {
    @android.webkit.JavascriptInterface
    fun setSystemBars(mode: String, bg: String) {
      val color = parseCssColor(bg) ?: return
      val isLightBg = isColorLight(color)
      val controller = WindowInsetsControllerCompat(window, window.decorView)
      controller.isAppearanceLightStatusBars = isLightBg && mode != "dark"
      controller.isAppearanceLightNavigationBars = isLightBg && mode != "dark"
      window.statusBarColor = Color.TRANSPARENT
      window.navigationBarColor = Color.TRANSPARENT
      window.decorView.setBackgroundColor(color)
    }

    @android.webkit.JavascriptInterface
    fun vibrate(ms: Int) {
      val duration = ms.coerceIn(1, 50).toLong()
      val vibrator = resolveVibrator() ?: return
      if (android.os.Build.VERSION.SDK_INT >= 26) {
        vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE))
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(duration)
      }
    }

    /**
     * 支持振幅的震动：durations/amplitudes 为交替的 [震动, 间隔, 震动…] 与对应振幅
     * （1-255，0 表示该段不震）。振幅能力由设备决定，不支持时自动退回 DEFAULT_AMPLITUDE。
     * 供移动端触觉反馈分级（轻/中/强）使用。
     */
    @android.webkit.JavascriptInterface
    fun vibratePattern(durations: String, amplitudes: String) {
      val durationsArray = durations.split(",").mapNotNull { it.trim().toLongOrNull() }.toLongArray()
      if (durationsArray.isEmpty()) return
      val vibrator = resolveVibrator() ?: return
      if (android.os.Build.VERSION.SDK_INT >= 26) {
        val ampArray = amplitudes.split(",").mapNotNull { it.trim().toIntOrNull() }.toIntArray()
        val safeAmps = IntArray(durationsArray.size) { index ->
          (ampArray.getOrNull(index) ?: VibrationEffect.DEFAULT_AMPLITUDE).coerceIn(0, 255)
        }
        vibrator.vibrate(VibrationEffect.createWaveform(durationsArray, safeAmps, -1))
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(durationsArray, -1)
      }
    }

    private fun resolveVibrator(): Vibrator? {
      val vibrator = if (android.os.Build.VERSION.SDK_INT >= 31) {
        val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        vm.defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      }
      return if (vibrator.hasVibrator()) vibrator else null
    }
  }

  /**
   * 实况通知（Android 16 Live Updates / ColorOS 流体云）。
   * 通过 __opencode_android_live 暴露给前端，产出 promoted ongoing 通知。
   * start/update 复用同一 id 原地更新；end 取消。
   */
  private inner class LiveUpdateBridge {
    @android.webkit.JavascriptInterface
    fun start(json: String) {
      postLiveUpdate(json)
    }

    @android.webkit.JavascriptInterface
    fun update(json: String) {
      postLiveUpdate(json)
    }

    @android.webkit.JavascriptInterface
    fun end(id: Int) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.cancel(if (id > 0) id else defaultLiveUpdateId)
    }

    /** 系统是否允许本应用发布 promoted 通知（用户可在设置里关闭）。仅 Android 16+ 有意义。 */
    @android.webkit.JavascriptInterface
    fun canPromote(): Boolean {
      if (Build.VERSION.SDK_INT < 36) return false
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      return nm.canPostPromotedNotifications()
    }
  }

  private fun ensureLiveUpdateChannel() {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(liveUpdateChannelId) == null) {
      val channel = NotificationChannel(
        liveUpdateChannelId,
        "AI 任务进度",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "显示 AI 生成等任务的实时进度"
        setShowBadge(false)
      }
      nm.createNotificationChannel(channel)
    }
  }

  private fun postLiveUpdate(json: String) {
    val obj = try {
      JSONObject(json)
    } catch (_: Exception) {
      return
    }
    val id = obj.optInt("id", defaultLiveUpdateId)
    val title = obj.optString("title", "OpenCode")
    val body = obj.optString("body", "")
    val shortText = obj.optString("shortText", "")
    val sessionId = obj.optString("sessionId", "")
    val hasProgress = obj.has("progress")
    val progress = obj.optInt("progress", 0).coerceIn(0, 100)

    ensureLiveUpdateChannel()

    val intent = Intent(this, MainActivity::class.java).apply {
      action = Intent.ACTION_VIEW
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("opencode_session_id", sessionId)
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      id,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val builder = NotificationCompat.Builder(this, liveUpdateChannelId)
      .setSmallIcon(R.drawable.ic_stat_opencode)
      .setContentTitle(title)
      .setContentText(body)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
    if (hasProgress) {
      builder.setProgress(100, progress, false)
    } else {
      builder.setProgress(0, 0, true)
    }
    // 请求系统提升为实况通知（Android 16+）；低于该版本该 extra 被忽略，仅作普通常驻通知。
    // 用 getExtras 写入而非 setRequestPromotedOngoing，避免依赖 androidx.core 1.17+（需 Kotlin 2.0）。
    builder.getExtras().putBoolean("android.requestPromotedOngoing", true)
    if (Build.VERSION.SDK_INT >= 36 && shortText.isNotEmpty()) {
      builder.getExtras().putString("android.shortCriticalText", shortText)
    }

    try {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.notify(id, builder.build())
    } catch (_: Exception) {
      // 通知失败不应影响主流程
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    val sessionId = intent.getStringExtra("opencode_session_id")
    if (!sessionId.isNullOrEmpty()) {
      val quoted = JSONObject.quote(sessionId)
      cachedWebView?.evaluateJavascript(
        "window.location.hash = '#/session/' + $quoted",
        null
      )
    }
  }

  private fun parseCssColor(value: String): Int? {
    val v = value.trim()
    if (v.isEmpty()) return null

    // 优先处理 #hex 格式（JS 端已统一转为此格式）
    if (v.startsWith("#")) {
      return try {
        Color.parseColor(v)
      } catch (_: Exception) {
        null
      }
    }

    // 兼容处理 rgb/rgba — 同时支持逗号分隔和空格分隔
    if (v.startsWith("rgb")) {
      val inner = v.substringAfter('(').substringBefore(')')
      // 提取所有数字（整数或浮点）
      val nums = Regex("""\d+\.?\d*""").findAll(inner).map { it.value }.toList()
      if (nums.size < 3) return null
      val r = nums[0].toFloatOrNull()?.toInt()?.coerceIn(0, 255) ?: return null
      val g = nums[1].toFloatOrNull()?.toInt()?.coerceIn(0, 255) ?: return null
      val b = nums[2].toFloatOrNull()?.toInt()?.coerceIn(0, 255) ?: return null
      return Color.rgb(r, g, b)
    }

    // 兼容处理 hsl/hsla — 同时支持逗号分隔和空格分隔
    if (v.startsWith("hsl")) {
      val inner = v.substringAfter('(').substringBefore(')')
        .replace("%", "")
      val parts = Regex("""\d+\.?\d*""").findAll(inner).map { it.value }.toList()
      if (parts.size < 3) return null
      val h = parts[0].toFloatOrNull() ?: return null
      val s = (parts[1].toFloatOrNull() ?: return null) / 100f
      val l = (parts[2].toFloatOrNull() ?: return null) / 100f
      return hslToColor(h, s, l)
    }

    // 最后尝试 Color.parseColor (支持 named colors 等)
    return try {
      Color.parseColor(v)
    } catch (_: Exception) {
      null
    }
  }

  private fun hslToColor(h: Float, s: Float, l: Float): Int {
    val c = (1 - kotlin.math.abs(2 * l - 1)) * s
    val hh = (h % 360) / 60f
    val x = c * (1 - kotlin.math.abs(hh % 2 - 1))
    val (r1, g1, b1) = when {
      hh < 1 -> Triple(c, x, 0f)
      hh < 2 -> Triple(x, c, 0f)
      hh < 3 -> Triple(0f, c, x)
      hh < 4 -> Triple(0f, x, c)
      hh < 5 -> Triple(x, 0f, c)
      else -> Triple(c, 0f, x)
    }
    val m = l - c / 2
    val r = ((r1 + m) * 255).toInt().coerceIn(0, 255)
    val g = ((g1 + m) * 255).toInt().coerceIn(0, 255)
    val b = ((b1 + m) * 255).toInt().coerceIn(0, 255)
    return Color.rgb(r, g, b)
  }

  private fun isColorLight(color: Int): Boolean {
    val r = Color.red(color) / 255f
    val g = Color.green(color) / 255f
    val b = Color.blue(color) / 255f
    val luminance = 0.299f * r + 0.587f * g + 0.114f * b
    return luminance > 0.6f
  }

  /**
   * 延迟重试注入 insets，确保 WebView 加载完成后 CSS 变量被设置
   * 最多重试 10 次，间隔递增
   */
  private fun scheduleInsetsInjection(rootView: View, attempt: Int) {
    if (attempt >= 10) return
    val delay = if (attempt < 3) 200L else 1000L
    handler.postDelayed({
      if (tryInjectInsets(rootView)) {
        // 注入成功后再补几次，确保页面导航后也有值
        if (attempt < 5) {
          scheduleInsetsInjection(rootView, attempt + 1)
        }
      } else {
        scheduleInsetsInjection(rootView, attempt + 1)
      }
    }, delay)
  }

  /**
   * 尝试向 WebView 注入 insets CSS 变量
   * @return 是否找到了 WebView 并成功注入
   */
  private fun tryInjectInsets(view: View): Boolean {
    val js = cachedInsetsJs ?: return false
    val webView = findWebView(view) ?: return false
    cachedWebView = webView
    ensureJsBridge(webView)
    webView.evaluateJavascript(js, null)
    return true
  }

  private fun ensureJsBridge(webView: WebView) {
    try {
      webView.addJavascriptInterface(SystemBarBridge(), "__opencode_android")
    } catch (_: Exception) {
      // ignore - may be added already
    }
    try {
      webView.addJavascriptInterface(LiveUpdateBridge(), "__opencode_android_live")
    } catch (_: Exception) {
      // ignore - may be added already
    }
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        findWebView(view.getChildAt(i))?.let { return it }
      }
    }
    return null
  }

  companion object {
    private const val liveUpdateChannelId = "opencode_live_update"
    private const val defaultLiveUpdateId = 9001
  }
}
