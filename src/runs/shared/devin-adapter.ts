import * as path from "node:path";
import type { ExternalCliPreflightSpec } from "./external-cli-preflight.ts";

export const DEVIN_ADAPTER_ID = "devin" as const;
export const DEVIN_WRITER_ADAPTER_ID = "devin-writer" as const;
export const DEVIN_ENV_ALLOWLIST = [
	"PATH",
	"HOME",
	"USERPROFILE",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
] as const;

export function resolveDevinLaunch(input: {
	adapter: typeof DEVIN_ADAPTER_ID | typeof DEVIN_WRITER_ADAPTER_ID;
	command: string;
	asyncDir: string;
	stepIndex: number;
	/** Test-only executable prefix for a fake Devin process. */
	commandPrefixArgs?: readonly string[];
}): {
	command: string;
	args: string[];
	finalOutputPath?: undefined;
	promptFilePath: string;
	temporaryDirectories: string[];
	environment: { allowlist: readonly string[] };
	preflight: ExternalCliPreflightSpec;
	parser?: undefined;
} {
	const writer = input.adapter === DEVIN_WRITER_ADAPTER_ID;
	const promptDirectory = path.join(input.asyncDir, `external-${input.stepIndex}.devin-prompt`);
	const promptFilePath = path.join(promptDirectory, "handoff.txt");
	const prefix = [...(input.commandPrefixArgs ?? [])];
	const args = [
		...prefix,
		"-p",
		"--prompt-file", promptFilePath,
		"--permission-mode", writer ? "accept-edits" : "auto",
	];
	return {
		command: input.command,
		args,
		promptFilePath,
		temporaryDirectories: [promptDirectory],
		environment: { allowlist: DEVIN_ENV_ALLOWLIST },
		preflight: {
			id: input.adapter,
			versionArgs: [...prefix, "--version"],
			helpArgs: [...prefix, "--help"],
			validate(result) {
				if (!/^devin \d+\.\d+\.\d+ \([0-9a-f]+\)$/.test(result.version)) throw new Error(`Unsupported Devin version response: ${JSON.stringify(result.version)}.`);
				for (const required of ["--print", "--prompt-file", "--permission-mode", "accept-edits", "--respect-workspace-trust", "Print response and exit"]) {
					if (!result.help.includes(required)) throw new Error(`Devin help does not document required option ${JSON.stringify(required)}.`);
				}
			},
		},
		parser: undefined,
	};
}
