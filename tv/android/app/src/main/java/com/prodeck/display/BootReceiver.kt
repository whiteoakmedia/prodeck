package com.prodeck.display

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a power cut, or after ProDeck Display updates itself, a paired TV goes straight back to its dashboard. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val ok = intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
        if (!ok || Prefs.url(ctx) == null) return
        val i = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            ctx.startActivity(i)
        } catch (_: Exception) {
            // Some Android TV builds don't let an app start itself at boot;
            // the TV then shows its home screen and the app opens from there.
        }
    }
}
