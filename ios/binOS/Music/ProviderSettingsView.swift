import SwiftUI

// 音乐来源的连接设置：字段由来源自己声明，保存后只显示是否已配置，不回显
struct ProviderSettingsView: View {
    let provider: ProviderInfo
    let onSaved: (ProviderInfo) -> Void
    @State private var values: [String: String] = [:]
    @State private var saving = false
    @State private var message: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(provider.description).font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(provider.configuration.fields) { field in
                    fieldSection(field)
                }
                if let message {
                    Text(message).font(.footnote)
                }
            }
            .navigationTitle(provider.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }

    private func fieldSection(_ field: ProviderInfo.Field) -> some View {
        let value = Binding(get: { values[field.id] ?? "" }, set: { values[field.id] = $0 })
        let trimmed = value.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let placeholder = field.configured ? "输入新值以替换" : field.label
        return Section {
            Group {
                if field.secret {
                    SecureField(placeholder, text: value)
                } else {
                    TextField(placeholder, text: value)
                }
            }
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onSubmit { if !trimmed.isEmpty { save([field.id: trimmed]) } }
            Button("保存") { save([field.id: trimmed]) }
                .disabled(saving || trimmed.isEmpty)
            if field.configured {
                Button("移除", role: .destructive) { save([field.id: ""]) }
                    .disabled(saving)
            }
        } header: {
            Text(field.configured ? "\(field.label) · 已配置" : field.label)
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                Text(field.description)
                ForEach(field.links ?? [], id: \.url) { link in
                    if let url = URL(string: link.url) { Link(link.label, destination: url) }
                }
            }
        }
    }

    private func save(_ patch: [String: String]) {
        saving = true
        message = nil
        Task {
            defer { saving = false }
            do {
                onSaved(try await MusicAPI.configure(provider: provider.id, values: patch))
                values = [:]
                message = "连接设置已保存。"
            } catch {
                message = error.localizedDescription
            }
        }
    }
}
