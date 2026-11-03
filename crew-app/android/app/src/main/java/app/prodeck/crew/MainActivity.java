package app.prodeck.crew;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins, registered before the bridge starts.
        registerPlugin(NetInfoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
