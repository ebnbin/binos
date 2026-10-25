// 这个版本的 app 按哪一版接口写的：server/protocol.schema.json 的 sha256 前 12 位，pnpm check 核对它和 schema 一致
enum BinOSProtocol {
    static let protocolID = "03093a51d165"
}
