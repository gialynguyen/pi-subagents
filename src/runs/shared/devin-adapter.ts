import * as fs from "node:fs";
import * as path from "node:path";
import type { DevinPermissionMode } from "../../shared/types.ts";
import { getAgentDir } from "../../shared/utils.ts";
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

function readDevinPermissionModeConfig(): DevinPermissionMode | undefined {
	// ponytail: direct read of one config key (validated on write in extension/config.ts), no cache.
	try {
		const raw = JSON.parse(fs.readFileSync(path.join(getAgentDir(), "extensions", "subagent", "config.json"), "utf-8")) as { devinPermissionMode?: unknown };
		const mode = raw?.devinPermissionMode;
		return mode === "auto" || mode === "accept-edits" || mode === "smart" || mode === "dangerous" ? mode : undefined;
	} catch {
		return undefined;
	}
}

/** Precedence: caller-mentioned mode > config.devinPermissionMode > default ("dangerous" bypass for the writer, "auto" for read-only). */
export function resolveDevinPermissionMode(input: { permissionMode?: DevinPermissionMode | undefined; writer: boolean }): DevinPermissionMode {
	return input.permissionMode ?? readDevinPermissionModeConfig() ?? (input.writer ? "dangerous" : "auto");
}

export function resolveDevinLaunch(input: {
	adapter: typeof DEVIN_ADAPTER_ID | typeof DEVIN_WRITER_ADAPTER_ID;
	command: string;
	asyncDir: string;
	stepIndex: number;
	/** Caller-mentioned mode; wins over config.devinPermissionMode. */
	permissionMode?: DevinPermissionMode | undefined;
	/** Test-only executable prefix for a fake Devin process. */
	commandPrefixArgs?: readonly string[];
}): {
	command: string;
	args: string[];
	finalOutputPath?: undefined;
	permissionMode: DevinPermissionMode;
	promptFilePath: string;
	temporaryDirectories: string[];
	environment: { allowlist: readonly string[] };
	preflight: ExternalCliPreflightSpec;
	parser?: undefined;
} {
	const writer = input.adapter === DEVIN_WRITER_ADAPTER_ID;
	const mode = resolveDevinPermissionMode({ permissionMode: input.permissionMode, writer });
	const promptDirectory = path.join(input.asyncDir, `external-${input.stepIndex}.devin-prompt`);
	const promptFilePath = path.join(promptDirectory, "handoff.txt");
	const prefix = [...(input.commandPrefixArgs ?? [])];
	const args = [
		...prefix,
		"-p",
		"--prompt-file", promptFilePath,
		"--permission-mode", mode,
	];
	return {
		command: input.command,
		args,
		permissionMode: mode,
		promptFilePath,
		temporaryDirectories: [promptDirectory],
		environment: { allowlist: DEVIN_ENV_ALLOWLIST },
		preflight: {
			id: input.adapter,
			versionArgs: [...prefix, "--version"],
			helpArgs: [...prefix, "--help"],
			validate(result) {
				if (!/^devin \d+\.\d+\.\d+ \([0-9a-f]+\)$/.test(result.version)) throw new Error(`Unsupported Devin version response: ${JSON.stringify(result.version)}.`);
				for (const required of ["--print", "--prompt-file", "--permission-mode", mode, "--respect-workspace-trust", "Print response and exit"]) {
					if (!result.help.includes(required)) throw new Error(`Devin help does not document required option ${JSON.stringify(required)}.`);
				}
			},
		},
		parser: undefined,
	};
}
