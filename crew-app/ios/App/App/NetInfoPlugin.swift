import Capacitor
import Foundation

/// Finding the booth when the church Wi-Fi blocks Bonjour (src/sweep.ts):
/// the phone's own Wi-Fi address and netmask (Wi-Fi and wired only, not
/// cellular or VPN), and a quick check of which addresses on that network
/// accept a connection on the booth's port. Done here rather than with web
/// requests, which queue up behind each other and time out before they're
/// even sent.
@objc(NetInfoPlugin)
public class NetInfoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NetInfoPlugin"
    public let jsName = "NetInfo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "wifi", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "probe", returnType: CAPPluginReturnPromise)
    ]

    @objc func wifi(_ call: CAPPluginCall) {
        var out: [[String: String]] = []
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else {
            call.resolve(["addresses": out])
            return
        }
        defer { freeifaddrs(list) }
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let ifa = p.pointee
            guard let addr = ifa.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET),
                  let mask = ifa.ifa_netmask,
                  (ifa.ifa_flags & UInt32(IFF_UP)) != 0 else { continue }
            let name = String(cString: ifa.ifa_name)
            guard name.hasPrefix("en") else { continue }
            out.append(["interface": name, "ip": numeric(addr), "netmask": numeric(mask)])
        }
        call.resolve(["addresses": out])
    }

    /// Which of `hosts` accept a TCP connection on `port`, `width` at a time,
    /// and how the rest answered: refused (a device, nothing on that port),
    /// silent (no device, or a firewall), or another error by its errno. The
    /// tallies are shown when nothing is found, to tell a blocked phone from
    /// an empty network.
    @objc func probe(_ call: CAPPluginCall) {
        let hosts = call.getArray("hosts", String.self) ?? []
        let port = UInt16(clamping: call.getInt("port") ?? 8088)
        let timeoutMs = Int32(call.getInt("timeoutMs") ?? 800)
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = max(1, min(call.getInt("width") ?? 64, 128))
        let lock = NSLock()
        var open: [String] = []
        var refused = 0
        var silent = 0
        var errors: [String: Int] = [:]
        let started = Date()
        for host in hosts {
            queue.addOperation {
                let result = NetInfoPlugin.connectResult(host, port, timeoutMs)
                lock.lock()
                switch result {
                case 0: open.append(host)
                case ECONNREFUSED: refused += 1
                case -2: silent += 1
                default: errors[String(result), default: 0] += 1
                }
                lock.unlock()
            }
        }
        DispatchQueue.global().async {
            queue.waitUntilAllOperationsAreFinished()
            call.resolve([
                "open": open, "refused": refused, "silent": silent, "errors": errors,
                "ms": Int(Date().timeIntervalSince(started) * 1000)
            ])
        }
    }

    /// 0 = connected, -2 = no answer in time, otherwise the errno.
    private static func connectResult(_ host: String, _ port: UInt16, _ timeoutMs: Int32) -> Int32 {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        if fd < 0 { return errno }
        defer { close(fd) }
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK)
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        guard inet_pton(AF_INET, host, &addr.sin_addr) == 1 else { return -1 }
        let r = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if r == 0 { return 0 }
        if errno != EINPROGRESS { return errno }
        var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
        guard poll(&pfd, 1, timeoutMs) == 1 else { return -2 }
        var err: Int32 = 0
        var len = socklen_t(MemoryLayout<Int32>.size)
        getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &len)
        return err
    }

    private func numeric(_ sa: UnsafeMutablePointer<sockaddr>) -> String {
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
        return String(cString: host)
    }
}

/// Capacitor's view controller, plus the app's own plugins.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NetInfoPlugin())
    }
}
