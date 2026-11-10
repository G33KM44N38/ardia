import AppKit
import Darwin
import Foundation

var checks = 0
func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
  precondition(condition(), message)
  checks += 1
}
func temporary(_ label: String) throws -> URL {
  let url = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent(label + UUID().uuidString)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  return url
}
func proof(_ identity: String = UUID().uuidString) -> [String: Any] {
  ["identity": identity, "credential": (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined(), "name": "Same untrusted name"]
}
func approve(_ authority: AgentAuthorization, _ connection: Int, remember: Bool = true, actions: Bool = false, scripts: Bool = false) -> Bool {
  authority.approve(connection, revision: authority.session(connection)?["authorization"] as? String ?? "", profiles: ["default": "", "work": "native-work"], actions: actions, scripts: scripts, remember: remember)
}
func allows(_ authority: AgentAuthorization, _ connection: Int, _ operation: String = "snapshot", profile: String = "work", nativeProfile: String = "native-work") -> Bool {
  authority.allows(connection, revision: authority.current(connection)?.revision ?? "", profile: profile, nativeProfile: nativeProfile, operation: operation)
}

let base = try temporary("authority-")
let client = proof()
var authority: AgentAuthorization? = AgentAuthorization(base: base)
expect(authority!.connect(1, params: client), "Unknown identity may request approval")
expect(authority!.current(1) == nil, "Unknown identity has no access")
expect(approve(authority!, 1), "Explicit remembered approval")
expect(allows(authority!, 1), "Exact profile read scope")
expect(!allows(authority!, 1, "click"), "Read permission excludes actions")
expect(!allows(authority!, 1, "script"), "Read permission excludes scripts")
expect(!allows(authority!, 1, profile: "secret"), "Other stable IDs excluded")
expect(!allows(authority!, 1, nativeProfile: "replacement"), "Recreated native identity excluded")
expect(!allows(authority!, 1, "unknown"), "Unknown operations excluded")
expect(authority!.connect(2, params: client) && allows(authority!, 2), "Second socket authenticates same identity")
let stranger = proof()
expect(authority!.connect(3, params: stranger) && authority!.current(3) == nil, "Same display name never authenticates")
var bad = proof(client["identity"] as! String)
expect(!authority!.connect(4, params: bad), "Bad proof denied without approval request")
expect(authority!.session(4) == nil, "Bad proof never appears for approval")
let registry = base.appendingPathComponent("AgentAccess/registry.json")
let saved = try String(contentsOf: registry, encoding: .utf8)
expect(!saved.contains(client["credential"] as! String), "Registry stores no bearer credential")
expect(!String(describing: authority!.session(1)!).contains(client["credential"] as! String), "Renderer metadata has no credential")
authority!.disconnect(1)
expect(authority!.current(1) == nil && allows(authority!, 2), "Disconnect drops only socket binding")
authority = nil
authority = AgentAuthorization(base: base)
expect(authority!.status["enabled"] as? Bool == true, "Remembered approval explicitly restores enabled preference")
expect(authority!.connect(5, params: client) && allows(authority!, 5), "Restart restores exact remembered scope")
expect(authority!.connect(6, params: client) && allows(authority!, 6), "Multiple active sockets")
expect(authority!.revoke(identity: client["identity"] as? String), "Identity revocation saved")
expect(authority!.current(5) == nil && authority!.current(6) == nil, "Revocation invalidates every socket")
expect(!authority!.connect(5, params: client), "Revoked active socket cannot re-request")
expect(authority!.connect(7, params: client) && authority!.current(7) == nil, "Reconnect after revoke requires voluntary approval")
let pendingRevision = authority!.session(7)!["authorization"] as! String
expect(authority!.revoke(connection: 7), "Reject pending approval")
expect(!authority!.approve(7, revision: pendingRevision, profiles: ["default": ""], actions: true, scripts: true, remember: true), "Delayed approval cannot resurrect revoked identity")
authority = nil
authority = AgentAuthorization(base: base)
expect(authority!.connect(8, params: client) && authority!.current(8) == nil, "Restart after revocation denies old credential")
authority!.disconnect(8)
expect(!approve(authority!, 8), "Disconnect before approval denies delayed callback")
expect(authority!.connect(9, params: proof()), "Temporary client pending")
expect(approve(authority!, 9, remember: false, actions: true, scripts: false), "Temporary approval works")
expect(allows(authority!, 9, "open_tab") && !allows(authority!, 9, "script"), "Actions exclude scripts")
authority!.stop()
expect(authority!.current(9) == nil, "Stop clears temporary grants")
let privateClient = proof()
expect(authority!.connect(10, params: privateClient), "Private scope pending")
expect(!authority!.approve(10, revision: authority!.session(10)!["authorization"] as! String, profiles: ["incognito-private": "incognito@"], actions: true, scripts: true, remember: true), "Incognito excluded natively")
expect(authority!.connect(11, params: proof()), "Script client pending")
expect(approve(authority!, 11, actions: true, scripts: true) && allows(authority!, 11, "script"), "Explicit script scope")
expect(authority!.setEnabled(false), "Explicit disable saved")
authority = nil
authority = AgentAuthorization(base: base)
expect(authority!.status["enabled"] as? Bool == false, "Explicit disable survives restart")
authority = nil
let corrupt = try temporary("corrupt-")
var corruptAuthority: AgentAuthorization? = AgentAuthorization(base: corrupt)
corruptAuthority = nil
let corruptFile = corrupt.appendingPathComponent("AgentAccess/registry.json")
try Data("broken".utf8).write(to: corruptFile)
chmod(corruptFile.path, 0o600)
corruptAuthority = AgentAuthorization(base: corrupt)
expect(corruptAuthority!.failed && !corruptAuthority!.connect(1, params: proof()), "Corrupt registry fails closed")
let corruptContents = try String(contentsOf: corruptFile, encoding: .utf8)
expect(corruptContents == "broken", "Corrupt registry remains untouched")
let tampered = try temporary("changed-")
let tamperedAuthority = AgentAuthorization(base: tampered)
expect(tamperedAuthority.connect(1, params: proof()), "Storage failure pending")
let tamperedFile = tampered.appendingPathComponent("AgentAccess/registry.json")
try Data("external corruption".utf8).write(to: tamperedFile)
chmod(tamperedFile.path, 0o600)
expect(!approve(tamperedAuthority, 1) && tamperedAuthority.failed && tamperedAuthority.current(1) == nil, "Changed storage aborts approval and blocks access")
let tamperedContents = try String(contentsOf: tamperedFile, encoding: .utf8)
expect(tamperedContents == "external corruption", "Failed write does not replace external data")
let live = try temporary("live-corrupt-")
let liveAuthority = AgentAuthorization(base: live)
let liveProof = proof()
expect(liveAuthority.connect(1, params: liveProof) && approve(liveAuthority, 1), "Live-corruption fixture approved")
try Data("broken".utf8).write(to: live.appendingPathComponent("AgentAccess/registry.json"))
expect(!allows(liveAuthority, 1), "Live corruption invalidates existing authority")
expect(!liveAuthority.connect(2, params: liveProof), "Live corruption denies reconnect")
let oversized = try temporary("oversized-")
let oversizedFile = try PrivateAgentFile(base: oversized)
_ = try oversizedFile.read()
try oversizedFile.write(Data("valid".utf8))
var refusedOversize = false
do { try oversizedFile.write(Data(repeating: 65, count: 262145)) } catch { refusedOversize = true }
expect(refusedOversize, "Oversized registry write refused")
let preservedRegistry = try String(contentsOf: oversized.appendingPathComponent("AgentAccess/registry.json"), encoding: .utf8)
expect(preservedRegistry == "valid", "Oversized write preserves valid registry")
let unsafe = try temporary("unsafe-")
try FileManager.default.createSymbolicLink(atPath: unsafe.appendingPathComponent("AgentAccess").path, withDestinationPath: base.appendingPathComponent("AgentAccess").path)
expect(AgentAuthorization(base: unsafe).failed, "Symlink directory refused")
let publicBase = try temporary("public-")
try FileManager.default.createDirectory(at: publicBase.appendingPathComponent("AgentAccess"), withIntermediateDirectories: false, attributes: [.posixPermissions: 0o755])
expect(AgentAuthorization(base: publicBase).failed, "Public directory refused")
let symlinkFileBase = try temporary("symlink-file-")
var symlinkFileAuthority: AgentAuthorization? = AgentAuthorization(base: symlinkFileBase)
symlinkFileAuthority = nil
try FileManager.default.createSymbolicLink(atPath: symlinkFileBase.appendingPathComponent("AgentAccess/registry.json").path, withDestinationPath: registry.path)
expect(AgentAuthorization(base: symlinkFileBase).failed, "Symlink registry refused")
let publicFileBase = try temporary("public-file-")
var publicFileAuthority: AgentAuthorization? = AgentAuthorization(base: publicFileBase)
expect(publicFileAuthority!.connect(1, params: proof()) && approve(publicFileAuthority!, 1), "Public-file fixture saved")
publicFileAuthority = nil
chmod(publicFileBase.appendingPathComponent("AgentAccess/registry.json").path, 0o644)
expect(AgentAuthorization(base: publicFileBase).failed, "Public registry refused")
let exclusiveBase = try temporary("exclusive-")
let exclusiveAuthority = AgentAuthorization(base: exclusiveBase)
expect(!exclusiveAuthority.failed && AgentAuthorization(base: exclusiveBase).failed, "Second writer refused while registry is owned")
print("Native authority checks passed: \(checks)")

enum DocumentStore {
  static var base = URL(fileURLWithPath: CommandLine.arguments[1])
  static func url(_ name: String) throws -> URL { base.appendingPathComponent(name) }
}

final class SocketEvents {
  private let lock = NSLock()
  private let ready = DispatchSemaphore(value: 0)
  private var requests: [[String: Any]] = []
  func receive(_ name: String, _ body: [String: Any]) {
    guard name == "onRequest" else { return }
    lock.lock()
    requests.append(body)
    lock.unlock()
    ready.signal()
  }
  func next() -> [String: Any] {
    expect(ready.wait(timeout: .now() + 5) == .success, "Native request forwarded before deadline")
    lock.lock()
    defer { lock.unlock() }
    return requests.removeFirst()
  }
}

func socketCall<T>(_ perform: (@escaping (T) -> Void) -> Void) -> T {
  let ready = DispatchSemaphore(value: 0)
  var result: T?
  perform { result = $0; ready.signal() }
  expect(ready.wait(timeout: .now() + 5) == .success, "Socket callback before deadline")
  return result!
}
func connectSocket(_ path: String) -> Int32 {
  let fd = socket(AF_UNIX, SOCK_STREAM, 0)
  var address = sockaddr_un()
  address.sun_family = sa_family_t(AF_UNIX)
  address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
  withUnsafeMutableBytes(of: &address.sun_path) { raw in
    raw.copyBytes(from: Array(path.utf8)); raw[path.utf8.count] = 0
  }
  let result = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
  expect(result == 0, "Socket connected")
  var timeout = timeval(tv_sec: 5, tv_usec: 0)
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
  return fd
}
func send(_ fd: Int32, _ id: Int, _ method: String, _ params: [String: Any]) {
  var data = try! JSONSerialization.data(withJSONObject: ["id": id, "method": method, "params": params])
  data.append(10)
  let count = data.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, $0.count) }
  expect(count == data.count, "Complete socket request written")
}
func response(_ fd: Int32) -> [String: Any] {
  var data = Data()
  var byte: UInt8 = 0
  while data.count < 65536 {
    precondition(Darwin.read(fd, &byte, 1) == 1, "Socket response before deadline")
    if byte == 10 { return try! JSONSerialization.jsonObject(with: data) as! [String: Any] }
    data.append(byte)
  }
  preconditionFailure("Oversized response")
}

DocumentStore.base = try temporary("socket-")
let events = SocketEvents()
let owner = NSObject()
let server = ControlSocket(socketName: "ArdiaAgents.sock")
server.attach(owner, send: events.receive)
server.globalControlChanged("off")
let socketStatus: [String: Any] = socketCall { server.start($0) }
expect(socketStatus["state"] as? String == "on", "Native socket starts with safe storage")
let first = connectSocket(socketStatus["path"] as! String)
let wireProof = proof()
send(first, 1, "connect", wireProof)
let firstEvent = events.next()
expect(!(firstEvent["line"] as! String).contains(wireProof["credential"] as! String), "Credential stripped at native boundary")
let firstConnection = firstEvent["connection"] as! Int
let socketGeneration = firstEvent["generation"] as! Int
let pending = firstEvent["authorization"] as! String
send(first, 2, "list_tabs", [:])
expect(response(first)["error"] != nil, "Request queued before approval refused natively")
let approved: Bool = socketCall { server.grantAgent(firstConnection, generation: socketGeneration, revision: pending, profiles: ["default": ""], actions: true, scripts: false, remember: true, done: $0) }
expect(approved, "Socket approval saved")
let second = connectSocket(socketStatus["path"] as! String)
send(second, 3, "connect", wireProof)
let secondEvent = events.next()
let secondConnection = secondEvent["connection"] as! Int
let approvedRevision = secondEvent["authorization"] as! String
let nativeSession: [String: Any]? = socketCall { server.agentAccess(secondConnection, generation: socketGeneration, revision: approvedRevision, profile: "default", nativeProfile: "", operation: "list_tabs", done: $0) }
expect(nativeSession?["approved"] as? Bool == true, "Second socket restores native grant")
let revoked: Bool = socketCall { server.revokeAgent(firstConnection, identity: wireProof["identity"] as! String, done: $0) }
expect(revoked, "Socket identity-wide revoke persists")
var ended: UInt8 = 0
expect(Darwin.read(first, &ended, 1) == 0, "First active socket closed after revoke")
expect(Darwin.read(second, &ended, 1) == 0, "Second active socket closed after revoke")
let staleGrant: Bool = socketCall { server.grantAgent(firstConnection, generation: socketGeneration, revision: pending, profiles: ["default": ""], actions: true, scripts: true, remember: true, done: $0) }
expect(!staleGrant, "Delayed native approval cannot restore access")
let staleGeneration: [String: Any]? = socketCall { server.agentAccess(secondConnection, generation: socketGeneration - 1, revision: approvedRevision, profile: "default", nativeProfile: "", operation: "list_tabs", done: $0) }
expect(staleGeneration == nil, "Old socket generation refused")
Darwin.close(first)
Darwin.close(second)
let globalClient = connectSocket(socketStatus["path"] as! String)
send(globalClient, 6, "connect", proof())
let globalEvent = events.next()
server.globalControlChanged("on")
expect(Darwin.read(globalClient, &ended, 1) == 0, "Global activation closes pending scoped sockets")
let lateGlobalApproval: Bool = socketCall { server.grantAgent(globalEvent["connection"] as! Int, generation: socketGeneration, revision: globalEvent["authorization"] as! String, profiles: ["default": ""], actions: true, scripts: true, remember: true, done: $0) }
expect(!lateGlobalApproval, "Global activation blocks delayed approval")
Darwin.close(globalClient)
let globallyBlocked: [String: Any] = socketCall { server.start($0) }
expect(globallyBlocked["state"] as? String == "off", "Global control refuses scoped socket start")
let stopped: Bool = socketCall { callback in server.stop { callback(true) } }
expect(stopped, "Test socket stopped")
print("Native authority and socket checks passed: \(checks)")
