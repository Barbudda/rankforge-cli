#!/usr/bin/env node
// Starts the RankForge MCP server (rankforge-cli) over stdio for this plugin.
// A tiny launcher instead of calling npx directly from .mcp.json: on native
// Windows, npx is a .cmd script that a plain spawn can't start, so the
// launcher picks the right form per platform. The version is pinned to the
// plugin's so an update to one is an update to both.
import { spawn } from "node:child_process";

const win = process.platform === "win32";
const child = spawn(win ? "npx.cmd" : "npx", ["-y", "rankforge-cli@0.3.0", "mcp"], {
  stdio: "inherit",
  // Node refuses to spawn .cmd files without a shell; the arguments are
  // constants, so there is nothing to inject.
  shell: win,
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
child.on("error", (err) => {
  process.stderr.write(`rankforge: could not start npx (${err.message}). Is Node.js 18+ installed?\n`);
  process.exit(1);
});
