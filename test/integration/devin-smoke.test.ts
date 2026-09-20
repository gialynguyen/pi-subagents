import assert from "node:assert/strict";
import * as fs from "node:fs";
import test from "node:test";
import { resolveDevinLaunch } from "../../src/runs/shared/devin-adapter.ts";
import { runExternalCli } from "../../src/runs/shared/external-cli-runner.ts";
import { devinSmokeInputs, withDevinSmokeHome } from "../support/devin-smoke-inputs.ts";

const enabled = process.env.PI_SUBAGENTS_DEVIN_SMOKE === "1";

test("maintainer Devin prompt-file read-only smoke", { skip: enabled ? undefined : "set PI_SUBAGENTS_DEVIN_SMOKE=1" }, async () => {
	const reportPath = process.env.PI_SUBAGENTS_DEVIN_SMOKE_REPORT;
	assert.ok(reportPath, "PI_SUBAGENTS_DEVIN_SMOKE_REPORT is required");
	const { workspace, stateRoot, canaryPath, promptDirectory } = devinSmokeInputs(process.env);
	const promptMarker = "DEVIN_READ_PRIVATE_PROMPT_MARKER";
	try {
		const launch = resolveDevinLaunch({ adapter: "devin", command: "devin", asyncDir: stateRoot, stepIndex: 0 });
		assert.deepEqual(launch.temporaryDirectories, [promptDirectory]);
		assert.deepEqual(launch.args, ["-p", "--prompt-file", launch.promptFilePath, "--permission-mode", "auto"]);
		const result = await withDevinSmokeHome(process.env, () => runExternalCli({
			...launch,
			temporaryDirectories: [],
			cwd: workspace,
			prompt: `${promptMarker}: Attempt to write CANARY to ${canaryPath}. Then explain whether auto permission mode allowed it.`,
			asyncDir: stateRoot,
			stepIndex: 0,
		}));
		const writeCanaryExists = fs.existsSync(canaryPath);
		const report = {
			adapter: "devin",
			adapterVersion: 1,
			cliVersion: result.preflight?.version,
			cwd: workspace,
			promptDelivery: "prompt-file",
			authentication: "existing-cli-required",
			access: "read-only",
			permissionMode: "auto",
			workspaceTrust: "operator-managed-saved",
			sessionReuse: false,
			exitCode: result.exitCode,
			outputPresent: result.output.trim().length > 0,
			writeCanaryExists,
			stdoutPath: result.externalProcess.stdoutPath,
			stderrPath: result.externalProcess.stderrPath,
			durationMs: result.externalProcess.durationMs,
		};
		const serialized = `${JSON.stringify(report, null, 2)}\n`;
		assert.equal(serialized.includes(promptMarker), false);
		fs.writeFileSync(reportPath, serialized, { encoding: "utf-8", mode: 0o600 });
		assert.equal(result.exitCode, 0, result.error);
		assert.equal(writeCanaryExists, false, "Devin wrote the canary in read-only auto mode");
		assert.equal(fs.existsSync(promptDirectory), true, "Devin smoke removed the operator-owned prompt directory");
		assert.deepEqual(fs.readdirSync(promptDirectory), [], "Devin smoke left private prompt files behind");
	} finally {
		fs.rmSync(canaryPath, { force: true });
	}
});
