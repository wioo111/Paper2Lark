package app.cark.reader;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Locale;
import java.util.UUID;

@CapacitorPlugin(name = "CarkImport")
public class CarkImportPlugin extends Plugin {
    private static final long MAX_PACKAGE_BYTES = 512L * 1024L * 1024L;
    private File pendingFile;
    private String pendingName;
    private String pendingType;
    private String pendingError;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        receiveIntent(intent);
    }

    private void receiveIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            uri = sharedStream(intent);
        }
        if (uri == null) return;

        ContentResolver resolver = getContext().getContentResolver();
        String name = displayName(resolver, uri);
        String type = resolver.getType(uri);
        if (!isSupported(name, type)) return;

        try {
            File importDirectory = new File(getContext().getCacheDir(), "paper-imports");
            if (!importDirectory.exists() && !importDirectory.mkdirs()) {
                throw new IllegalStateException("Cannot create import directory");
            }
            deletePendingFile();
            File destination = new File(importDirectory, UUID.randomUUID() + ".carkpaper");
            long total = 0;
            try (InputStream input = resolver.openInputStream(uri); FileOutputStream output = new FileOutputStream(destination)) {
                if (input == null) throw new IllegalStateException("Cannot open shared file");
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > MAX_PACKAGE_BYTES) throw new IllegalArgumentException("Package exceeds 512 MB");
                    output.write(buffer, 0, count);
                }
            } catch (Exception error) {
                destination.delete();
                throw error;
            }
            pendingFile = destination;
            pendingName = name;
            pendingType = type;
            pendingError = null;
            notifyListeners("paperImportAvailable", pendingPayload(), true);
        } catch (Exception error) {
            pendingError = error.getMessage() == null ? "Cannot read shared paper package" : error.getMessage();
            notifyListeners("paperImportAvailable", pendingPayload(), true);
        }
    }

    @SuppressWarnings("deprecation")
    private Uri sharedStream(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    private boolean isSupported(String name, String type) {
        String normalizedName = name == null ? "" : name.toLowerCase(Locale.ROOT);
        return normalizedName.endsWith(".carkpaper")
            || normalizedName.endsWith(".carklibrary")
            || "application/vnd.cark.paper+zip".equals(type)
            || "application/vnd.cark.library+zip".equals(type)
            || "application/zip".equals(type)
            || "application/octet-stream".equals(type);
    }

    private String displayName(ContentResolver resolver, Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (index >= 0) return cursor.getString(index);
                }
            } catch (Exception ignored) {}
        }
        String segment = uri.getLastPathSegment();
        return segment == null || segment.isEmpty() ? "paper.carkpaper" : segment;
    }

    private JSObject pendingPayload() {
        JSObject payload = new JSObject();
        if (pendingError != null) {
            payload.put("error", pendingError);
            return payload;
        }
        if (pendingFile == null || !pendingFile.exists()) return payload;
        payload.put("path", Uri.fromFile(pendingFile).toString());
        payload.put("name", pendingName == null ? "paper.carkpaper" : pendingName);
        payload.put("type", pendingType == null ? "application/vnd.cark.paper+zip" : pendingType);
        payload.put("size", pendingFile.length());
        return payload;
    }

    @PluginMethod
    public void getPendingImport(PluginCall call) {
        call.resolve(pendingPayload());
    }

    @PluginMethod
    public void consumePendingImport(PluginCall call) {
        deletePendingFile();
        call.resolve();
    }

    private void deletePendingFile() {
        if (pendingFile != null && pendingFile.exists()) pendingFile.delete();
        pendingFile = null;
        pendingName = null;
        pendingType = null;
        pendingError = null;
    }
}
