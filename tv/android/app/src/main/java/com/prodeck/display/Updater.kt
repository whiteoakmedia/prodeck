package com.prodeck.display

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Updates ProDeck Display in place: download the new app from the release
 * the booth runs, check it really is a newer ProDeck Display, and hand it to
 * Android, which installs it over this one. Nothing is uninstalled and the
 * pairing is kept. Fire OS still asks, on the TV: someone presses Update
 * with the remote, then opens ProDeck Display again (Android 10 and up won't
 * let an app reopen itself after an update). Newer Android TV boxes (12 and
 * up) skip the question once this app has updated itself the first time.
 */
object Updater {
    @Volatile private var busy = false

    /** May this app install updates? Android 8 and up ask per app, once. */
    fun canInstall(ctx: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 26) ctx.packageManager.canRequestPackageInstalls() else true

    /** Open the setting that lets this app install updates. False = this TV has no such screen. */
    fun askPermission(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < 26) return false
        return try {
            ctx.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            true
        } catch (_: Exception) {
            false
        }
    }

    /** Download and install. Runs on the calling (background) thread; progress goes to Checkin.note. */
    fun run(ctx: Context, apkUrl: String, latest: Int) {
        if (busy) return
        busy = true
        try {
            if (!canInstall(ctx)) {
                Checkin.note = "Allow it once on the TV: on a Fire TV, Settings, My Fire TV, Developer options, Install unknown apps, ProDeck Display"
                askPermission(ctx)
                return
            }
            Checkin.note = "Downloading the update…"
            val file = File(ctx.cacheDir, "update.apk")
            download(apkUrl, file)
            // Only ever install ProDeck Display, and only a newer one.
            @Suppress("DEPRECATION")
            val info = ctx.packageManager.getPackageArchiveInfo(file.path, 0)
            @Suppress("DEPRECATION")
            val code = info?.versionCode ?: 0
            if (info?.packageName != ctx.packageName || code <= Checkin.appVersion(ctx)) {
                Checkin.note = if (info == null) "The download wasn't a complete app. It tries again next time." else "The booth's release has no newer ProDeck Display."
                file.delete()
                return
            }
            Checkin.note = "Waiting for someone to press Update on the TV, then open ProDeck Display again"
            install(ctx, file)
        } catch (e: Exception) {
            Checkin.note = "Update failed: ${e.message ?: e.javaClass.simpleName}. It tries again when asked."
        } finally {
            busy = false
        }
    }

    private fun download(url: String, to: File) {
        var u = URL(url)
        // Follow redirects by hand: GitHub hands the file off to another host.
        repeat(6) {
            val c = u.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 10_000
            c.readTimeout = 30_000
            val code = c.responseCode
            if (code in 300..399) {
                u = URL(u, c.getHeaderField("Location") ?: throw IllegalStateException("redirect without a location"))
                c.disconnect()
                return@repeat
            }
            if (code != 200) throw IllegalStateException("download answered $code")
            c.inputStream.use { input -> to.outputStream().use { input.copyTo(it) } }
            c.disconnect()
            if (to.length() < 50_000) throw IllegalStateException("download was too small")
            return
        }
        throw IllegalStateException("too many redirects")
    }

    private fun install(ctx: Context, file: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("ProDeckDisplay", 0, file.length()).use { out ->
                file.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val done = PendingIntent.getBroadcast(ctx, id, Intent(ctx, InstallResult::class.java), flags)
            session.commit(done.intentSender)
        }
        file.delete()
    }

    /** Android's answer: show its Install prompt, or say what went wrong. */
    class InstallResult : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    @Suppress("DEPRECATION")
                    val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                    try {
                        ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (_: Exception) {
                        Checkin.note = "The TV wouldn't show the Install prompt. Open ProDeck Display and choose Update."
                    }
                }
                PackageInstaller.STATUS_SUCCESS -> Checkin.note = ""
                else -> Checkin.note = "Not installed: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "cancelled on the TV"}"
            }
        }
    }
}
