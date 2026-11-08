import { useState } from "react";
import { officialMigration, importOfficialConnectedAccounts } from "../../../state/settings/paneData";
import { useResource } from "../../../state/settings/resources";
import { Button } from "../../ui";
import { Row } from "../Form";

export function OfficialMigrationRow() {
  const [status, reload] = useResource(officialMigration);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = async () => {
    setBusy(true);
    setError(null);
    try {
      await importOfficialConnectedAccounts();
      await reload();
    } catch {
      setError("Access was not granted. You can try again without changing the official browser.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row anchor="general.officialAccounts" description={error ?? (!status
      ? "Migrate your official browser data first, then import its connected accounts here."
      : status.pending
      ? "Copy your connected accounts from the official browser. Your Mac may ask for Keychain access."
      : `${status.imported} connected accounts imported. The official browser is unchanged.`)}>
      <Button title={busy ? "Importing…" : "Import Accounts"} disabled={busy || !status?.pending} onPress={() => void copy()} />
    </Row>
  );
}
