package app.cark.reader;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CarkImportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
