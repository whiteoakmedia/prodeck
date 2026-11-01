package com.prodeck.display

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * Choose what this TV shows, from the TV: every dashboard on the booth, the
 * camera tally board when there's a switcher, the edge margin for TVs that
 * crop the picture, and pairing again. Opened with Menu or the centre button.
 * It asks the booth with the crew password the TV was paired with, so it
 * only ever lists what a crew phone could see.
 */
class ScreenChooserActivity : Activity() {
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private lateinit var root: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(64), dp(36), dp(64), dp(36))
            setBackgroundColor(Color.parseColor("#0E131B"))
        }
        setContentView(ScrollView(this).apply { addView(root) })
        val base = Prefs.base(this)
        val current = Prefs.path(this)?.let { Uri.parse("http://x$it") }
        val token = current?.getQueryParameter("token")
        if (base == null || token == null) {
            repair()
            return
        }
        root.addView(title("Choose a screen"))
        val status = body("Asking ProDeck for its dashboards…")
        root.addView(status)
        io.execute {
            val dashes = cmd(base, token, "load_dashboards") as? JSONArray
            val settings = cmd(base, token, "get_settings") as? JSONObject
            main.post { render(status, base, token, current, dashes, settings?.optBoolean("atem_enabled") == true) }
        }
    }

    private fun render(status: TextView, base: String, token: String, current: Uri, dashes: JSONArray?, atem: Boolean) {
        val safe = current.getQueryParameter("safe") == "1"
        val showing = current.getQueryParameter("kiosk") ?: current.getQueryParameter("tally")?.let { "tally" }
        if (dashes == null) {
            status.text = "Can't reach ProDeck right now. Check the booth computer is on, then try again."
        } else {
            status.text = if (dashes.length() == 0) "There are no dashboards on the booth yet." else "Showing now is marked with a dot."
        }
        var first: Button? = null
        for (i in 0 until (dashes?.length() ?: 0)) {
            val name = dashes!!.getJSONObject(i).optString("name")
            if (name.isBlank()) continue
            val b = button((if (name == showing) "●  " else "") + name) { open(base, "/?kiosk=${enc(name)}&token=${enc(token)}", safe) }
            root.addView(b)
            if (first == null || name == showing) first = b
        }
        if (atem) {
            root.addView(button((if (showing == "tally") "●  " else "") + "Camera tally board") { open(base, "/?tally=all&token=${enc(token)}", safe) })
        }
        root.addView(button(if (safe) "Edge margin: on (for TVs that crop the picture)" else "Edge margin: off") {
            current.getQueryParameter("kiosk")?.let { open(base, "/?kiosk=${enc(it)}&token=${enc(token)}", !safe) }
                ?: open(base, "/?tally=all&token=${enc(token)}", !safe)
        })
        updateRow()
        root.addView(button("Connect to a different ProDeck") { repair() })
        root.addView(button("Back to the screen") { finish() })
        (first ?: root.getChildAt(2))?.requestFocus()
    }

    /** Update ProDeck Display from here, when the booth has a newer one. */
    private fun updateRow() {
        val p = getSharedPreferences("display", MODE_PRIVATE)
        val latest = p.getInt("latest", 0)
        val apk = p.getString("apk", null)
        val mine = Checkin.appVersion(this)
        if (latest <= mine || apk == null) {
            root.addView(body("ProDeck Display version $mine. ${if (latest > 0) "Up to date." else ""}".trim()))
            return
        }
        val status = body(Checkin.note.ifBlank { "Version $latest is ready. Updating keeps this TV's pairing and screen. Afterwards, open ProDeck Display again." })
        root.addView(button("Update ProDeck Display") {
            status.text = "Downloading the update…"
            io.execute {
                Updater.run(this, apk, latest)
                main.post { status.text = Checkin.note.ifBlank { "Follow the prompt on screen." } }
            }
        })
        root.addView(status)
    }

    private fun open(base: String, path: String, safe: Boolean) {
        Prefs.save(this, base, if (safe) "$path&safe=1" else path)
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }

    private fun repair() {
        startActivity(Intent(this, SetupActivity::class.java).putExtra("again", true))
        finish()
    }

    /** One gateway command with the TV's crew password; the result, or null. */
    private fun cmd(base: String, token: String, name: String): Any? = try {
        val c = URL("$base/api/cmd").openConnection() as HttpURLConnection
        c.requestMethod = "POST"
        c.connectTimeout = 4000
        c.readTimeout = 8000
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(JSONObject().put("cmd", name).put("args", JSONObject()).put("token", token).toString().toByteArray()) }
        val text = c.inputStream.bufferedReader().use { it.readText() }
        c.disconnect()
        JSONObject(text).opt("result")
    } catch (_: Exception) {
        null
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
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
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) }
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }
}
