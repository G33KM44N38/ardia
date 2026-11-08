import { onAppEvent, type AppEvent } from "../../platform/app";
import { capture } from "./client";

export type PasteRefusedEvent = Extract<AppEvent, { type: "pasteRefused" }>;

const REASONS = new Set([
  "deadline",
  "cancelled",
  "superseded",
  "stale_epoch",
  "queue_full",
  "no_origin",
  "late_acknowledgement",
  "focus_lost",
  "mouse_down",
  "window_left",
  "no_text",
  "deferred",
  "refused",
]);

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const TYPE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ /+-]{0,79}$/;
const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,79}$/;
const DYNAMIC_TYPE = /^dyn\./;
const MAX_TYPES = 24;
const MAX_DROPPED = 1000;

function identifier(value: unknown, pattern = IDENTIFIER): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function typeIds(types: unknown): string | null {
  if (!Array.isArray(types)) return null;
  const names = types.flatMap((type) => {
    const name = identifier(type, TYPE_NAME);
    return name ? [DYNAMIC_TYPE.test(name) ? "dyn" : name] : [];
  });
  return [...new Set(names)].slice(0, MAX_TYPES).join(",");
}

export function watchPasteRefused() {
  onAppEvent((e) => {
    if (e.type === "pasteRefused") capturePasteRefused(e);
  });
}

function capturePasteRefused(e: PasteRefusedEvent) {
  const ids = typeIds(e.types);
  const layout = identifier(e.layout);
  const responder = identifier(e.responder, CLASS_NAME);
  const raw: Record<string, unknown> = {};
  if (ids !== null) raw.type_ids = ids;
  if (layout) raw.keyboard_layout = layout;
  if (responder) raw.responder = responder;
  capture(
    "paste_refused",
    {
      reason: REASONS.has(e.reason) ? e.reason : "unknown",
      gate_open: e.gateOpen === true,
      ...(Number.isSafeInteger(e.dropped) && e.dropped! >= 0 ? { dropped: Math.min(e.dropped!, MAX_DROPPED) } : {}),
      ...(typeof e.edit === "boolean" ? { edit: e.edit } : {}),
    },
    { raw },
  );
}
