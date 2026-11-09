package app.prodeck.crew;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * The phone's push token for pages (src/native.ts pushToken). A build made
 * without google-services.json has no push project: it answers with no
 * token instead of crashing, and the booth page simply offers no pages.
 */
@CapacitorPlugin(name = "CrewPush")
public class CrewPushPlugin extends Plugin {

    @PluginMethod
    public void token(PluginCall call) {
        JSObject out = new JSObject();
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            out.put("token", "");
            out.put("why", "no push project in this build");
            call.resolve(out);
            return;
        }
        try {
            FirebaseMessaging.getInstance().setAutoInitEnabled(true);
            FirebaseMessaging.getInstance()
                .getToken()
                .addOnCompleteListener((task) -> {
                    JSObject r = new JSObject();
                    if (task.isSuccessful() && task.getResult() != null) {
                        r.put("token", task.getResult());
                    } else {
                        r.put("token", "");
                        Exception e = task.getException();
                        r.put("why", e == null ? "no token" : String.valueOf(e.getMessage()));
                    }
                    call.resolve(r);
                });
        } catch (Exception e) {
            out.put("token", "");
            out.put("why", String.valueOf(e.getMessage()));
            call.resolve(out);
        }
    }
}
