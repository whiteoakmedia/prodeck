package com.prodeck.display

import android.content.Context
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Finding the booth again after it moved. A booth computer that restarts can
 * come back on a new address (no reserved address, or a private Wi-Fi
 * address), and a TV paired to the old one would show nothing until someone
 * paired it again with the remote.
 *
 * Candidates come from Bonjour (_prodeck._tcp) and, because some church Wi-Fi
 * blocks Bonjour, from checking every address on the TV's own network for the
 * booth's port. A candidate only counts if it accepts this TV's check-in with
 * the crew password the TV was paired with, so a TV never wanders to another
 * church's booth or to anything else listening on that port.
 *
 * Blocking: call from a background thread. Returns the new base URL, or null.
 */
object Finder {
    private const val BONJOUR_WAIT_MS = 6000L
    /** Larger networks are only checked around the TV's own address (a /22). */
    private const val MIN_PREFIX = 22

    fun find(ctx: Context): String? {
        val old = Prefs.base(ctx) ?: return null
        val port = Uri.parse(old).port.takeIf { it > 0 } ?: 8088
        val tried = HashSet<String>()
        fun accept(base: String): Boolean = tried.add(base) && Checkin.send(ctx, base) != null

        for (base in bonjour(ctx)) if (base != old && accept(base)) return base
        for (host in sweep(port)) {
            val base = "http://$host:$port"
            if (base != old && accept(base)) return base
        }
        return null
    }

    /** Every ProDeck answering Bonjour within a few seconds, as base URLs. */
    private fun bonjour(ctx: Context): List<String> {
        val out = Collections.synchronizedList(ArrayList<String>())
        val mgr = ctx.applicationContext.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return out
        val wifi = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val lock = try {
            wifi?.createMulticastLock("prodeck-find")?.apply { setReferenceCounted(false); acquire() }
        } catch (_: Exception) {
            null
        }
        val listener = object : NsdManager.DiscoveryListener {
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onServiceLost(info: NsdServiceInfo) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                @Suppress("DEPRECATION")
                try {
                    mgr.resolveService(info, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {}
                        override fun onServiceResolved(info: NsdServiceInfo) {
                            @Suppress("DEPRECATION")
                            val host = info.host?.hostAddress ?: return
                            if (host.contains(':')) return
                            out.add("http://$host:${info.port}")
                        }
                    })
                } catch (_: Exception) {
                    // Older Fire OS resolves one at a time and throws on the
                    // second; the sweep still covers that booth.
                }
            }
        }
        try {
            mgr.discoverServices("_prodeck._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
            Thread.sleep(BONJOUR_WAIT_MS)
        } catch (_: Exception) {
        } finally {
            try { mgr.stopServiceDiscovery(listener) } catch (_: Exception) {}
            try { lock?.release() } catch (_: Exception) {}
        }
        return ArrayList(out).distinct()
    }

    /** Addresses on the TV's own network that accept a connection on `port`. */
    private fun sweep(port: Int): List<String> {
        val hosts = ArrayList<String>()
        try {
            for (ni in Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp || ni.isLoopback || !(ni.name.startsWith("wlan") || ni.name.startsWith("eth"))) continue
                for (ia in ni.interfaceAddresses) {
                    val a = ia.address as? Inet4Address ?: continue
                    hosts += neighbours(a, ia.networkPrefixLength.toInt())
                }
            }
        } catch (_: Exception) {
            return emptyList()
        }
        if (hosts.isEmpty()) return emptyList()
        val open = Collections.synchronizedList(ArrayList<String>())
        val pool = Executors.newFixedThreadPool(48)
        for (h in hosts.distinct()) {
            pool.execute {
                try {
                    Socket().use { it.connect(InetSocketAddress(h, port), 700) }
                    open.add(h)
                } catch (_: Exception) {
                }
            }
        }
        pool.shutdown()
        pool.awaitTermination(45, TimeUnit.SECONDS)
        pool.shutdownNow()
        return ArrayList(open)
    }

    /** Every other host address on `own`'s network (at most a /22). */
    internal fun neighbours(own: Inet4Address, prefix: Int): List<String> {
        val b = own.address
        val ip = ((b[0].toInt() and 255) shl 24) or ((b[1].toInt() and 255) shl 16) or
            ((b[2].toInt() and 255) shl 8) or (b[3].toInt() and 255)
        val p = prefix.coerceIn(MIN_PREFIX, 30)
        val mask = (-1 shl (32 - p))
        val net = ip and mask
        val size = 1 shl (32 - p)
        val out = ArrayList<String>(size)
        for (i in 1 until size - 1) {
            val h = net or i
            if (h == ip) continue
            out += "${(h ushr 24) and 255}.${(h ushr 16) and 255}.${(h ushr 8) and 255}.${h and 255}"
        }
        return out
    }
}
