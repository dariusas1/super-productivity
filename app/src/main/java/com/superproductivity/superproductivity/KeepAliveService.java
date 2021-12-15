
package com.superproductivity.superproductivity;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class KeepAliveService extends Service {
    private static final int NOTIFY_ID = 1;
    private static final String NOTIFY_CHANNEL_ID = "SUP_KeepAlive";
    private  NotificationManager notificationManager;
    private final NotificationCompat.Builder builder = new NotificationCompat.Builder(this,
            NOTIFY_CHANNEL_ID);


    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground();
        return super.onStartCommand(intent, flags, startId);
    }

    private void updateNotification(String message, int progress) {
        builder.setContentText(message)
                .setProgress(100, progress, true);
        notificationManager.notify(NOTIFY_ID, builder.build());
    }

    private void startForeground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // create notification channel
            CharSequence name = NOTIFY_CHANNEL_ID;
            String description = "Here to keep the app alive for syncing";
            int importance = NotificationManager.IMPORTANCE_DEFAULT;

            NotificationChannel channel = null;
            channel = new NotificationChannel(NOTIFY_CHANNEL_ID, name, importance);
            channel.setDescription(description);
            notificationManager = getSystemService(NotificationManager.class);
            notificationManager.createNotificationChannel(channel);

            // create notification
            Intent notificationIntent = new Intent(this, FullscreenActivity.class);
            PendingIntent pendingIntent = PendingIntent.getActivity(this, 0,
                    notificationIntent, 0);

            startForeground(NOTIFY_ID, builder
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .setSmallIcon(R.drawable.ic_sp)
                    .setContentTitle(getString(R.string.app_name))
                    .setContentText("Service is running background")
                    .setContentIntent(pendingIntent)
                    .build());

            updateNotification("YEAH", 22);
        }
    }
}
