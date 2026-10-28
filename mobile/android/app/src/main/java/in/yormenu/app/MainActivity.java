package in.yormenu.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Direct printing to Bluetooth / USB / Wi-Fi thermal printers.
        registerPlugin(YorPrinterPlugin.class);
        super.onCreate(savedInstanceState);

        // Phone back button: close a popup or go to the previous screen inside YorMenu.
        // Only on the first screen does it send the app to the background (it keeps the login).
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge == null || bridge.getWebView() == null) {
                    moveTaskToBack(true);
                    return;
                }
                WebView web = bridge.getWebView();
                web.evaluateJavascript(
                    "(function(){try{return window.yormenuBack?window.yormenuBack():'none';}catch(e){return 'none';}})()",
                    (result) -> {
                        String r = result == null ? "" : result.replace("\"", "");
                        if ("handled".equals(r)) return;
                        if ("exit".equals(r)) moveTaskToBack(true);
                        else if (web.canGoBack()) web.goBack();
                        else moveTaskToBack(true);
                    }
                );
            }
        });
    }
}
