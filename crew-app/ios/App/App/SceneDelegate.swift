import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()
        // The bridge just made Capacitor the notification handler; put the
        // page handler back in front (AppDelegate.swift PageAlerts).
        PageAlerts.shared.takeOver()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    // With scenes, iOS calls these instead of the app delegate's
    // applicationDidBecomeActive, so the page handler is re-checked here.
    func sceneDidBecomeActive(_ scene: UIScene) {
        PageAlerts.shared.takeOver()
        // The app is open: the booth page shows any page still waiting.
        PageAlerts.clearDelivered()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
        if let url = URLContexts.first?.url { CrewLinks.forward(url, in: window) }
    }

    // A crew code (https://<name>-crew.prodeck.live/join) scanned with the
    // camera while the app is running: iOS hands it over here.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
        if userActivity.activityType == NSUserActivityTypeBrowsingWeb, let url = userActivity.webpageURL {
            CrewLinks.forward(url, in: window)
        }
    }
}

/// Links that open the app (a crew code, or prodeckcrew://) while the web view
/// shows a church's own page. That page has no Capacitor bridge, so it can't
/// hear the app's link event: load the app's own page instead, with the link
/// in ?openlink= (App.tsx acts on it). On the app's own page the link event
/// already reaches it, so nothing is done here. A cold start is the same: the
/// app's page is showing and reads the launch link itself.
enum CrewLinks {
    static func forward(_ url: URL, in window: UIWindow?) {
        guard let web = (window?.rootViewController as? CAPBridgeViewController)?.webView else { return }
        if web.url?.scheme == "capacitor" || web.url == nil { return }
        var c = URLComponents()
        c.scheme = "capacitor"
        c.host = "localhost"
        c.path = "/"
        c.queryItems = [URLQueryItem(name: "openlink", value: url.absoluteString)]
        if let target = c.url { web.load(URLRequest(url: target)) }
    }
}
