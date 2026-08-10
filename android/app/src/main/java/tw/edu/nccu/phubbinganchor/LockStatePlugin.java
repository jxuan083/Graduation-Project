package tw.edu.nccu.phubbinganchor;

import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * LockState — 回報「裝置是否鎖定/關螢幕」給前端，讓分心偵測能分辨
 * 「在 App 內按關螢幕鍵」與「切去別的 app」。
 *
 * ACTION_SCREEN_OFF：按電源鍵關螢幕（= 把手機放下，視為專注）。
 * ACTION_USER_PRESENT：使用者解鎖。
 * 兩者皆為系統保護廣播，需動態註冊（不能寫在 manifest）。
 */
@CapacitorPlugin(name = "LockState")
public class LockStatePlugin extends Plugin {

    private BroadcastReceiver receiver;
    private boolean locked = false;
    private long lastLockedAt = 0L;
    private long lastUnlockedAt = 0L;

    @Override
    public void load() {
        KeyguardManager km = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        locked = km != null && km.isKeyguardLocked();

        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;
                if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                    setLocked(true);
                } else if (Intent.ACTION_USER_PRESENT.equals(action)) {
                    setLocked(false);
                }
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        // 只聽系統保護廣播，NOT_EXPORTED 即可（Android 14+ 需明確標示）。
        ContextCompat.registerReceiver(getContext(), receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    private void setLocked(boolean value) {
        locked = value;
        long now = System.currentTimeMillis();
        if (value) {
            lastLockedAt = now;
        } else {
            lastUnlockedAt = now;
        }
        notifyListeners("lockStateChange", buildState());
    }

    private JSObject buildState() {
        JSObject o = new JSObject();
        o.put("locked", locked);
        o.put("lastLockedAt", lastLockedAt);
        o.put("lastUnlockedAt", lastUnlockedAt);
        return o;
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(buildState());
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (Exception ignored) {
                // 已解除註冊時忽略
            }
            receiver = null;
        }
    }
}
