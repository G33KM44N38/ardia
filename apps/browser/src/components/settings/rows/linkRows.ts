import type { SettingSection } from "./types";
import type { SettingsPane } from "../../../state/settings/settingsWindows";

export const linkRows = {
  links: [
    {
      section: "Air Traffic Control",
      rows: {
        routes: {
          title: "Routes",
          description: "Choose where specific sites open. The first route that matches wins.",
          keywords: ["air traffic control", "atc", "route", "routes", "rules", "link routing", "open in", "contains", "is equal to", "new route", "spaces", "tab group"],
        },
      },
    },
    {
      section: "Links from other apps",
      rows: {
        otherApps: {
          title: "Open links from other apps in",
          description: "Where a link from Discord, Slack or Mail opens when no route matches it.",
          keywords: ["default", "little ardia", "external links", "most recent", "discord", "slack", "mail"],
        },
      },
    },
  ],
} satisfies Partial<Record<SettingsPane, SettingSection[]>>;
