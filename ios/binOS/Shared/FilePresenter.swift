import Observation
import QuickLook
import SwiftUI

// 服务器上的文件先下载到临时目录，再用系统的快速查看打开，可以分享、存储
@Observable
final class FilePresenter {
    static let shared = FilePresenter()

    var previewURL: URL?
    private(set) var loading: String?
    var error: String?

    func present(url: URL, name: String) {
        loading = name
        Task {
            defer { loading = nil }
            do {
                previewURL = try await API.shared.download(url, name: name)
            } catch {
                self.error = "打开 \(name) 失败：\(error.localizedDescription)"
            }
        }
    }
}

struct FilePresenterModifier: ViewModifier {
    @Bindable var presenter = FilePresenter.shared

    func body(content: Content) -> some View {
        content
            .quickLookPreview($presenter.previewURL)
            .overlay(alignment: .top) {
                if let name = presenter.loading {
                    Label("正在打开 \(name)", systemImage: "arrow.down.circle")
                        .font(.footnote)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .glassEffect()
                        .padding(.top, 8)
                }
            }
            .alert("无法打开文件", isPresented: Binding(get: { presenter.error != nil }, set: { if !$0 { presenter.error = nil } })) {
                Button("好") {}
            } message: {
                Text(presenter.error ?? "")
            }
    }
}

// 经过登录的网络层加载的图片，带内存缓存
struct RemoteImage: View {
    let url: URL
    var contentMode: ContentMode = .fit
    @State private var image: UIImage?
    @State private var failed = false

    private static let cache = NSCache<NSURL, UIImage>()

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
            } else if failed {
                Image(systemName: "photo.badge.exclamationmark")
                    .foregroundStyle(.secondary)
                    .frame(width: 60, height: 60)
            } else {
                ProgressView()
                    .frame(width: 60, height: 60)
            }
        }
        .task(id: url) {
            if let cached = Self.cache.object(forKey: url as NSURL) {
                image = cached
                return
            }
            do {
                let data = try await API.shared.data(API.shared.request(url))
                if let loaded = UIImage(data: data) {
                    Self.cache.setObject(loaded, forKey: url as NSURL)
                    image = loaded
                } else {
                    failed = true
                }
            } catch {
                failed = true
            }
        }
    }
}
