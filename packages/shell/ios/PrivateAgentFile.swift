import Darwin
import Foundation

final class PrivateAgentFile {
  private let directory: Int32
  private let lock: Int32
  private let name = "registry.json"
  private var previous: Data?
  private var loaded = false

  init(base: URL) throws {
    let root = Darwin.open(base.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard root >= 0 else { throw CocoaError(.fileReadNoPermission) }
    defer { Darwin.close(root) }
    var info = stat()
    guard fstat(root, &info) == 0, info.st_uid == geteuid(), info.st_mode & 0o022 == 0 else { throw CocoaError(.fileReadNoPermission) }
    guard mkdirat(root, "AgentAccess", 0o700) == 0 || errno == EEXIST else { throw CocoaError(.fileWriteNoPermission) }
    directory = openat(root, "AgentAccess", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard directory >= 0 else { throw CocoaError(.fileReadNoPermission) }
    guard fstat(directory, &info) == 0, info.st_uid == geteuid(), info.st_mode & 0o077 == 0 else {
      Darwin.close(directory)
      throw CocoaError(.fileReadNoPermission)
    }
    lock = openat(directory, "registry.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard lock >= 0, Self.safe(lock), flock(lock, LOCK_EX | LOCK_NB) == 0 else {
      if lock >= 0 { Darwin.close(lock) }
      Darwin.close(directory)
      throw CocoaError(.fileReadNoPermission)
    }
  }

  deinit {
    Darwin.close(lock)
    Darwin.close(directory)
  }

  private static func safe(_ fd: Int32) -> Bool {
    var info = stat()
    return fstat(fd, &info) == 0 && info.st_mode & S_IFMT == S_IFREG && info.st_uid == geteuid() && info.st_mode & 0o077 == 0 && info.st_nlink == 1
  }

  func read() throws -> Data? {
    let data = try readCurrent()
    previous = data
    loaded = true
    return data
  }

  private func readCurrent() throws -> Data? {
    let fd = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
    if fd < 0, errno == ENOENT { return nil }
    guard fd >= 0 else { throw CocoaError(.fileReadNoPermission) }
    defer { Darwin.close(fd) }
    guard Self.safe(fd) else { throw CocoaError(.fileReadNoPermission) }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while true {
      let count = Darwin.read(fd, &buffer, buffer.count)
      guard count >= 0 else { throw CocoaError(.fileReadUnknown) }
      if count == 0 { return data }
      data.append(contentsOf: buffer.prefix(count))
      guard data.count <= 262144 else { throw CocoaError(.fileReadTooLarge) }
    }
  }

  func validate() throws {
    var info = stat()
    guard fstat(directory, &info) == 0, info.st_uid == geteuid(), info.st_mode & 0o077 == 0, loaded, try readCurrent() == previous else { throw CocoaError(.fileReadCorruptFile) }
  }

  func write(_ data: Data) throws {
    guard data.count <= 262144 else { throw CocoaError(.fileWriteOutOfSpace) }
    guard loaded, try readCurrent() == previous else { throw CocoaError(.fileReadCorruptFile) }
    let temporary = UUID().uuidString + ".tmp"
    let fd = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard fd >= 0 else { throw CocoaError(.fileWriteNoPermission) }
    defer { Darwin.close(fd); unlinkat(directory, temporary, 0) }
    try data.withUnsafeBytes { bytes in
      var offset = 0
      while offset < bytes.count {
        let count = Darwin.write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
        guard count > 0 else { throw CocoaError(.fileWriteUnknown) }
        offset += count
      }
    }
    guard fsync(fd) == 0, renameat(directory, temporary, directory, name) == 0, fsync(directory) == 0 else { throw CocoaError(.fileWriteUnknown) }
    previous = data
  }
}
