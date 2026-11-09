package app.prodeck.crew;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Pages and crew notifications on Android (the iPhone's PageAlerts lives in
 * ios/App/App/AppDelegate.swift). The relay (push-edge/src/payload.ts
 * fcmMessage) sends data only, so this app draws every notification itself:
 * that's the only way a page gets its own sound, a "Got it" button, and shows
 * even while the app is open.
 *
 *  - Pages go on the "pages" channel: high importance, the page sound,
 *    vibration. Each repeat is a new notification, so it rings again.
 *  - Chat and reminders go on "crew": ordinary, and a newer one with the
 *    same tag replaces the last.
 *  - "Got it" posts the page's own confirm link (the booth's pages.rs
 *    ack_key) without opening the app. On success every page on the phone
 *    goes; if the booth can't be reached, it says so.
 *  - Opening the app clears pages (MainActivity.onResume): the booth's page
 *    shows any page still waiting.
 */
public final class PageAlerts {

    private PageAlerts() {}

    /** Bumped from "pages": a channel's sound can't change once it exists. */
    static final String PAGES = "pages";
    static final String CREW = "crew";
    static final String GROUP = "app.prodeck.crew.PAGES";
    /** Notification tag for every page, so they can be found and cleared. */
    static final String PAGE_TAG = "page";
    static final String NOT_CONFIRMED_TAG = "page-not-confirmed";
    static final String ACTION_GOT_IT = "app.prodeck.crew.GOT_IT";
    static final String EXTRA_ACK = "ack";

    private static final Pattern ACK = Pattern.compile("^https?://[^\\s\"'<>]+/api/page/ack\\?k=[0-9a-fA-F]{32}$");

    /** A confirm link worth posting: the shape the booth makes, nothing else. */
    static String cleanAck(String ack) {
        if (ack == null || ack.length() > 300) return null;
        return ACK.matcher(ack).matches() ? ack : null;
    }

    static Uri soundUri(Context ctx) {
        return Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + ctx.getPackageName() + "/" + R.raw.page);
    }

    /** Both channels; safe to call every launch. */
    static void createChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel pages = new NotificationChannel(PAGES, "Pages", NotificationManager.IMPORTANCE_HIGH);
        pages.setDescription("When someone pages you from the booth");
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        pages.setSound(soundUri(ctx), attrs);
        pages.enableVibration(true);
        pages.setVibrationPattern(new long[] { 0, 400, 200, 400, 200, 400 });
        pages.enableLights(true);
        pages.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(pages);

        NotificationChannel crew = new NotificationChannel(CREW, "Crew messages", NotificationManager.IMPORTANCE_DEFAULT);
        crew.setDescription("Team chat and reminders");
        nm.createNotificationChannel(crew);
    }

    /** One message from the relay. Not ours (no "kind"): ignored. */
    static void show(Context ctx, Map<String, String> data) {
        String kind = data.get("kind");
        if (kind == null) return;
        String title = orEmpty(data.get("title"));
        String body = orEmpty(data.get("body"));
        if (body.isEmpty()) return;
        boolean page = "page".equals(kind);
        createChannels(ctx);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, page ? PAGES : CREW)
            .setSmallIcon(R.drawable.ic_stat_prodeck)
            .setColor(0xFF5B8DEF)
            .setContentTitle(title.isEmpty() ? "ProDeck Crew" : title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        int id;
        String tag;
        if (page) {
            // Before Android 8 there are no channels: say it on the builder.
            b.setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setSound(soundUri(ctx))
                .setVibrate(new long[] { 0, 400, 200, 400, 200, 400 })
                .setGroup(GROUP);
            String ack = cleanAck(data.get("ack"));
            if (ack != null) {
                b.addAction(new NotificationCompat.Action.Builder(0, "Got it", gotIt(ctx, ack)).build());
            }
            // Every repeat is its own notification, so it rings and buzzes
            // again (an update to the same one can arrive silently).
            tag = PAGE_TAG;
            id = (int) (System.currentTimeMillis() & 0x7fffffff);
        } else {
            b.setPriority(NotificationCompat.PRIORITY_DEFAULT);
            String t = orEmpty(data.get("tag"));
            tag = t.isEmpty() ? "crew" : "crew:" + t;
            id = t.isEmpty() ? (int) (System.currentTimeMillis() & 0x7fffffff) : 1;
        }
        try {
            NotificationManagerCompat.from(ctx).notify(tag, id, b.build());
        } catch (SecurityException e) {
            // Notifications turned off for the app since the token was handed over.
        }
    }

    /** The app is open: pages go from the shade (the booth's page shows them). */
    static void clearPages(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        for (StatusBarNotification n : nm.getActiveNotifications()) {
            if (PAGE_TAG.equals(n.getTag()) || NOT_CONFIRMED_TAG.equals(n.getTag())) nm.cancel(n.getTag(), n.getId());
        }
    }

    /** Post a page's confirm link. Blocking: call off the main thread. */
    static boolean confirm(String ack) {
        String link = cleanAck(ack);
        if (link == null) return false;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(link).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(10_000);
            c.setReadTimeout(10_000);
            c.setDoOutput(true);
            c.setFixedLengthStreamingMode(0);
            c.getOutputStream().close();
            return c.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** "Got it" didn't land: say so, so nobody believes a confirm that never happened. */
    static void tellToOpen(Context ctx) {
        createChannels(ctx);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, PAGES)
            .setSmallIcon(R.drawable.ic_stat_prodeck)
            .setColor(0xFF5B8DEF)
            .setContentTitle("Not confirmed yet")
            .setContentText("Couldn't reach the booth. Open ProDeck Crew to confirm the page.")
            .setStyle(new NotificationCompat.BigTextStyle().bigText("Couldn't reach the booth. Open ProDeck Crew to confirm the page."))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx));
        try {
            NotificationManagerCompat.from(ctx).notify(NOT_CONFIRMED_TAG, 1, b.build());
        } catch (SecurityException e) {
            /* notifications off */
        }
    }

    private static PendingIntent openApp(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent gotIt(Context ctx, String ack) {
        Intent i = new Intent(ctx, GotItReceiver.class).setAction(ACTION_GOT_IT).putExtra(EXTRA_ACK, ack);
        // One per link, so two pages on the shade each keep their own.
        return PendingIntent.getBroadcast(ctx, ack.hashCode(), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s.trim();
    }
}
