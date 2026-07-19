/**
 * Router connection setup: writes .env and installs an SSH key on the router
 * so ut-sync works without any manual ssh configuration.
 *
 * Usage: pnpm setup:router [ip]
 *   ip       router address; omit for the interactive wizard, which asks for
 *            every .env value (router IP, dev-server host/port) with the
 *            current .env entries as defaults
 *
 * (The script is named `setup:router` because plain `pnpm setup` resolves to
 * pnpm's own built-in setup command, never a package.json script.)
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const SSH_OPTS = [
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
];

// Must match the ut-sync plugin in vite.config.ts — the final push below is a
// real template sync, so setup only succeeds if `pnpm dev` sync will too.
const UT_TEMPLATE_DIR = resolve(
  process.cwd(),
  "../ucode/template/themes/aurora",
);
const UT_REMOTE_DIR = "/usr/share/ucode/luci/template/themes/aurora";

function canAuth(host) {
  return (
    spawnSync(
      "ssh",
      [
        ...SSH_OPTS,
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        host,
        "echo ok",
      ],
      { stdio: "ignore" },
    ).status === 0
  );
}

function canReachSsh(hostname, timeout = 2000) {
  return new Promise((done) => {
    const sock = connect({ host: hostname, port: 22, timeout });
    const finish = (ok) => {
      sock.destroy();
      done(ok);
    };
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

console.log("Aurora router setup — passwordless SSH + .env for `pnpm dev`\n");

const args = process.argv.slice(2);
const argIp = args.find((a) => !a.startsWith("-"));

// Every variable the wizard manages (the full .env surface, see
// .env.example); any other lines in .env pass through untouched.
const ENV_VARS = [
  { key: "VITE_OPENWRT_HOST", label: "Router IP", fallback: "192.168.1.1" },
  { key: "VITE_DEV_HOST", label: "Dev server host", fallback: "127.0.0.1" },
  { key: "VITE_DEV_PORT", label: "Dev server port", fallback: "5173" },
];

const envPath = resolve(process.cwd(), ".env");
const envLines = existsSync(envPath)
  ? readFileSync(envPath, "utf-8").split("\n")
  : [];
const savedValue = (key) =>
  envLines
    .find((l) => l.startsWith(`${key}=`))
    ?.slice(key.length + 1)
    .trim();
const values = Object.fromEntries(
  ENV_VARS.map(({ key, fallback }) => [key, savedValue(key) || fallback]),
);

if (argIp) {
  // Arg mode is non-interactive: take the IP from argv and keep the saved
  // (or default) dev-server values.
  values.VITE_OPENWRT_HOST = argIp;
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Answers come through the async iterator — unlike rl.question, it buffers
  // lines, so piped input (`printf 'ip\nhost\nport\n' | …`) is not dropped
  // between questions, and EOF just leaves the remaining defaults in place.
  const lines = rl[Symbol.asyncIterator]();
  for (const { key, label } of ENV_VARS) {
    rl.setPrompt(`${label} [${values[key]}]: `);
    rl.prompt();
    const { value, done } = await lines.next();
    if (done) {
      console.log();
      break;
    }
    const answer = value.trim();
    if (answer) values[key] = answer;
  }
  rl.close();
}

if (!/^\d+$/.test(values.VITE_DEV_PORT)) {
  console.log(
    `  Ignoring invalid port "${values.VITE_DEV_PORT}" — using 5173.`,
  );
  values.VITE_DEV_PORT = "5173";
}

const ip = values.VITE_OPENWRT_HOST;

// Accept the same forms vite.config.ts does (bare IP, host:port, http:// URL);
// ssh always targets the bare hostname — port/key overrides live in ~/.ssh/config.
const hostname = new URL(/^https?:\/\//.test(ip) ? ip : `http://${ip}`)
  .hostname;
const host = `root@${hostname}`;

if (!(await canReachSsh(hostname))) {
  console.error(`✗ Cannot reach ${hostname}:22 (2s timeout).`);
  console.error(
    "  Check that the device is powered on, on the same network, and has SSH enabled.",
  );
  console.error(
    "  (If it listens on a non-standard port, add a Host block to ~/.ssh/config.)",
  );
  process.exit(1);
}

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
  console.log(
    `✓ Passwordless SSH to ${host} already works (checked: ssh echo).`,
  );
} else {
  console.log(
    `Installing ${pubKeyPath} on the router (enter the router password once):`,
  );
  const pubKey = readFileSync(pubKeyPath, "utf-8").trim();
  // stderr is piped so failures can be classified below; ssh's password prompt
  // goes straight to the tty, so interactive login still works.
  const install = spawnSync(
    "ssh",
    [
      ...SSH_OPTS,
      "-o",
      "ConnectTimeout=5",
      host,
      `mkdir -p /etc/dropbear && touch /etc/dropbear/authorized_keys && (grep -qxF '${pubKey}' /etc/dropbear/authorized_keys || echo '${pubKey}' >> /etc/dropbear/authorized_keys) && chmod 600 /etc/dropbear/authorized_keys`,
    ],
    { stdio: ["inherit", "inherit", "pipe"], encoding: "utf-8" },
  );
  if (install.status !== 0) {
    const stderr = (install.stderr || "").trim();
    if (/Permission denied|Authentication failed/i.test(stderr)) {
      console.error(
        "✗ Authentication failed — likely a wrong password. Re-run pnpm setup:router.",
      );
      console.error(
        "  (If the device runs openssh instead of dropbear, keys belong in /root/.ssh/authorized_keys.)",
      );
    } else if (
      /timed out|No route to host|Connection refused|Could not resolve/i.test(
        stderr,
      )
    ) {
      console.error(`✗ ${hostname} did not respond as an SSH host.`);
      console.error(
        "  Check the IP and that SSH is enabled on the device. (A VPN/proxy in TUN mode can also intercept the connection.)",
      );
    } else {
      console.error("✗ Key install failed:");
    }
    if (stderr) console.error(`  ${stderr.replace(/\n/g, "\n  ")}`);
    process.exit(1);
  }
  if (!canAuth(host)) {
    console.error("✗ Key installed, but passwordless SSH still fails.");
    console.error(
      "  Check the dropbear config on the device (PubkeyAuth) and /etc/dropbear/authorized_keys.",
    );
    process.exit(1);
  }
  console.log("✓ Passwordless SSH configured.");
}

// End-to-end check: push the templates through the exact pipeline ut-sync uses.
// `ssh echo ok` alone can pass while the real tar-over-ssh sync would not.
const started = Date.now();
try {
  execSync(
    `tar -C "${UT_TEMPLATE_DIR}" -cf - . | ssh ${SSH_OPTS.join(" ")} -o BatchMode=yes -o ConnectTimeout=5 "${host}" "mkdir -p '${UT_REMOTE_DIR}' && tar -xf - -C '${UT_REMOTE_DIR}'"`,
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  console.log(
    `✓ Templates pushed to ${host}:${UT_REMOTE_DIR} (${Date.now() - started}ms) — dev sync verified.`,
  );
} catch (err) {
  console.error(
    "✗ Template push failed — `pnpm dev` template sync will not work:",
  );
  console.error(`  ${String(err?.stderr || err?.message || err).trim()}`);
  process.exit(1);
}

// Update managed keys in place so surrounding comments keep their meaning,
// then append any the file does not have yet; other lines pass through.
const out = envLines.map((l) => {
  const managed = ENV_VARS.find(({ key }) => l.startsWith(`${key}=`));
  return managed ? `${managed.key}=${values[managed.key]}` : l;
});
while (out.length && !out[out.length - 1]) out.pop();
for (const { key } of ENV_VARS) {
  if (!out.some((l) => l.startsWith(`${key}=`)))
    out.push(`${key}=${values[key]}`);
}
writeFileSync(envPath, out.join("\n") + "\n");
console.log(
  `✓ Wrote .env (${ENV_VARS.map(({ key }) => `${key}=${values[key]}`).join(", ")})`,
);
console.log("Done — run `pnpm dev`.");
