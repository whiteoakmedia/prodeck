package app.prodeck.crew;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Every push for this app arrives here (it replaces the push plugin's own
 * service in AndroidManifest.xml). Pages and crew messages are data only, so
 * Android never draws them itself: PageAlerts does, app open or not.
 */
public class CrewMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);
        PageAlerts.show(getApplicationContext(), message.getData());
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        // The app hands a fresh token to the booth each time a church opens
        // (src/native.ts pushToken); this just keeps the plugin informed.
        PushNotificationsPlugin.onNewToken(token);
    }
}
