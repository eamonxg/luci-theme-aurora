/**
 * One-shot dev environment setup: writes .env and installs an SSH key on the
 * router so ut-sync works without any manual ssh configuration.
 *
 * Usage: pnpm setup  (asks for the router IP, then one router password prompt)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const SSH_OPTS = [
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
];

function canAuth(host) {
  return (
    spawnSync(
      "ssh",
      [...SSH_OPTS, "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", host, "echo ok"],
      { stdio: "ignore" },
    ).status === 0
  );
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ip =
  (await rl.question("Router IP [192.168.1.1]: ")).trim() || "192.168.1.1";
rl.close();

const host = `root@${ip}`;
const sshDir = join(homedir(), ".ssh");

let pubKeyPath = ["id_ed25519.pub", "id_rsa.pub", "id_ecdsa.pub"]
  .map((f) => join(sshDir, f))
  .find((f) => existsSync(f));

if (!pubKeyPath) {
  console.log("No SSH key found — generating ~/.ssh/id_ed25519 ...");
  const keygen = spawnSync(
    "ssh-keygen",
    ["-t", "ed25519", "-N", "", "-f", join(sshDir, "id_ed25519")],
    { stdio: "inherit" },
  );
  if (keygen.status !== 0) {
    console.error("✗ ssh-keygen failed.");
    process.exit(1);
  }
  pubKeyPath = join(sshDir, "id_ed25519.pub");
}

if (canAuth(host)) {
  console.log(`✓ Passwordless SSH to ${host} already works.`);
} else {
  console.log(
    `Installing ${pubKeyPath} on the router (enter the router password once):`,
  );
  const pubKey = readFileSync(pubKeyPath, "utf-8").trim();
  const install = spawnSync(
    "ssh",
    [
      ...SSH_OPTS,
      host,
      `mkdir -p /etc/dropbear && echo '${pubKey}' >> /etc/dropbear/authorized_keys && chmod 600 /etc/dropbear/authorized_keys`,
    ],
    { stdio: "inherit" },
  );
  if (install.status !== 0 || !canAuth(host)) {
    console.error(
      `✗ Key install failed. Check that the device at ${ip} is reachable and the password is correct, then re-run pnpm setup.`,
    );
    process.exit(1);
  }
  console.log("✓ Passwordless SSH configured.");
}

const envPath = resolve(process.cwd(), ".env");
const kept = existsSync(envPath)
  ? readFileSync(envPath, "utf-8")
      .split("\n")
      .filter((l) => l && !l.startsWith("VITE_OPENWRT_HOST="))
  : [];
writeFileSync(
  envPath,
  [`VITE_OPENWRT_HOST=${ip}`, ...kept].join("\n") + "\n",
);
console.log(`✓ Wrote .env (VITE_OPENWRT_HOST=${ip})`);
console.log("Done — run `pnpm dev`.");
