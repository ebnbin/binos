import Foundation
import Observation

enum APIError: LocalizedError {
    // Cloudflare Access 要求登录：被重定向到登录页，或者拿到 401
    case unauthorized(String?)
    // code 是服务端的错误标识（server/src/errors.ts 的 ErrorCode），不是服务端的响应时没有
    case http(Int, code: String?, message: String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .unauthorized(let message): message ?? "需要登录"
        case .http(let status, _, let message): message.isEmpty ? "请求失败（\(status)）" : message
        case .invalidResponse: "无法识别服务器的返回"
        }
    }

    var status: Int? {
        if case .http(let status, _, _) = self { return status }
        return nil
    }

    var code: String? {
        if case .http(_, let code, _) = self { return code }
        return nil
    }
}

// 连接的 binOS：正式版经过 Cloudflare Access，要先在网页里登录；pnpm dev 启动的测试实例直接连
struct ServerProfile: Codable, Hashable, Identifiable {
    var url: URL
    var id: String { url.absoluteString }
    var requiresLogin: Bool { url.scheme == "https" }
    var name: String { url.host(percentEncoded: false).map { host in url.port.map { "\(host):\($0)" } ?? host } ?? url.absoluteString }

    static let production = ServerProfile(url: URL(string: "https://binos.app")!)
}

@Observable
final class API {
    static let shared = API()

    private(set) var server: ServerProfile
    private(set) var recentServers: [ServerProfile]
    // 正式版的登录过期或还没登录时为 true，界面弹出登录页
    var needsLogin = false

    let session: URLSession

    private init() {
        let defaults = UserDefaults.standard
        // 启动参数 -serverURL http://127.0.0.1:端口 可以直接指定连接的实例
        if let override = defaults.string(forKey: "serverURL"), let url = URL(string: override) {
            server = ServerProfile(url: url)
        } else if let data = defaults.data(forKey: "server"), let saved = try? JSONDecoder().decode(ServerProfile.self, from: data) {
            server = saved
        } else {
            server = .production
        }
        recentServers = (defaults.data(forKey: "recentServers").flatMap { try? JSONDecoder().decode([ServerProfile].self, from: $0) }) ?? [.production]
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = .shared
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = 30
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration)
    }

    func select(_ profile: ServerProfile) {
        server = profile
        recentServers = [profile] + recentServers.filter { $0 != profile }
        if !recentServers.contains(.production) { recentServers.append(.production) }
        let encoder = JSONEncoder()
        UserDefaults.standard.set(try? encoder.encode(profile), forKey: "server")
        UserDefaults.standard.set(try? encoder.encode(recentServers), forKey: "recentServers")
        needsLogin = false
    }

    var baseURL: URL { server.url }

    func url(_ path: String, query: [String: String] = [:]) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.path = path
        if !query.isEmpty {
            components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return components.url!
    }

    // WebSocket 用的地址：http 换成 ws
    func webSocketURL(_ path: String, query: [String: String] = [:]) -> URL {
        var components = URLComponents(url: url(path, query: query), resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        return components.url!
    }

    // 带上登录 cookie 的请求，WebSocket、播放器等不经过 URLSession 数据任务的地方也用它
    func request(_ url: URL, method: String = "GET") -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let cookies = HTTPCookieStorage.shared.cookies(for: url), !cookies.isEmpty {
            for (key, value) in HTTPCookie.requestHeaderFields(with: cookies) {
                request.setValue(value, forHTTPHeaderField: key)
            }
        }
        return request
    }

    // 被重定向去了别的域名（Access 的登录页）或者 401：需要登录
    func check(_ response: URLResponse, data: Data?) throws -> HTTPURLResponse {
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        let error = data.flatMap { try? JSONDecoder.api.decode(ErrorBody.self, from: $0).error }
        if http.url?.host() != baseURL.host() || http.statusCode == 401 {
            if server.requiresLogin { needsLogin = true }
            throw APIError.unauthorized(error?.message)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, code: error?.code, message: error?.message ?? "")
        }
        return http
    }

    private struct ErrorBody: Decodable {
        struct Detail: Decodable {
            let code: String
            let message: String
        }
        let error: Detail
    }

    // 没有响应内容的接口（204）用 Ignored，不解码
    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        if let ignored = Ignored() as? T { return ignored }
        return try JSONDecoder.api.decode(T.self, from: data)
    }

    func data(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        _ = try check(response, data: data)
        return data
    }

    func get<T: Decodable>(_ path: String, query: [String: String] = [:], as type: T.Type = T.self) async throws -> T {
        let data = try await data(request(url(path, query: query)))
        return try decode(T.self, from: data)
    }

    // 写操作都带 JSON 的 Content-Type，后端以此拒绝跨站请求；不带请求体的 DELETE 例外
    @discardableResult
    func send<T: Decodable>(_ method: String, _ path: String, query: [String: String] = [:], body: (any Encodable)? = nil, as type: T.Type = T.self) async throws -> T {
        var request = request(url(path, query: query), method: method)
        if method != "DELETE" || body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try body.map { try JSONEncoder().encode($0) } ?? Data("{}".utf8)
        }
        let data = try await data(request)
        return try decode(T.self, from: data)
    }

    func post(_ path: String, body: (any Encodable)? = nil) async throws {
        let _: Ignored = try await send("POST", path, body: body)
    }

    func put(_ path: String, body: any Encodable) async throws {
        let _: Ignored = try await send("PUT", path, body: body)
    }

    func delete(_ path: String, query: [String: String] = [:]) async throws {
        let _: Ignored = try await send("DELETE", path, query: query)
    }

    // 上传文件：请求体就是文件本身
    func upload<T: Decodable>(_ path: String, data body: Data, headers: [String: String], as type: T.Type = T.self) async throws -> T {
        var request = request(url(path), method: "POST")
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        let (data, response) = try await session.upload(for: request, from: body)
        _ = try check(response, data: data)
        return try decode(T.self, from: data)
    }

    // 下载到临时目录，给系统的预览、分享用；文件名保留原样
    func download(_ url: URL, name: String) async throws -> URL {
        let (temp, response) = try await session.download(for: request(url))
        let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
        _ = try check(response, data: ok ? nil : try? Data(contentsOf: temp))
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let target = directory.appending(path: name.isEmpty ? (response.suggestedFilename ?? "file") : name)
        try FileManager.default.moveItem(at: temp, to: target)
        return target
    }
}

// 不关心内容的返回
struct Ignored: Decodable {
    init() {}
    init(from decoder: Decoder) throws {}
}
