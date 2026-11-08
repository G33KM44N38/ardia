import { useState } from "react";
import { View } from "react-native";
import { useProfiles } from "../../../state/browser/hooks";
import { approveAgent, revokeAgent, setAgentControl, useAgentControl, type AgentSession } from "../../../state/automation/agentControl";
import { Button, space, Text, Toggle } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";

export function AgentsSection() {
  const state = useAgentControl();
  return <>
    <SectionHeader anchor="advanced.agents" />
    <Group>
      <Row anchor="advanced.agents" description={state.reason ?? "Each connection needs your approval. Access ends after one hour, on disconnect, or when you stop agents. Command-line control must be off."}>
        <Toggle accessibilityLabel="Allow agent connections" value={state.enabled} onChange={value => void setAgentControl(value)} />
      </Row>
      {state.enabled && !state.sessions.length ? <View style={{ padding: space.l }}><Text size="small">Waiting for an agent. Connect with the ardia-fork-mcp helper, then approve it here.</Text></View> : null}
      {state.sessions.map(agent => <AgentRow key={`${agent.generation}:${agent.connection}`} agent={agent} />)}
    </Group>
  </>;
}

function AgentRow({ agent }: { agent: AgentSession }) {
  const profiles = useProfiles();
  const [selected, setSelected] = useState<string[]>([]);
  const [actions, setActions] = useState(false);
  const [scripts, setScripts] = useState(false);
  const [saving, setSaving] = useState(false);
  return <View style={{ padding: space.l, gap: space.m }}>
      <Text weight="semibold">{agent.name}</Text>
      <Text size="caption" tone="textSecondary">{agent.approved ? "Approved for this connection · expires after one hour" : "The agent supplies this name; it is not a verified application identity."}</Text>
      {agent.approved ? <Text size="small">{profiles.filter(p => agent.profiles.includes(p.id)).map(p => p.name).join(", ")}{agent.actions ? " · Actions" : " · Read only"}{agent.scripts ? " · Scripts" : ""}</Text> : <>
        {profiles.filter(p => !p.id.startsWith("incognito")).map(p => <View key={p.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.l }}>
          <Text size="small">{p.name}</Text>
          <Toggle accessibilityLabel={`Allow ${p.name}`} value={selected.includes(p.id)} onChange={on => setSelected(s => on ? [...s, p.id] : s.filter(id => id !== p.id))} />
        </View>)}
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text size="small">Allow actions</Text><Toggle accessibilityLabel="Allow agent actions" value={actions} onChange={setActions} /></View>
        <View style={{ gap: space.s }}><Text size="small">Allow page scripts</Text><Text size="caption" tone="textSecondary">Scripts can read and change approved pages, and leave work running after revocation.</Text>
          <Toggle accessibilityLabel="Allow agent scripts" value={actions && scripts} disabled={!actions} onChange={setScripts} />
        </View>
        <Button title={saving ? "Approving…" : "Approve connection"} disabled={!selected.length || saving} onPress={() => {
          setSaving(true); void approveAgent(agent.connection, selected, actions, scripts).finally(() => setSaving(false));
        }} />
      </>}
      <Button title={agent.approved ? "Revoke access" : "Reject connection"} disabled={saving} onPress={() => void revokeAgent(agent.connection)} />
  </View>;
}
