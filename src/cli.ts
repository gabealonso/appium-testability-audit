#!/usr/bin/env node
/** LIBS */
import { writeFile } from "node:fs/promises";
import { HELP, limitsExceeded, parseArgs } from "./args.ts";
import { auditScreen } from "./audit.ts";
import { loadScreen } from "./load.ts";
import { renderJson, renderReport } from "./report.ts";

/** FUNCTIONS */

/**
 * Entry point: read a screen, audit it, print the report, and set the exit code.
 *
 * Everything with a decision in it lives elsewhere — `args.ts` decides what was asked for,
 * `load.ts` reads it, `audit.ts` judges it. This function only sequences them and prints,
 * which is why it is the one module without a spec.
 */
const main = async (): Promise<void> => {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || args.path === "") {
        console.log(HELP);
        return;
    }

    const screen = await loadScreen(args.path);

    if (args.save !== null) {
        await writeFile(args.save, `${JSON.stringify(screen, null, 4)}\n`);
    }

    const audit = auditScreen(screen.platform, screen.source, screen.elements);

    console.log(args.json ? renderJson(audit) : renderReport(audit));

    const exceeded = limitsExceeded(audit, args);

    if (exceeded.length > 0) {
        console.error(exceeded.join("; "));
        process.exitCode = 1;
    }
};

await main().catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
