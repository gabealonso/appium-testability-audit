/** LIBS */
import type { Audit } from "./types.ts";

const HELP = `
appium-testability-audit — rank a screen's elements by locator stability.

Usage
  appium-testability-audit <file> [options]

  <file> is either a page source XML or a saved screen JSON. Which one it is comes
  from the file's first character, not its name: a page source starts with "<" and a
  saved screen with "{".

  Get a page source with either of these:
    adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml
    driver.getPageSource()   # write the string to a file

Options
      --save <file>          Write the screen as JSON, to audit later without a device
      --json                 Print the JSON report instead of the readable one
      --max-unreachable N    Exit 1 when more than N elements cannot be reached
      --max-ambiguous N      Exit 1 when more than N locators match several elements
  -h, --help                 Show this help

Exit codes
  0  audit ran, and stayed within any limits given
  1  a limit was exceeded, or the screen could not be read
`;

/** What the command line asked for. */
interface Args {
    path: string;
    save: string | null;
    json: boolean;
    help: boolean;
    maxUnreachable: number | null;
    maxAmbiguous: number | null;
}

/** FUNCTIONS */

/**
 * Read the value that follows a flag, failing when it is missing.
 *
 * A value that starts with `-` is treated as missing rather than consumed: `--save --json`
 * is a forgotten filename, and silently naming a file `--json` would be worse than saying
 * so.
 *
 * @param argv - The full argument list.
 * @param index - Index of the value to read.
 * @param flag - The flag being read, used in the error message.
 * @returns The flag value.
 */
const readValue = (argv: string[], index: number, flag: string): string => {
    const value = argv[index];

    if (value === undefined || value.startsWith("-")) {
        throw new Error(`The option ${flag} needs a value.`);
    }

    return value;
};

/**
 * Read a whole-number limit.
 *
 * @param raw - The raw flag value.
 * @param flag - The flag being read, used in the error message.
 * @returns The parsed limit.
 */
const readLimit = (raw: string, flag: string): number => {
    const parsed = Number(raw);

    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${flag} needs a whole number, got "${raw}".`);
    }

    return parsed;
};

/**
 * Parse the command-line arguments.
 *
 * @param argv - Arguments as received from `process.argv.slice(2)`.
 * @returns The parsed arguments.
 */
const parseArgs = (argv: string[]): Args => {
    const args: Args = {
        path: "",
        save: null,
        json: false,
        help: false,
        maxUnreachable: null,
        maxAmbiguous: null,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === undefined) {
            continue;
        }

        switch (arg) {
            case "-h":
            case "--help":
                args.help = true;
                break;
            case "--json":
                args.json = true;
                break;
            case "--save":
                index += 1;
                args.save = readValue(argv, index, arg);
                break;
            case "--max-unreachable":
                index += 1;
                args.maxUnreachable = readLimit(readValue(argv, index, arg), arg);
                break;
            case "--max-ambiguous":
                index += 1;
                args.maxAmbiguous = readLimit(readValue(argv, index, arg), arg);
                break;
            default:
                if (arg.startsWith("-")) {
                    throw new Error(`Unknown option "${arg}". Run with --help.`);
                }

                args.path = arg;
        }
    }

    return args;
};

/**
 * Which limits the audit went over.
 *
 * A limit is a ceiling that is still allowed: `--max-unreachable 2` passes on exactly two
 * and fails on three. That reading is what lets a team ratchet an existing screen down
 * instead of having to fix everything before the gate is useful at all.
 *
 * @param audit - The finished audit.
 * @param args - The limits asked for on the command line.
 * @returns One message per exceeded limit, empty when everything is within bounds.
 */
const limitsExceeded = (audit: Audit, args: Args): string[] => {
    const exceeded: string[] = [];

    if (args.maxUnreachable !== null && audit.counts.unreachable > args.maxUnreachable) {
        exceeded.push(
            `${audit.counts.unreachable} unreachable exceeds the limit of ${args.maxUnreachable}`
        );
    }

    if (args.maxAmbiguous !== null && audit.counts.ambiguous > args.maxAmbiguous) {
        exceeded.push(
            `${audit.counts.ambiguous} ambiguous exceeds the limit of ${args.maxAmbiguous}`
        );
    }

    return exceeded;
};

/** EXPORTS */
export { HELP, readValue, readLimit, parseArgs, limitsExceeded };
export type { Args };
