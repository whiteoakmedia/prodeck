package app.prodeck.crew;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * A page's "Got it" button on the shade or lock screen: confirm without
 * opening the app (PageAlerts.confirm), off the main thread.
 */
public class GotItReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!PageAlerts.ACTION_GOT_IT.equals(intent.getAction())) return;
        final String ack = intent.getStringExtra(PageAlerts.EXTRA_ACK);
        final Context app = context.getApplicationContext();
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                if (PageAlerts.confirm(ack)) PageAlerts.clearPages(app);
                else PageAlerts.tellToOpen(app);
            } finally {
                pending.finish();
            }
        }, "page-got-it").start();
    }
}
