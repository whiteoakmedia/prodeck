package com.prodeck.display

import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom

/**
 * About once a minute a paired TV tells the booth it's here: its name, what
 * it shows and which app version it runs. The booth lists it under Settings,
 * TV screens, and answers with anything it wants done: update the app, or
 * show something else. Uses the crew password the TV was paired with.
 */
object Checkin {
    /** What an update in progress last said, for the booth to show. */
    @Volatile var note: String = ""

    fun id(ctx: Context): String {
        val p = ctx.getSharedPreferences("display", Context.MODE_PRIVATE)
        p.getString("id", null)?.let { return it }
        val r = SecureRandom()
        val id = (1..16).map { "0123456789abcdef"[r.nextInt(16)] }.joinToString("")
        p.edit().putString("id", id).apply()
        return id
    }

    fun deviceName(ctx: Context): String {
        val named = try {
            Settings.Global.getString(ctx.contentResolver, "device_name")
        } catch (_: Exception) {
            null
        }
        return named?.takeIf { it.isNotBlank() } ?: "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    }

    @Suppress("DEPRECATION")
    fun appVersion(ctx: Context): Int = try {
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionCode
    } catch (_: Exception) {
        0
    }

    /** One check-in. The booth's answer, or null if it couldn't be reached. */
    fun send(ctx: Context): JSONObject? {
        val base = Prefs.base(ctx) ?: return null
        val current = Prefs.path(ctx)?.let { Uri.parse("http://x$it") } ?: return null
        val token = current.getQueryParameter("token") ?: return null
        val showing = current.getQueryParameter("kiosk") ?: if (current.getQueryParameter("tally") != null) "Camera tally board" else ""
        val args = JSONObject()
            .put("id", id(ctx))
            .put("name", deviceName(ctx))
            .put("app", appVersion(ctx))
            .put("showing", showing)
            .put("canInstall", Updater.canInstall(ctx))
            .put("note", note)
        return try {
            val c = URL("$base/api/cmd").openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.connectTimeout = 4000
            c.readTimeout = 8000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(JSONObject().put("cmd", "tv_checkin").put("args", args).put("token", token).toString().toByteArray()) }
            val text = c.inputStream.bufferedReader().use { it.readText() }
            c.disconnect()
            JSONObject(text).optJSONObject("result")
        } catch (_: Exception) {
            null
        }
    }
}
