export const WEB_STORE_ID = /^[a-p]{32}(?![\s\S])/;

export function configExtensions(doc: Record<string, unknown>, problems: string[]): string[] | undefined {
  if (!Object.hasOwn(doc, "extensions")) return [];
  if (!Array.isArray(doc.extensions)) {
    problems.push("config.json: extensions must be a list of Chrome Web Store IDs");
    return undefined;
  }
  const ids: string[] = [];
  for (const [index, id] of doc.extensions.entries()) {
    if (typeof id !== "string" || !WEB_STORE_ID.test(id)) {
      problems.push(`config.json: extensions[${index}] must be a Chrome Web Store ID (32 lowercase letters a-p)`);
      return undefined;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
