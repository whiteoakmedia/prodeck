package com.prodeck.display

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The dashboard, full screen, for good. ProDeck's kiosk page does the real
 * work (it reconnects and reloads after updates by itself); this keeps the
 * screen on, hides everything else, and retries if the booth isn't there
 * when the TV wakes up. Press Menu or the centre button to choose another
 * screen; hold Back to pair again.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var offline: TextView
    private val handler = Handler(Looper.getMainLooper())
    private var lastBack = 0L
    private val checkins = Executors.newSingleThreadScheduledExecutor()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = Prefs.url(this)
        if (url == null) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0E131B"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            // Sound is the dashboard's call, not the TV's: a dashboard with Room
            // audio on plays the service audio on its kiosks (Kiosk.tsx), and a
            // TV on the wall has nobody there to press play. Every other tile
            // keeps its sound muted, as on any kiosk.
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            if (Build.VERSION.SDK_INT >= 21) settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            isFocusable = false
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) showOffline()
                }

                @Deprecated("API < 23")
                override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                    if (failingUrl == Prefs.url(this@MainActivity)) showOffline()
                }

                override fun onPageFinished(view: WebView, u: String) {
                    if (offline.visibility == View.VISIBLE && !u.startsWith("about:")) offline.visibility = View.GONE
                }
            }
        }
        offline = TextView(this).apply {
            text = "Looking for ProDeck on the network…"
            setTextColor(Color.parseColor("#9AA8BC"))
            textSize = 22f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#0E131B"))
            visibility = View.GONE
        }
        setContentView(FrameLayout(this).apply {
            addView(web, FrameLayout.LayoutParams(-1, -1))
            addView(offline, FrameLayout.LayoutParams(-1, -1))
        })
        hideSystemBars()
        web.loadUrl(url)
        checkins.scheduleWithFixedDelay({ checkIn() }, 5, 60, TimeUnit.SECONDS)
    }

    /** Tell the booth this TV is here, and do what it asks (Checkin.kt). Background thread. */
    private fun checkIn() {
        val r = Checkin.send(this) ?: return
        val latest = r.optInt("latest")
        val apk = r.optString("apk")
        getSharedPreferences("display", MODE_PRIVATE).edit().putInt("latest", latest).putString("apk", apk).apply()
        r.optString("show").takeIf { it.startsWith("/") }?.let { path ->
            handler.post {
                Prefs.save(this, Prefs.base(this) ?: return@post, path)
                Prefs.url(this)?.let { web.loadUrl(it) }
            }
        }
        if (r.optBoolean("update") && latest > Checkin.appVersion(this) && apk.startsWith("http")) {
            Updater.run(this, apk, latest)
        }
    }

    /** The booth isn't answering (powered off, or the TV woke first): try again every few seconds. */
    private fun showOffline() {
        offline.visibility = View.VISIBLE
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ Prefs.url(this)?.let { web.loadUrl(it) } }, 5000)
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                startActivity(Intent(this, ScreenChooserActivity::class.java))
                return true
            }
            KeyEvent.KEYCODE_BACK -> {
                // A stray Back press shouldn't take the lobby TV off its
                // dashboard: it takes two within two seconds to leave.
                val now = System.currentTimeMillis()
                if (now - lastBack < 2000) return super.onKeyDown(keyCode, event)
                lastBack = now
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyLongPress(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            repair()
            return true
        }
        return super.onKeyLongPress(keyCode, event)
    }

    private fun repair() {
        startActivity(Intent(this, SetupActivity::class.java).putExtra("again", true))
    }

    override fun onDestroy() {
        checkins.shutdownNow()
        handler.removeCallbacksAndMessages(null)
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }
}
