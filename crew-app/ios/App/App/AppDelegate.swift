import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        PageAlerts.installSound()
        PageAlerts.registerCategory()
        // Before launch finishes, so a lock screen "Got it" that wakes the app
        // in the background is handled even though no web view ever loads.
        PageAlerts.shared.takeOver()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Capacitor's bridge makes itself the notification handler when it
        // loads; sit in front of it again (everything that isn't a page's
        // Got it is passed straight through).
        PageAlerts.shared.takeOver()
        // The app is open: the booth page shows any page still waiting, so
        // the stack of repeats on the lock screen has done its job.
        PageAlerts.clearDelivered()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // Hands the phone's push token (or the reason there isn't one) to the
    // push notifications plugin, which passes it to the app's page.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

/// Pages on the lock screen (push-edge/src/payload.ts sends them): the page
/// sound, a "Got it" button that confirms without opening the app, and a tidy
/// lock screen once the app is open.
final class PageAlerts: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PageAlerts()
    static let category = "PAGE"
    static let gotIt = "GOT_IT"
    static let sound = "page.caf"

    /// Capacitor's own handler, which gets everything we don't handle.
    private weak var next: UNUserNotificationCenterDelegate?

    func takeOver() {
        let center = UNUserNotificationCenter.current()
        guard center.delegate !== self else { return }
        next = center.delegate
        center.delegate = self
    }

    /// Notification sounds must live in the app bundle's root or in
    /// Library/Sounds; the web build puts it in public/, so copy it over.
    static func installSound() {
        let fm = FileManager.default
        guard let src = Bundle.main.url(forResource: "page", withExtension: "caf", subdirectory: "public"),
              let lib = fm.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        let dir = lib.appendingPathComponent("Sounds", isDirectory: true)
        let dst = dir.appendingPathComponent(sound)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        try? fm.removeItem(at: dst)
        try? fm.copyItem(at: src, to: dst)
    }

    static func registerCategory() {
        let got = UNNotificationAction(identifier: gotIt, title: "Got it", options: [])
        let cat = UNNotificationCategory(identifier: category, actions: [got], intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([cat])
    }

    static func clearDelivered(_ done: (() -> Void)? = nil) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { list in
            let ids = list.filter { $0.request.content.categoryIdentifier == category }.map { $0.request.identifier }
            center.removeDeliveredNotifications(withIdentifiers: ids)
            done?()
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if let n = next, n.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) {
            n.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
        } else {
            completionHandler([.banner, .list, .sound])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let content = response.notification.request.content
        if response.actionIdentifier == Self.gotIt {
            confirm(content: content, done: completionHandler)
            return
        }
        if let n = next, n.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
            n.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
        } else {
            completionHandler()
        }
    }

    /// Post the page's own confirm link (the booth's pages.rs ack_key). On
    /// success the repeats on the lock screen go; if the booth can't be
    /// reached, say so, so nobody believes a confirm that never landed.
    private func confirm(content: UNNotificationContent, done: @escaping () -> Void) {
        guard let link = content.userInfo["ack"] as? String, let url = URL(string: link) else {
            Self.tellToOpen(content)
            done()
            return
        }
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(task) }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            let finish = {
                done()
                UIApplication.shared.endBackgroundTask(task)
            }
            if ok {
                Self.clearDelivered { DispatchQueue.main.async(execute: finish) }
            } else {
                Self.tellToOpen(content)
                DispatchQueue.main.async(execute: finish)
            }
        }.resume()
    }

    private static func tellToOpen(_ page: UNNotificationContent) {
        let note = UNMutableNotificationContent()
        note.title = "Not confirmed yet"
        note.body = "Couldn't reach the booth. Open ProDeck Crew to confirm the page."
        note.sound = .default
        note.threadIdentifier = "pages"
        let req = UNNotificationRequest(identifier: "page-not-confirmed", content: note, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }
}
