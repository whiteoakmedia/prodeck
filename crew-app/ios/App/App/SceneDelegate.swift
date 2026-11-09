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
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
