import Foundation

// 服务端先于 app 更新：新增字段、删掉可选字段、出现新的枚举值、列表里有一项解不开时，app 照样能显示其余的内容。
// 核心字段（id 之类）不用这些包装，缺了照样报错

// 列表：解不开的元素丢掉；整个字段缺失、是 null 或不是列表时为空
@propertyWrapper
nonisolated struct Lossy<Element> {
    var wrappedValue: [Element]

    init(wrappedValue: [Element] = []) {
        self.wrappedValue = wrappedValue
    }
}

private nonisolated struct Skipped: Decodable {
    init(from decoder: Decoder) throws {}
}

extension Lossy: Decodable where Element: Decodable {
    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var elements: [Element] = []
        while !container.isAtEnd {
            if let element = try? container.decode(Element.self) {
                elements.append(element)
            } else {
                _ = try container.decode(Skipped.self)
            }
        }
        wrappedValue = elements
    }
}

extension Lossy: Encodable where Element: Encodable {
    func encode(to encoder: Encoder) throws {
        try wrappedValue.encode(to: encoder)
    }
}

extension Lossy: Equatable where Element: Equatable {}
extension Lossy: Hashable where Element: Hashable {}
extension Lossy: Sendable where Element: Sendable {}

// 以字符串为键的表：解不开的值丢掉
@propertyWrapper
nonisolated struct LossyDictionary<Value> {
    var wrappedValue: [String: Value]

    init(wrappedValue: [String: Value] = [:]) {
        self.wrappedValue = wrappedValue
    }
}

private nonisolated struct AnyKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

extension LossyDictionary: Decodable where Value: Decodable {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: AnyKey.self)
        var values: [String: Value] = [:]
        for key in container.allKeys {
            if let value = try? container.decode(Value.self, forKey: key) { values[key.stringValue] = value }
        }
        wrappedValue = values
    }
}

extension LossyDictionary: Encodable where Value: Encodable {
    func encode(to encoder: Encoder) throws {
        try wrappedValue.encode(to: encoder)
    }
}

extension LossyDictionary: Equatable where Value: Equatable {}
extension LossyDictionary: Hashable where Value: Hashable {}
extension LossyDictionary: Sendable where Value: Sendable {}

// 非核心的字段：缺失、是 null 或类型不对时用默认值
nonisolated protocol DefaultValue {
    associatedtype Value: Decodable
    static var value: Value { get }
}

nonisolated enum Defaults {
    enum False: DefaultValue { static var value: Bool { false } }
    enum Zero: DefaultValue { static var value: Double { 0 } }
    enum ZeroInt: DefaultValue { static var value: Int { 0 } }
    enum Empty: DefaultValue { static var value: String { "" } }
}

@propertyWrapper
nonisolated struct Default<D: DefaultValue> {
    var wrappedValue: D.Value

    init(wrappedValue: D.Value = D.value) {
        self.wrappedValue = wrappedValue
    }
}

extension Default: Decodable {
    init(from decoder: Decoder) throws {
        wrappedValue = (try? decoder.singleValueContainer().decode(D.Value.self)) ?? D.value
    }
}

extension Default: Encodable where D.Value: Encodable {
    func encode(to encoder: Encoder) throws {
        try wrappedValue.encode(to: encoder)
    }
}

extension Default: Equatable where D.Value: Equatable {}
extension Default: Hashable where D.Value: Hashable {}
extension Default: Sendable where D.Value: Sendable {}

// 包装的字段缺失时不报错：合成的解码对它们调用 decode(_:forKey:)，这里换成没有就用默认值
extension KeyedDecodingContainer {
    nonisolated func decode<T: Decodable>(_ type: Lossy<T>.Type, forKey key: Key) throws -> Lossy<T> {
        (try? decodeIfPresent(type, forKey: key)) ?? Lossy()
    }

    nonisolated func decode<T: Decodable>(_ type: LossyDictionary<T>.Type, forKey key: Key) throws -> LossyDictionary<T> {
        (try? decodeIfPresent(type, forKey: key)) ?? LossyDictionary()
    }

    nonisolated func decode<D>(_ type: Default<D>.Type, forKey key: Key) throws -> Default<D> {
        (try? decodeIfPresent(type, forKey: key)) ?? Default()
    }
}

// 字符串枚举：不认识的值解成 fallback
nonisolated protocol LenientEnum: RawRepresentable, Decodable where RawValue == String {
    static var fallback: Self { get }
}

extension LenientEnum {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? .fallback
    }
}
