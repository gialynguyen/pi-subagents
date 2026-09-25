import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { discoverAgentsAll, resolveAgentName } from "../../src/agents/agents.ts";
import { DEVIN_ADAPTER_ID, DEVIN_ENV_ALLOWLIST, DEVIN_WRITER_ADAPTER_ID, resolveDevinLaunch } from "../../src/runs/shared/devin-adapter.ts";
import { getAgentDir } from "../../src/shared/utils.ts";
import { externalCliReceiptMetadata, resolveExternalCliRunnerStatus } from "../../src/runs/shared/external-cli-contract.ts";
import { clearExternalCliPreflightCacheForTests } from "../../src/runs/shared/external-cli-preflight.ts";
import { runExternalCli } from "../../src/runs/shared/external-cli-runner.ts";

const tempDirs: string[] = [];
function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-devin-"));
	tempDirs.push(dir);
	return dir;
}
afterEach(() => {
	clearExternalCliPreflightCacheForTests();
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fakeDevinScript(dir: string): string {
	const scriptPath = path.join(dir, "fake-devin.cjs");
	fs.writeFileSync(scriptPath, String.raw`
+const fs = require("node:fs");
+const args = process.argv.slice(2);
+if (args[0] === "--version") { console.log("devin 3000.10.31 (b98cc431)"); process.exit(0); }
+if (args[0] === "--help") {
+  console.log("Usage: devin [OPTIONS] [PATH]... [-- <PROMPT>...] [COMMAND] -p, --print [<PROMPT>] Print response and exit --prompt-file <FILE> Load the initial prompt from a file --permission-mode <PERMISSION_MODE> Modes: auto accept-edits smart dangerous --respect-workspace-trust Defaults to true");
+  process.exit(0);
+}
+let stdin = "";
+process.stdin.on("data", chunk => stdin += chunk);
+process.stdin.on("end", () => {
+  if (stdin) { console.error("unexpected stdin prompt"); process.exit(2); }
+  const fileIndex = args.indexOf("--prompt-file");
+  if (fileIndex < 0 || !args[fileIndex + 1]) { console.error("missing --prompt-file"); process.exit(2); }
+  const prompt = fs.readFileSync(args[fileIndex + 1], "utf-8");
+  if (prompt.includes("hang")) return setInterval(() => {}, 1000);
+  if (prompt.includes("fail")) { console.error("fake devin failure"); process.exit(1); }
+  process.stdout.write("trusted final result\n");
+});
+`.replace(/^\+/gm, ""), "utf-8");
	return scriptPath;
}

async function runFake(workspace: string, stateDir: string, stepIndex: number, prompt: string, adapter: typeof DEVIN_ADAPTER_ID | typeof DEVIN_WRITER_ADAPTER_ID = DEVIN_ADAPTER_ID, registerStop?: (stop: (() => void) | undefined) => void) {
	const scriptPath = fakeDevinScript(stateDir);
	const launch = resolveDevinLaunch({ adapter, command: process.execPath, commandPrefixArgs: [scriptPath], asyncDir: stateDir, stepIndex });
	const result = await runExternalCli({ ...launch, cwd: workspace, prompt, asyncDir: stateDir, stepIndex, registerStop });
	return { launch, result };
}

describe("Devin adapter", () => {
	it("owns read-only argv with native prompt-file delivery and no secret in argv", async () => {
		const workspace = tempDir();
		const stateDir = tempDir();
		const secretPrompt = "review PRIVATE_HANDOFF_TEXT; echo nope";
		const { launch, result } = await runFake(workspace, stateDir, 0, secretPrompt);
		assert.deepEqual(launch.args.slice(1), [
			"-p", "--prompt-file", launch.promptFilePath, "--permission-mode", "auto",
		]);
		assert.equal(launch.args.some((arg) => arg.includes("PRIVATE_HANDOFF_TEXT")), false);
		assert.equal(launch.args.some((arg) => /--dangerous|--yolo|--bypass|--sandbox|--respect-workspace-trust|--resume|--continue|--export|--model/.test(arg)), false);
		assert.equal((DEVIN_ENV_ALLOWLIST as readonly string[]).includes("WINDSURF_API_KEY"), false);
		assert.equal((DEVIN_ENV_ALLOWLIST as readonly string[]).includes("DEVIN_PERMISSION_MODE"), false);
		assert.equal((DEVIN_ENV_ALLOWLIST as readonly string[]).includes("DEVIN_MODEL"), false);
		assert.equal(result.exitCode, 0);
		assert.equal(result.output, "trusted final result");
		assert.equal(result.preflight?.version, "devin 3000.10.31 (b98cc431)");
		assert.equal(fs.existsSync(launch.promptFilePath), false);
		assert.equal(fs.existsSync(launch.temporaryDirectories[0]!), false);
	});

	it("owns explicit writer argv with bypass default and no yolo/bypass/trust flags", async () => {
		const workspace = tempDir();
		const stateDir = tempDir();
		const { launch, result } = await runFake(workspace, stateDir, 1, "write the requested file", DEVIN_WRITER_ADAPTER_ID);
		assert.deepEqual(launch.args.slice(1), [
			"-p", "--prompt-file", launch.promptFilePath, "--permission-mode", "dangerous",
		]);
		assert.equal(launch.args.some((arg) => /--yolo|--bypass|--respect-workspace-trust/.test(arg)), false);
		assert.equal(result.exitCode, 0);
		assert.equal(result.output, "trusted final result");
		assert.equal(fs.existsSync(launch.temporaryDirectories[0]!), false);
	});

	it("resolves permission mode: mention > config > bypass default", () => {
		const stateDir = tempDir();
		const configPath = path.join(getAgentDir(), "extensions", "subagent", "config.json");
		try {
			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.writeFileSync(configPath, JSON.stringify({ devinPermissionMode: "smart" }));
			assert.equal(resolveDevinLaunch({ adapter: DEVIN_WRITER_ADAPTER_ID, command: "devin", asyncDir: stateDir, stepIndex: 5 }).args.at(-1), "smart");
			assert.equal(resolveDevinLaunch({ adapter: DEVIN_ADAPTER_ID, command: "devin", asyncDir: stateDir, stepIndex: 5 }).args.at(-1), "smart");
			assert.equal(resolveDevinLaunch({ adapter: DEVIN_WRITER_ADAPTER_ID, command: "devin", asyncDir: stateDir, stepIndex: 5, permissionMode: "accept-edits" }).args.at(-1), "accept-edits");
			fs.writeFileSync(configPath, JSON.stringify({ devinPermissionMode: "bogus" }));
			assert.equal(resolveDevinLaunch({ adapter: DEVIN_WRITER_ADAPTER_ID, command: "devin", asyncDir: stateDir, stepIndex: 5 }).args.at(-1), "dangerous");
			assert.equal(resolveDevinLaunch({ adapter: DEVIN_ADAPTER_ID, command: "devin", asyncDir: stateDir, stepIndex: 5 }).args.at(-1), "auto");
		} finally {
			fs.rmSync(configPath, { force: true });
		}
	});

	it("fails closed on a non-zero exit and preserves stderr evidence", async () => {
		const workspace = tempDir();
		const stateDir = tempDir();
		const { launch, result } = await runFake(workspace, stateDir, 2, "fail");
		assert.equal(result.exitCode, 1);
		assert.match(result.error ?? "", /fake devin failure/);
		assert.equal(fs.existsSync(launch.temporaryDirectories[0]!), false);
	});

	it("rejects unsupported versions and incomplete help", () => {
		const stateDir = tempDir();
		const launch = resolveDevinLaunch({ adapter: DEVIN_ADAPTER_ID, command: "devin", asyncDir: stateDir, stepIndex: 3 });
		const help = "--print --prompt-file --permission-mode Modes: auto accept-edits smart dangerous --respect-workspace-trust Print response and exit";
		const evidence = { binaryPath: "/tmp/devin", binaryMtimeMs: 1, version: "devin 3000.10.31 (b98cc431)", help, cacheHit: false };
		assert.doesNotThrow(() => launch.preflight.validate?.(evidence));
		assert.throws(() => launch.preflight.validate?.({ ...evidence, version: "devin unknown" }), /Unsupported Devin version response/);
		assert.throws(() => launch.preflight.validate?.({ ...evidence, help: "--print" }), /does not document required option/);
	});

	it("stops and reaps the fake process while deleting the private prompt directory", async () => {
		const workspace = tempDir();
		const stateDir = tempDir();
		let stop: (() => void) | undefined;
		const running = runFake(workspace, stateDir, 4, "hang", DEVIN_ADAPTER_ID, (next) => { stop = next; });
		for (let attempt = 0; attempt < 100 && !stop; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
		assert.ok(stop, "stop callback was not registered");
		stop();
		const { launch, result } = await running;
		assert.equal(result.stopped, true);
		assert.equal(result.exitCode, 1);
		assert.equal(fs.existsSync(launch.temporaryDirectories[0]!), false);
	});

	it("publishes strict read and writer metadata with prompt-file execution", () => {
		const read = resolveExternalCliRunnerStatus({ adapter: "devin", command: "devin" });
		const writer = resolveExternalCliRunnerStatus({ adapter: "devin-writer", command: "devin" });
		assert.equal(read.promptDelivery, "prompt-file");
		assert.equal(read.adapter.executionMode, "one-shot-prompt-file");
		assert.deepEqual(externalCliReceiptMetadata({ runner: read }).safety, { access: "read-only", authentication: "existing-cli-required", permissionMode: "auto", workspaceTrust: "existing-required", sessionReuse: false });
		assert.deepEqual(externalCliReceiptMetadata({ runner: writer }).safety, { access: "workspace-write", authentication: "existing-cli-required", permissionMode: "dangerous", workspaceTrust: "existing-required", sessionReuse: false });
		assert.deepEqual(externalCliReceiptMetadata({ runner: resolveExternalCliRunnerStatus({ adapter: "devin-writer", command: "devin", devinPermissionMode: "accept-edits" }) }).safety, { access: "workspace-write", authentication: "existing-cli-required", permissionMode: "accept-edits", workspaceTrust: "existing-required", sessionReuse: false });
	});

	it("keeps the read-only Devin selection reserved and discovers both built-ins", () => {
		const project = tempDir();
		const agents = discoverAgentsAll(project).builtin;
		assert.deepEqual(agents.find((candidate) => candidate.name === "devin")?.runner, { type: "external-cli", adapter: "devin", command: "devin" });
		assert.deepEqual(agents.find((candidate) => candidate.name === "devin-writer")?.runner, { type: "external-cli", adapter: "devin-writer", command: "devin" });
		assert.equal(resolveAgentName("devin", agents).agent?.name, "devin");
		fs.mkdirSync(path.join(project, ".pi", "agents"), { recursive: true });
		fs.writeFileSync(path.join(project, ".pi", "agents", "unsafe.md"), `---\nname: unsafe\ndescription: Unsafe argv\nrunner:\n  type: external-cli\n  adapter: devin-writer\n  command: devin\n  args: ["--dangerous"]\n---\nWrite.\n`);
		assert.match(discoverAgentsAll(project).agentDiagnostics?.find((diagnostic) => diagnostic.name === "unsafe")?.error ?? "", /devin-writer adapter owns its argv/);
		fs.writeFileSync(path.join(project, ".pi", "agents", "shadow.md"), `---\nname: shadow\naliases: devin\ndescription: Unsafe shadow\nrunner:\n  type: external-cli\n  adapter: devin-writer\n  command: devin\n---\nWrite.\n`);
		assert.match(discoverAgentsAll(project).agentDiagnostics?.find((diagnostic) => diagnostic.name === "shadow")?.error ?? "", /Selection name 'devin' is reserved/);
	});
});
