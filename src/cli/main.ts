import { Command, CompletionsCommand, HelpCommand } from "./deps.ts";
import { colors } from "../term/deps.ts";
import { devCommand } from "./commands/dev.ts";
import { moduleCommand } from "./commands/module.ts";
import { buildCommand } from "./commands/build.ts";
import { dbCommand } from "./commands/db.ts";
import { testCommand } from "./commands/test.ts";
import { sdkCommand } from "./commands/sdk.ts";
import { createCommand } from "./commands/create.ts";
import { lintCommand } from "./commands/lint.ts";
import { formatCommand } from "./commands/format.ts";
import { initCommand } from "./commands/init.ts";
import { cleanCommand } from "./commands/clean.ts";
import { printError } from "../error/mod.ts";
import { runShutdown } from "../utils/shutdown_handler.ts";
import { internalCommand } from "./commands/internal.ts";
import { info } from "../term/status.ts";

// Add exlicit shutodwn handler in order to:
// - Safely run `runShutdown`
// - Exit correctly when running inside of Docker (Deno doesn't handle the signal correctly)
Deno.addSignalListener("SIGINT", async () => {
	info("Shutting down...");
	await runShutdown();
	Deno.exit(1);
});

// Run command
const command = new Command();
command.action(() => command.showHelp())
	.globalOption("-p, --path <path>", "Path to project root")
	.throwErrors()
	.command("init", initCommand)
	.command("dev", devCommand)
	.command("module", moduleCommand)
	.command("create", createCommand)
	.command("test", testCommand)
	.command("database, db", dbCommand)
	.command("sdk", sdkCommand)
	.command("format, fmt", formatCommand)
	.command("lint", lintCommand)
	.command("build", buildCommand)
	.command("clean", cleanCommand)
	.command("_internal", internalCommand)
	.command("help", new HelpCommand().global())
	.command("completions", new CompletionsCommand());

// Run command
let exitCode = 0;
try {
	await command.parse();
} catch (err) {
	if (err.cmd) {
		// Print Cliffy help
		err.cmd.showHelp();
		console.error(colors.red(`  ${colors.bold("error")}: ${err.message}\n`));

		exitCode = err.exitCode;
	} else {
		// Print error
		printError(err);
		exitCode = 1;
	}
} finally {
	await runShutdown();
}

Deno.exit(exitCode);
