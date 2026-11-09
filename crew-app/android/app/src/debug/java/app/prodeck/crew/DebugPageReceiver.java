package app.prodeck.crew;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.util.HashMap;
import java.util.Map;

/**
 * Debug builds only. Shows a message exactly as CrewMessagingService would,
 * from the same fields the relay sends (push-edge/src/payload.ts fcmMessage):
 *
 *   adb shell am broadcast -a app.prodeck.crew.DEBUG_PAGE -n app.prodeck.crew/.DebugPageReceiver \
 *     --es kind page --es title "ProDeck · Page" --es body "Camera 2 to the booth" --es ack "http://…/api/page/ack?k=…"
 */
public class DebugPageReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        Map<String, String> data = new HashMap<>();
        for (String k : new String[] { "kind", "title", "body", "tag", "ack" }) {
            String v = intent.getStringExtra(k);
            if (v != null) data.put(k, v);
        }
        PageAlerts.show(context.getApplicationContext(), data);
    }
}
