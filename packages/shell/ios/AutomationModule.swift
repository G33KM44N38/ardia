import ExpoModulesCore
import Foundation

public class AutomationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaAutomation")

    Events("onRequest", "onClose", "onWritten", "onAgentRequest", "onAgentClose", "onAgentWritten")

    OnCreate {
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
      ControlSocket.agents.start { promise.resolve($0) }
    }
    AsyncFunction("stopAgents") { (promise: Promise) in
      ControlSocket.agents.stop { promise.resolve(nil) }
    }
    Function("replyAgent") { (connection: Int, line: String) in
      ControlSocket.agents.reply(connection, line, ticket: 0)
    }
    AsyncFunction("grantAgent") { (connection: Int, generation: Int, profiles: [String], actions: Bool, scripts: Bool, promise: Promise) in
      ControlSocket.agents.grantAgent(connection, generation: generation, profiles: profiles, actions: actions, scripts: scripts) { promise.resolve($0) }
    }
    AsyncFunction("revokeAgent") { (connection: Int, promise: Promise) in
      ControlSocket.agents.revokeAgent(connection) { promise.resolve(nil) }
    }

    OnDestroy {
      ControlSocket.agents.detach(self)
      ControlSocket.shared.detach(self)
    }
  }
}
