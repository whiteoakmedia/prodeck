package com.prodeck.display

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * Pairing, so nobody types a kiosk link with a TV remote:
 *  1. find the booth (ProDeck announces itself as _prodeck._tcp), or type
 *     its address if the network hides it;
 *  2. show a six-character code and say hello to the booth;
 *  3. wait while someone at the booth matches the code in Settings → TV
 *     screens and picks a dashboard;
 *  4. save the link it sends back and open the dashboard.
 */
class SetupActivity : Activity() {
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private lateinit var root: LinearLayout
    private lateinit var list: LinearLayout
    private var nsd: NsdManager? = null
    private var discovery: NsdManager.DiscoveryListener? = null
    private var lock: WifiManager.MulticastLock? = null
    private val found = LinkedHashMap<String, String>() // name -> base URL
    @Volatile private var polling = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(64), dp(40), dp(64), dp(40))
            setBackgroundColor(Color.parseColor("#0E131B"))
        }
        setContentView(ScrollView(this).apply { addView(root) })
        showFinder()
    }

    // ------------------------------------------------------------ finding

    private fun showFinder() {
        polling = false
        root.removeAllViews()
        root.addView(title("Connect this TV to ProDeck"))
        root.addView(body("Looking for ProDeck on this network. Choose it below, or type the address shown in ProDeck under Settings, Browser Access."))
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(list)
        val manual = button("Type the address instead") { showManual() }
        root.addView(manual)
        if (intent.getBooleanExtra("again", false) && Prefs.url(this) != null) {
            root.addView(button("Keep the current dashboard") { openDashboard() })
        }
        renderFound()
        manual.requestFocus()
        startDiscovery()
    }

    private fun renderFound() {
        list.removeAllViews()
        if (found.isEmpty()) {
            list.addView(body("Searching…").apply { setTextColor(Color.parseColor("#6F7E93")) })
            return
        }
        for ((name, base) in found) {
            list.addView(button("$name   ${base.removePrefix("http://")}") { pair(base) })
        }
        (list.getChildAt(0) as? View)?.requestFocus()
    }

    private fun startDiscovery() {
        if (discovery != null) return
        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        lock = wifi?.createMulticastLock("prodeck")?.apply { setReferenceCounted(false); acquire() }
        val mgr = getSystemService(Context.NSD_SERVICE) as NsdManager
        nsd = mgr
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onServiceLost(info: NsdServiceInfo) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                @Suppress("DEPRECATION")
                mgr.resolveService(info, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {}
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        @Suppress("DEPRECATION")
                        val host = info.host?.hostAddress ?: return
                        if (host.contains(':')) return // IPv6 link-local: the v4 answer will come too
                        main.post {
                            found[info.serviceName] = "http://$host:${info.port}"
                            if (!polling) renderFound()
                        }
                    }
                })
            }
        }
        discovery = listener
        try {
            mgr.discoverServices("_prodeck._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (_: Exception) {
            discovery = null
        }
    }

    private fun stopDiscovery() {
        discovery?.let { try { nsd?.stopServiceDiscovery(it) } catch (_: Exception) {} }
        discovery = null
        lock?.release()
        lock = null
    }

    private fun showManual() {
        root.removeAllViews()
        root.addView(title("Type ProDeck's address"))
        root.addView(body("It's in ProDeck on the booth computer, under Settings, Browser Access. For example 172.16.80.12:8088"))
        val field = EditText(this).apply {
            setText(Prefs.base(this@SetupActivity)?.removePrefix("http://") ?: "")
            hint = "172.16.80.12:8088"
            textSize = 24f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#6F7E93"))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
        }
        root.addView(field, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(16) })
        root.addView(button("Connect") {
            val raw = field.text.toString().trim().removePrefix("http://").trimEnd('/')
            if (raw.isNotEmpty()) pair("http://" + if (raw.contains(':')) raw else "$raw:8088")
        })
        root.addView(button("Back") { showFinder() })
        field.requestFocus()
    }

    // ------------------------------------------------------------ pairing

    private fun pair(base: String) {
        stopDiscovery()
        val code = newCode()
        root.removeAllViews()
        root.addView(title("On the booth computer"))
        root.addView(body("Open ProDeck, go to Settings, TV screens. This code appears there: check it matches, choose what this TV should show, and press Send to TV."))
        root.addView(TextView(this).apply {
            text = code.chunked(3).joinToString("  ")
            textSize = 96f
            typeface = Typeface.MONOSPACE
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, dp(24), 0, dp(24))
        })
        val status = body("Waiting for the booth…").apply { setTextColor(Color.parseColor("#6F7E93")) }
        root.addView(status)
        root.addView(button("Use a different ProDeck") { showFinder() }.also { it.requestFocus() })
        polling = true
        val name = deviceName()
        io.execute {
            val hello = get("$base/api/tv/hello?code=$code&name=${URLEncoder.encode(name, "UTF-8")}")
            if (hello == null) {
                main.post { if (polling) status.text = "Can't reach ProDeck at ${base.removePrefix("http://")}. Check Browser Access is on, and that this TV is on the same network." }
                return@execute
            }
            if (hello.optString("status") == "refused") {
                main.post { if (polling) status.text = "ProDeck didn't accept this TV (${hello.optString("error")}). Try again in a minute." }
                return@execute
            }
            while (polling) {
                Thread.sleep(2000)
                val r = get("$base/api/tv/poll?code=$code") ?: continue
                when (r.optString("status")) {
                    "ok" -> {
                        Prefs.save(this, base, r.getString("path"))
                        main.post { openDashboard() }
                        return@execute
                    }
                    "unknown" -> main.post { if (polling) pair(base) } // expired: show a new code
                }
                if (r.optString("status") == "unknown") return@execute
            }
        }
    }

    private fun openDashboard() {
        polling = false
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }

    private fun get(url: String): JSONObject? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 4000
        c.readTimeout = 6000
        c.inputStream.bufferedReader().use { JSONObject(it.readText()) }.also { c.disconnect() }
    } catch (_: Exception) {
        null
    }

    /** Six characters a person can read off a TV across a room: no 0/O or 1/I. */
    private fun newCode(): String {
        val abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        val r = SecureRandom()
        return (1..6).map { abc[r.nextInt(abc.length)] }.joinToString("")
    }

    private fun deviceName(): String {
        val named = try {
            Settings.Global.getString(contentResolver, "device_name")
        } catch (_: Exception) {
            null
        }
        return named?.takeIf { it.isNotBlank() } ?: "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    }

    // ------------------------------------------------------------ views

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun title(t: String) = TextView(this).apply {
        text = t
        textSize = 34f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.WHITE)
    }

    private fun body(t: String) = TextView(this).apply {
        text = t
        textSize = 20f
        setTextColor(Color.parseColor("#C7D2E0"))
        setPadding(0, dp(12), 0, dp(8))
    }

    private fun button(t: String, onClick: () -> Unit) = Button(this).apply {
        text = t
        textSize = 20f
        isAllCaps = false
        isFocusable = true
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) }
    }

    override fun onDestroy() {
        polling = false
        stopDiscovery()
        io.shutdownNow()
        super.onDestroy()
    }
}
