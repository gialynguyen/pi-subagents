import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface DevinSmokeInputs {
	workspace: string;
	stateRoot: string;
	canaryPath: string;
	promptDirectory: string;
}

function existingDirectory(value: string | undefined, name: string): string {
	if (!value?.trim()) throw new Error(`${name} is required.`);
	try {
		const resolved = fs.realpathSync(path.resolve(value));
		if (!fs.statSync(resolved).isDirectory()) throw new Error(`${name} must point to an existing directory.`);
		return resolved;
	} catch (error) {
		if (error instanceof Error && error.message === `${name} must point to an existing directory.`) throw error;
		throw new Error(`${name} must point to an existing directory.`, { cause: error });
	}
}

/**
 * The test loader isolates HOME, but Devin authenticates from a credentials file
 * under the operator's real home. The smoke restores the operator home for the
 * child only (saved and restored around the run) so file-based login works.
 * Prefers an explicit override, falls back to the passwd home (unaffected by $HOME).
 */
export function devinSmokeHome(env: NodeJS.ProcessEnv): string {
	const override = env.PI_SUBAGENTS_DEVIN_SMOKE_HOME?.trim();
	if (override) return path.resolve(override);
	return os.userInfo().homedir;
}

export async function withDevinSmokeHome<T>(env: NodeJS.ProcessEnv, run: () => Promise<T>): Promise<T> {
	const previousHome = process.env.HOME;
	const previousProfile = process.env.USERPROFILE;
	const home = devinSmokeHome(env);
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		return await run();
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousProfile;
	}
}

export function devinSmokeInputs(env: NodeJS.ProcessEnv): DevinSmokeInputs {
	if (env.PI_SUBAGENTS_DEVIN_SMOKE_DISPOSABLE !== "1") {
		throw new Error("PI_SUBAGENTS_DEVIN_SMOKE_DISPOSABLE=1 is required to attest that the operator-managed workspace is disposable.");
	}
	const workspace = existingDirectory(env.PI_SUBAGENTS_DEVIN_SMOKE_WORKSPACE, "PI_SUBAGENTS_DEVIN_SMOKE_WORKSPACE");
	const stateRoot = existingDirectory(env.PI_SUBAGENTS_DEVIN_SMOKE_STATE_ROOT, "PI_SUBAGENTS_DEVIN_SMOKE_STATE_ROOT");
	const canaryPath = path.join(workspace, "pi-subagents-devin-write-canary.txt");
	const promptDirectory = path.join(stateRoot, "external-0.devin-prompt");
	if (fs.existsSync(canaryPath)) throw new Error(`Devin smoke canary path must not exist before launch: ${canaryPath}`);
	let promptDirectoryStatus: fs.Stats;
	try { promptDirectoryStatus = fs.lstatSync(promptDirectory); }
	catch (error) { throw new Error(`Devin smoke prompt directory must be an existing operator-trusted directory: ${promptDirectory}`, { cause: error }); }
	if (promptDirectoryStatus.isSymbolicLink() || !promptDirectoryStatus.isDirectory()) {
		throw new Error(`Devin smoke prompt directory must be an existing directory, not a symlink: ${promptDirectory}`);
	}
	if (process.getuid && promptDirectoryStatus.uid !== process.getuid()) {
		throw new Error(`Devin smoke prompt directory must be owned by the current operator: ${promptDirectory}`);
	}
	if (fs.readdirSync(promptDirectory).length > 0) throw new Error(`Devin smoke prompt directory must be empty before launch: ${promptDirectory}`);
	return { workspace, stateRoot, canaryPath, promptDirectory };
}
