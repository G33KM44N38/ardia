import ArdiaCore
import ExpoModulesCore
import Foundation

public class AutomationModule: Module {
  private static var observingControl = false
  public func definition() -> ModuleDefinition {
    Name("ArdiaAutomation")

    Events("onRequest", "onClose", "onWritten", "onAgentRequest", "onAgentClose", "onAgentWritten")

    OnCreate {
      DispatchQueue.main.async {
        if !Self.observingControl {
          Self.observingControl = true
          ArdiaEngineBridge.observe("cliControl") { status in
            ControlSocket.agents.globalControlChanged(status["state"] as? String ?? "unavailable")
          }
        }
      }
      ControlSocket.agents.attach(self) { [weak self] name, body in
        self?.sendEvent(name.replacingOccurrences(of: "on", with: "onAgent", options: .anchored), body)
      }
      ControlSocket.shared.attach(self) { [weak self] name, body in self?.sendEvent(name, body) }
    }

    AsyncFunction("start") { (promise: Promise) in
      ControlSocket.shared.start { promise.resolve($0) }
    }

    AsyncFunction("stop") { (promise: Promise) in
      ControlSocket.shared.stop { promise.resolve(nil) }
    }

    Function("reply") { (connection: Int, line: String, ticket: Int) in
      ControlSocket.shared.reply(connection, line, ticket: ticket)
    }

    Function("broadcast") { (connections: [Int], line: String) in
      ControlSocket.shared.broadcast(connections, line)
    }

    AsyncFunction("startAgents") { (promise: Promise) in
      DispatchQueue.main.async {
        ArdiaServices.call("ac_cli_control", profile: "", args: [:]) { status in
          ControlSocket.agents.globalControlChanged(status["state"] as? String ?? "unavailable")
          ControlSocket.agents.start { promise.resolve($0) }
        }
      }
    }
    AsyncFunction("stopAgents") { (preservePreference: Bool, promise: Promise) in
      ControlSocket.agents.stop(preservePreference: preservePreference) { promise.resolve(nil) }
    }
    Function("replyAgent") { (connection: Int, line: String) in
      ControlSocket.agents.reply(connection, line, ticket: 0)
    }
    AsyncFunction("agentStatus") { (promise: Promise) in
      ControlSocket.agents.agentStatus { promise.resolve($0) }
    }
    AsyncFunction("agentAccess") { (connection: Int, generation: Int, revision: String, profile: String, nativeProfile: String, operation: String, promise: Promise) in
      DispatchQueue.main.async {
        ArdiaServices.call("ac_cli_control", profile: "", args: [:]) { status in
          guard status["state"] as? String == "off", !ArdiaHost.isPrivateProfile(nativeProfile) else { promise.resolve(nil); return }
          ControlSocket.agents.agentAccess(connection, generation: generation, revision: revision, profile: profile, nativeProfile: nativeProfile, operation: operation) { promise.resolve($0) }
        }
      }
    }
    AsyncFunction("grantAgent") { (connection: Int, generation: Int, revision: String, profiles: [String: String], actions: Bool, scripts: Bool, remember: Bool, promise: Promise) in
      DispatchQueue.main.async {
        ArdiaServices.call("ac_cli_control", profile: "", args: [:]) { status in
          guard status["state"] as? String == "off", profiles.values.allSatisfy({ !ArdiaHost.isPrivateProfile($0) }) else { promise.resolve(false); return }
          ControlSocket.agents.grantAgent(connection, generation: generation, revision: revision, profiles: profiles, actions: actions, scripts: scripts, remember: remember) { promise.resolve($0) }
        }
      }
    }
    AsyncFunction("revokeAgent") { (connection: Int, identity: String, promise: Promise) in
      ControlSocket.agents.revokeAgent(connection, identity: identity) { promise.resolve($0) }
    }

    OnDestroy {
      ControlSocket.agents.detach(self)
      ControlSocket.shared.detach(self)
    }
  }
}
