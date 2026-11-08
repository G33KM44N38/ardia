import ArdiaCore
import ExpoModulesCore
import Foundation
import Security

public class KeychainModule: Module {
  private static let service = Bundle.main.object(forInfoDictionaryKey: "ACPersonalRoutingBuild") as? Bool == true
    ? "Ardia Routing Connected Accounts" : "Ardia Connected Accounts"
  private static let migrationQueue = DispatchQueue(label: "ardia.routing.account-migration", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("ArdiaKeychain")

    AsyncFunction("officialMigrationStatus") { () -> [String: Any]? in
      guard let marker = Self.migrationMarker() else { return nil }
      return ["pending": marker["connectedAccounts"] as? String != "complete", "imported": marker["importedAccounts"] as? Int ?? 0]
    }.runOnQueue(Self.migrationQueue)

    AsyncFunction("importOfficialAccounts") { () throws -> Int in
      guard var marker = Self.migrationMarker(), marker["connectedAccounts"] as? String == "pending" else { return 0 }
      let request: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "Ardia Connected Accounts", kSecReturnAttributes as String: true,
        kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
      var found: CFTypeRef?
      let status = SecItemCopyMatching(request as CFDictionary, &found)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
      let entries = found as? [[String: Any]] ?? []
      var count = 0
      for entry in entries {
        guard let account = entry[kSecAttrAccount as String] as? String, let secret = entry[kSecValueData as String] as? Data else { continue }
        var item = Self.query(account)
        item[kSecValueData as String] = secret
        item[kSecAttrLabel as String] = "Ardia Routing: \(account)"
        let saved = SecItemAdd(item as CFDictionary, nil)
        guard saved == errSecSuccess || saved == errSecDuplicateItem else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(saved)) }
        count += 1
      }
      marker["connectedAccounts"] = "complete"
      marker["importedAccounts"] = count
      let data = try JSONSerialization.data(withJSONObject: marker)
      try data.write(to: DocumentStore.url("official-migration.json"), options: .atomic)
      return count
    }.runOnQueue(Self.migrationQueue)

    AsyncFunction("get") { (account: String) -> String? in
      if let store = IsolatedSecrets.shared { return store.get(account) }
      var query = Self.query(account)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      #if DEBUG
      query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
      #endif
      var item: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
      return String(data: data, encoding: .utf8)
    }

    AsyncFunction("set") { (account: String, secret: String) -> Bool in
      if let store = IsolatedSecrets.shared { return store.set(account, secret) }
      let data = Data(secret.utf8)
      let update: [String: Any] = [kSecValueData as String: data]
      var status = SecItemUpdate(Self.query(account) as CFDictionary, update as CFDictionary)
      if status == errSecItemNotFound {
        var add = Self.query(account)
        add[kSecValueData as String] = data
        add[kSecAttrLabel as String] = "Ardia: \(account)"
        status = SecItemAdd(add as CFDictionary, nil)
      } else if status != errSecSuccess {
        SecItemDelete(Self.query(account) as CFDictionary)
        var add = Self.query(account)
        add[kSecValueData as String] = data
        status = SecItemAdd(add as CFDictionary, nil)
      }
      return status == errSecSuccess
    }

    AsyncFunction("delete") { (account: String) -> Bool in
      if let store = IsolatedSecrets.shared { return store.set(account, nil) }
      let status = SecItemDelete(Self.query(account) as CFDictionary)
      return status == errSecSuccess || status == errSecItemNotFound
    }
  }

  private static func query(_ account: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }

  private static func migrationMarker() -> [String: Any]? {
    guard Bundle.main.object(forInfoDictionaryKey: "ACPersonalRoutingBuild") as? Bool == true,
      !LaunchConfig.shared.isolated,
      let text = DocumentStore.read("official-migration.json"), let data = text.data(using: .utf8),
      let marker = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      marker["source"] as? String == "com.ardia.browser" else { return nil }
    return marker
  }
}

private final class IsolatedSecrets {
  static let shared = LaunchConfig.shared.dataDirectory.map {
    IsolatedSecrets(URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent("Connected Accounts.json"))
  }

  private let url: URL
  private let lock = NSLock()

  private init(_ url: URL) { self.url = url }

  private func load() -> [String: String]? {
    guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode([String: String].self, from: data)
  }

  func get(_ account: String) -> String? {
    lock.lock()
    defer { lock.unlock() }
    return load()?[account]
  }

  func set(_ account: String, _ secret: String?) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard var secrets = load() else { return false }
    secrets[account] = secret
    do {
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(secrets).write(to: url, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
      return true
    } catch {
      return false
    }
  }
}
