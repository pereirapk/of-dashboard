import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const CAPTURES_DIR = resolve(process.cwd(), "scripts/mcp-discovery/captures");

export async function capture(
  name: string,
  payload: unknown
): Promise<string> {
  await mkdir(CAPTURES_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}__${name}.json`;
  const fullPath = resolve(CAPTURES_DIR, filename);
  await writeFile(fullPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`captured → ${fullPath}`);
  return fullPath;
}
