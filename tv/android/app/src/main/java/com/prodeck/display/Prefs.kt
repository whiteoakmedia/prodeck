package com.prodeck.display

import android.content.Context

/** Where this TV's dashboard lives: the booth's address and the kiosk link it was paired with. */
object Prefs {
    private const val FILE = "display"

    fun base(ctx: Context): String? = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString("base", null)
    fun path(ctx: Context): String? = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString("path", null)

    /** The full kiosk URL, or null until the TV has been paired. */
    fun url(ctx: Context): String? {
        val b = base(ctx) ?: return null
        val p = path(ctx) ?: return null
        return b.trimEnd('/') + p
    }

    fun save(ctx: Context, base: String, path: String) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString("base", base).putString("path", path).apply()
    }

    fun clear(ctx: Context) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().clear().apply()
    }
}
