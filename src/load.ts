/** LIBS */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseScreen } from "./audit.ts";
import { readPageSource } from "./reader.ts";
import type { Screen } from "./types.ts";

/** FUNCTIONS */

/**
 * Decide which of the two input formats some text is.
 *
 * Decided by the first character rather than by the file extension: both formats announce
 * themselves — a page source opens with `<`, a saved screen with `{` — so there is nothing
 * to guess, and a dump saved as `ui.txt` still works.
 *
 * @param text - The trimmed file contents.
 * @returns Which format it is.
 */
const formatOf = (text: string): "page-source" | "screen" | "unknown" => {
    if (text.startsWith("<")) {
        return "page-source";
    }

    return text.startsWith("{") ? "screen" : "unknown";
};

/**
 * Read a file as either a page source or a saved screen.
 *
 * The reported source is the file's base name, not its path: a report gets pasted into
 * pull requests and chat, and the absolute path of someone's laptop has no business
 * travelling with it.
 *
 * @param file - Path to the page source or screen.
 * @returns The screen, ready to audit.
 */
const loadScreen = async (file: string): Promise<Screen> => {
    const raw = (await readFile(file, "utf8")).trim();

    switch (formatOf(raw)) {
        case "page-source":
            return readPageSource(raw, basename(file));
        case "screen":
            return parseScreen(JSON.parse(raw));
        default:
            throw new Error(
                `${basename(file)} is neither a page source nor a saved screen: it starts ` +
                    `with "${raw.slice(0, 1)}" rather than "<" or "{".`
            );
    }
};

/** EXPORTS */
export { formatOf, loadScreen };
