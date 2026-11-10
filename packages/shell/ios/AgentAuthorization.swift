import CryptoKit
import Foundation

final class AgentAuthorization {
  struct Grant: Codable {
    let identity: String
    let digest: String
    let name: String
    let profiles: [String: String]
    let actions: Bool
    let scripts: Bool
    let revision: String
    let expires: Double

    var display: [String: Any] {
      ["identity": identity, "name": name, "profiles": Array(profiles.keys).sorted(), "actions": actions, "scripts": scripts, "authorization": revision, "expires": expires * 1000, "remembered": expires == 0]
    }
  }

  private struct Registry: Codable {
    var version = 1
    var enabled = false
    var grants: [String: Grant] = [:]
  }

  private struct Binding {
    let identity: String
    let digest: String
    let name: String
    let revision: String
    var grant: Grant?
  }

  private var registry = Registry()
  private var bindings: [Int: Binding] = [:]
  private var denied = Set<Int>()
  private var file: PrivateAgentFile?
  private(set) var failed = false

  init(base: URL) {
    do {
      file = try PrivateAgentFile(base: base)
      if let data = try file?.read() {
        registry = try JSONDecoder().decode(Registry.self, from: data)
        guard registry.version == 1, registry.grants.count <= 128, registry.grants.allSatisfy({ key, grant in
          key == grant.identity && UUID(uuidString: key) != nil && grant.digest.count == 64 && grant.digest.allSatisfy({ $0.isASCII && $0.isHexDigit }) &&
            !grant.profiles.isEmpty && grant.profiles.count <= 128 && grant.profiles.allSatisfy({ !$0.key.hasPrefix("incognito") && !$0.value.hasPrefix("incognito") }) &&
            grant.expires == 0 && (!grant.scripts || grant.actions) && UUID(uuidString: grant.revision) != nil
        }) else { throw CocoaError(.fileReadCorruptFile) }
      }
    } catch { failed = true }
  }

  private func validate() -> Bool {
    guard !failed, let file else { return false }
    do { try file.validate(); return true } catch {
      failed = true
      bindings.removeAll()
      return false
    }
  }

  var status: [String: Any] {
    _ = validate()
    return ["enabled": !failed && registry.enabled, "remembered": failed ? [] : registry.grants.values.map(\.display), "storageFailed": failed]
  }

  private func save(_ next: Registry) -> Bool {
    guard validate(), let file else { return false }
    do {
      try file.write(JSONEncoder().encode(next))
      registry = next
      return true
    } catch {
      failed = true
      bindings.removeAll()
      return false
    }
  }

  func setEnabled(_ enabled: Bool) -> Bool {
    guard validate() else { return false }
    if registry.enabled == enabled || registry.grants.isEmpty && !registry.enabled { return true }
    var next = registry
    next.enabled = enabled
    return save(next)
  }

  func connect(_ connection: Int, params: [String: Any]) -> Bool {
    guard validate(), !denied.contains(connection) else { return false }
    let name = Self.name(params["name"])
    let identity = params["identity"] as? String ?? ""
    let credential = params["credential"] as? String ?? ""
    let hasProof = !identity.isEmpty || !credential.isEmpty
    guard !hasProof || UUID(uuidString: identity) != nil && credential.count == 64 && credential.allSatisfy({ $0.isASCII && $0.isHexDigit }) else { return false }
    let digest = hasProof ? SHA256.hash(data: Data(credential.utf8)).map { String(format: "%02x", $0) }.joined() : ""
    if let existing = bindings[connection] { return existing.identity == identity && Self.equal(existing.digest, digest) }
    if let known = registry.grants[identity] {
      guard Self.equal(known.digest, digest) else { denied.insert(connection); return false }
      bindings[connection] = Binding(identity: identity, digest: digest, name: known.name, revision: known.revision, grant: known)
    } else {
      bindings[connection] = Binding(identity: identity, digest: digest, name: name, revision: UUID().uuidString, grant: nil)
    }
    return true
  }

  static func name(_ value: Any?) -> String {
    let raw = value as? String ?? "Agent"
    let clean = raw.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && !(0x200b...0x200f).contains($0.value) && !(0x202a...0x202e).contains($0.value) && !(0x2060...0x206f).contains($0.value) }
    let name = String(String.UnicodeScalarView(clean)).prefix(60).trimmingCharacters(in: .whitespacesAndNewlines)
    return name.isEmpty ? "Agent" : name
  }

  private static func equal(_ a: String, _ b: String) -> Bool {
    let a = Array(a.utf8), b = Array(b.utf8)
    guard a.count == b.count else { return false }
    return zip(a, b).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
  }

  func session(_ connection: Int) -> [String: Any]? {
    guard validate(), let binding = bindings[connection], !denied.contains(connection) else { return nil }
    if let grant = current(connection) { return grant.display.merging(["approved": true]) { _, new in new } }
    return ["identity": binding.identity, "name": binding.name, "authorization": binding.revision, "approved": false, "profiles": [], "actions": false, "scripts": false, "expires": 0, "remembered": false, "canRemember": !binding.identity.isEmpty]
  }

  func approve(_ connection: Int, revision: String, profiles: [String: String], actions: Bool, scripts: Bool, remember: Bool) -> Bool {
    guard validate(), !denied.contains(connection), var binding = bindings[connection], binding.revision == revision, binding.grant == nil,
      !profiles.isEmpty, profiles.count <= 128, profiles.allSatisfy({ !$0.key.hasPrefix("incognito") && !$0.value.hasPrefix("incognito") }),
      !remember || !binding.identity.isEmpty && registry.grants.count < 128 else { return false }
    let grant = Grant(identity: binding.identity, digest: binding.digest, name: binding.name, profiles: profiles, actions: actions, scripts: actions && scripts, revision: UUID().uuidString, expires: remember ? 0 : Date().timeIntervalSince1970 + 3600)
    if remember {
      var next = registry
      next.enabled = true
      next.grants[grant.identity] = grant
      guard save(next) else { return false }
    }
    binding.grant = grant
    bindings[connection] = binding
    if remember {
      for (id, other) in bindings where other.identity == grant.identity {
        guard Self.equal(other.digest, grant.digest) else { denied.insert(id); continue }
        bindings[id] = Binding(identity: other.identity, digest: other.digest, name: grant.name, revision: grant.revision, grant: grant)
      }
    }
    return true
  }

  func current(_ connection: Int) -> Grant? {
    guard validate(), !denied.contains(connection), let binding = bindings[connection], let grant = binding.grant else { return nil }
    if grant.expires > 0 { return grant.expires > Date().timeIntervalSince1970 ? grant : nil }
    guard let saved = registry.grants[binding.identity], saved.revision == grant.revision else { return nil }
    return saved
  }

  func allows(_ connection: Int, revision: String, profile: String, nativeProfile: String, operation: String) -> Bool {
    guard let grant = current(connection), grant.revision == revision, grant.profiles[profile] == nativeProfile else { return false }
    if ["snapshot", "screenshot", "list_profiles", "list_tabs"].contains(operation) { return true }
    if operation == "script" { return grant.actions && grant.scripts }
    return ["open_tab", "close_tab", "click", "fill", "press_key", "scroll", "navigate"].contains(operation) && grant.actions
  }

  @discardableResult
  func revoke(connection: Int? = nil, identity: String? = nil) -> Bool {
    let identity = identity ?? connection.flatMap { bindings[$0]?.identity }
    for (id, binding) in bindings where id == connection || identity?.isEmpty == false && binding.identity == identity {
      bindings.removeValue(forKey: id)
      denied.insert(id)
    }
    guard let identity, registry.grants[identity] != nil else { return !failed }
    var next = registry
    next.grants.removeValue(forKey: identity)
    return save(next)
  }

  func disconnect(_ connection: Int) { bindings.removeValue(forKey: connection); denied.remove(connection) }
  func stop() { bindings.removeAll(); denied.removeAll() }
}
