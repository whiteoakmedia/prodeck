package app.prodeck.crew;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins, registered before the bridge starts.
        registerPlugin(NetInfoPlugin.class);
        registerPlugin(CrewPushPlugin.class);
        super.onCreate(savedInstanceState);
        PageAlerts.createChannels(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        // The app is open: the booth's page shows any page still waiting.
        PageAlerts.clearPages(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        CrewLinks.forward(this, intent);
    }

    /**
     * Links that open the app (a crew code, or prodeckcrew://) while the web
     * view shows a church's own page. That page has no Capacitor bridge, so it
     * can't hear the app's link event: load the app's own page instead, with
     * the link in ?openlink= (App.tsx acts on it). On the app's own page the
     * event already reaches it. A cold start reads the launch link itself.
     * (The iPhone does the same in SceneDelegate.swift CrewLinks.)
     */
    static final class CrewLinks {

        static void forward(MainActivity activity, Intent intent) {
            if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
            Uri link = intent.getData();
            if (link == null || activity.getBridge() == null) return;
            WebView web = activity.getBridge().getWebView();
            String local = activity.getBridge().getLocalUrl();
            String now = web.getUrl();
            if (now == null || local == null || now.startsWith(local)) return;
            String target = Uri.parse(local).buildUpon().path("/").appendQueryParameter("openlink", link.toString()).build().toString();
            web.post(() -> web.loadUrl(target));
        }
    }
}
