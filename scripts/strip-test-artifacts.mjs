import * as fs from "node:fs";
import * as path from "node:path";

/** Remove compiled test artifacts so they are not published to ClawHub. */
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (/\.test\.(js|d\.ts|js\.map|d\.ts\.map)$/.test(entry.name)) {
      fs.unlinkSync(full);
    }
  }
}

walk(path.join(process.cwd(), "dist"));
