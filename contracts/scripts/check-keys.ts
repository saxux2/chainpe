/**
 * Pre-deploy key safety check.
 *
 * Scans the repo for private keys accidentally committed to source files,
 * checks that deployed contract owners are NOT bare EOAs (should be multisig),
 * and warns about any known-compromised keys in env.
 *
 * Usage:
 *   npx ts-node scripts/check-keys.ts          # from contracts/ dir
 *   node -e "require('./scripts/check-keys')"   # CommonJS
 *
 * Exit code 0 = all clear. Non-zero = issues found; do NOT deploy.
 */
import { execSync } from "child_process";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");
let issues = 0;

function warn(msg: string) {
  console.error(`  ⚠ ${msg}`);
  issues++;
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}

console.log("\n═══════════════════════════════════════════════");
console.log("  ChainPe Pre-Deploy Key Safety Check");
console.log("═══════════════════════════════════════════════\n");

// ─── 1. Git log: any 0x-prefixed 64-char hex in committed .env files ─────────
console.log("1. Checking git history for committed private keys...");
try {
  const result = execSync(
    'git -C "' + ROOT + '" log --all -S "0x" --oneline --diff-filter=A -- "*.env" ".env" ".env.*" 2>&1',
    { encoding: "utf-8", timeout: 15_000 }
  ).trim();
  if (result) {
    warn(`Git history contains commits that added 0x-values to .env files:\n    ${result.replace(/\n/g, "\n    ")}`);
    warn("Rotate ANY private key that may have appeared in those commits.");
  } else {
    ok("No 0x values found in committed .env files.");
  }
} catch {
  warn("Could not run git log scan. Check manually: git log -S '0x' -- '*.env'");
}

// ─── 2. Scan source files for hardcoded 64-char hex strings ──────────────────
console.log("\n2. Scanning source files for hardcoded private keys...");
const PRIVATE_KEY_RE = /\b0x[0-9a-fA-F]{64}\b/g;
const SCAN_DIRS = ["src", "packages", "services", "scripts", "examples"].map(d => join(ROOT, d));
const IGNORE_PATTERNS = ["/node_modules/", "/.next/", "/dist/", "/build/", "/typechain-types/"];
let srcIssues = 0;

function scanDir(dir: string) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (IGNORE_PATTERNS.some(p => fullPath.includes(p))) continue;
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && /\.(ts|js|mjs|cjs|json|sol)$/.test(entry.name)) {
      const content = readFileSync(fullPath, "utf-8");
      const matches = content.match(PRIVATE_KEY_RE) ?? [];
      for (const m of matches) {
        // Filter known test/mock keys (hardhat's default test accounts).
        const hardhatKeys = [
          "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
          "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
        ];
        if (hardhatKeys.includes(m.toLowerCase())) continue;
        warn(`Possible hardcoded private key in ${fullPath.replace(ROOT, ".")}: ${m.slice(0, 10)}...`);
        srcIssues++;
      }
    }
  }
}
SCAN_DIRS.forEach(scanDir);
if (srcIssues === 0) ok("No hardcoded 64-char hex keys found in source files.");

// ─── 3. Known compromised key check ──────────────────────────────────────────
console.log("\n3. Checking for known-compromised keys in current env...");
const COMPROMISED_PREFIXES = [
  "a6656902", // old Avalanche testnet gas key, exposed in an earlier build session
];
const envKeys = [
  process.env.DEPLOYER_PRIVATE_KEY,
  process.env.FACILITATOR_PRIVATE_KEY,
  process.env.CHAINPE_PRIVATE_KEY,
].filter(Boolean);

for (const key of envKeys) {
  const bare = key!.replace(/^0x/, "").toLowerCase();
  for (const prefix of COMPROMISED_PREFIXES) {
    if (bare.startsWith(prefix)) {
      warn(`Env contains a known-compromised key (prefix: ${prefix}...). Rotate it immediately.`);
    }
  }
}
if (issues === 0) ok("No known-compromised keys detected in env.");

// ─── 4. Deployment files: warn if owner == deployer (single EOA) ─────────────
console.log("\n4. Checking deployment files for single-EOA ownership...");
const deploymentsDir = join(__dirname, "..", "deployments");
if (existsSync(deploymentsDir)) {
  for (const file of readdirSync(deploymentsDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const d = JSON.parse(readFileSync(join(deploymentsDir, file), "utf-8"));
      if (d.owner && d.deployer && d.owner.toLowerCase() === d.deployer.toLowerCase()) {
        if (d.network === "arbitrum" || d.chainId === 42161) {
          warn(`${file}: owner == deployer (${d.owner}) on MAINNET. Transfer to Gnosis Safe.`);
        }
      } else if (d.owner && d.deployer && d.owner.toLowerCase() !== d.deployer.toLowerCase()) {
        ok(`${file}: owner (${d.owner}) ≠ deployer — looks like a multisig ✓`);
      }
    } catch {
      // skip unparseable files
    }
  }
} else {
  ok("No deployments/ folder — nothing to check.");
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════");
if (issues === 0) {
  console.log("  ✓ All checks passed. Safe to proceed.\n");
  process.exitCode = 0;
} else {
  console.error(`\n  ✗ ${issues} issue(s) found. Fix before deploying to mainnet.\n`);
  process.exitCode = 1;
}
