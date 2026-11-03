package app.prodeck.crew;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.Inet4Address;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.Collections;

/**
 * Finding the booth when the church Wi-Fi blocks Bonjour (src/sweep.ts): the
 * phone's own Wi-Fi address and prefix (Wi-Fi and wired only, not cellular or
 * VPN), and a quick check of which addresses on that network accept a
 * connection on the booth's port. Done here rather than with web requests,
 * which queue up behind each other and time out before they're even sent.
 */
@CapacitorPlugin(name = "NetInfo")
public class NetInfoPlugin extends Plugin {

    @PluginMethod
    public void wifi(PluginCall call) {
        JSArray out = new JSArray();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                String name = ni.getName();
                if (!ni.isUp() || ni.isLoopback() || !(name.startsWith("wlan") || name.startsWith("eth"))) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    if (!(ia.getAddress() instanceof Inet4Address)) continue;
                    JSObject a = new JSObject();
                    a.put("interface", name);
                    a.put("ip", ia.getAddress().getHostAddress());
                    a.put("prefix", ia.getNetworkPrefixLength());
                    out.put(a);
                }
            }
        } catch (Exception e) {
            // No interfaces readable: the app falls back to Bonjour alone.
        }
        JSObject ret = new JSObject();
        ret.put("addresses", out);
        call.resolve(ret);
    }

    @PluginMethod
    public void probe(PluginCall call) {
        final List<String> hosts = new ArrayList<>();
        try {
            JSArray arr = call.getArray("hosts", new JSArray());
            for (int i = 0; i < arr.length(); i++) hosts.add(arr.getString(i));
        } catch (Exception e) {
            call.reject("hosts must be a list of addresses");
            return;
        }
        final int port = call.getInt("port", 8088);
        final int timeoutMs = call.getInt("timeoutMs", 700);
        new Thread(() -> {
            final List<String> open = java.util.Collections.synchronizedList(new ArrayList<>());
            ExecutorService pool = Executors.newFixedThreadPool(64);
            for (String host : hosts) {
                pool.execute(() -> {
                    try (Socket s = new Socket()) {
                        s.connect(new InetSocketAddress(host, port), timeoutMs);
                        open.add(host);
                    } catch (Exception ignored) {
                        // Nothing there, or not a booth.
                    }
                });
            }
            pool.shutdown();
            try {
                pool.awaitTermination(60, TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            JSArray out = new JSArray();
            synchronized (open) {
                for (String h : open) out.put(h);
            }
            JSObject ret = new JSObject();
            ret.put("open", out);
            call.resolve(ret);
        }).start();
    }
}
