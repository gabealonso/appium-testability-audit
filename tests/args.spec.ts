/** LIBS */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HELP, limitsExceeded, parseArgs } from "../src/args.ts";
import { auditScreen } from "../src/audit.ts";
import type { MobileElement } from "../src/types.ts";

/** FIXTURES */
const element = (over: Partial<MobileElement> = {}): MobileElement => ({
    platform: "android",
    className: "android.widget.TextView",
    resourceId: null,
    accessibilityId: null,
    label: null,
    text: null,
    clickable: true,
    displayed: true,
    xpath: "/hierarchy[1]/android.widget.TextView[1]",
    ...over,
});

/** TEST SUITE */
describe("args - what was asked for", () => {
    it("asks for nothing by default, so no limit is enforced unless given", () => {
        assert.deepEqual(parseArgs([]), {
            path: "",
            save: null,
            json: false,
            help: false,
            maxUnreachable: null,
            maxAmbiguous: null,
        });
    });

    it("takes the file as a positional argument", () => {
        assert.equal(parseArgs(["ui.xml"]).path, "ui.xml");
    });

    it("reads the flags", () => {
        const args = parseArgs(["ui.xml", "--json", "--save", "out.json"]);

        assert.equal(args.json, true);
        assert.equal(args.save, "out.json");
        assert.equal(args.path, "ui.xml");
    });

    it("accepts both spellings of help", () => {
        assert.equal(parseArgs(["-h"]).help, true);
        assert.equal(parseArgs(["--help"]).help, true);
    });

    it("reads limits, and keeps zero as a limit rather than as unset", () => {
        // The strictest gate there is, and the one most likely to be written as 0. Falsy
        // handling that collapsed it to "no limit" would silently disable the check.
        const args = parseArgs(["ui.xml", "--max-unreachable", "0", "--max-ambiguous", "3"]);

        assert.equal(args.maxUnreachable, 0);
        assert.equal(args.maxAmbiguous, 3);
    });

    it("does not care about flag order", () => {
        const args = parseArgs(["--json", "--max-ambiguous", "1", "ui.xml"]);

        assert.equal(args.path, "ui.xml");
        assert.equal(args.json, true);
        assert.equal(args.maxAmbiguous, 1);
    });
});

describe("args - refusing bad input", () => {
    it("says which option is missing its value", () => {
        assert.throws(() => parseArgs(["ui.xml", "--save"]), /The option --save needs a value/);
    });

    it("treats a following flag as a missing value, not as a filename", () => {
        // `--save --json` is a forgotten filename. Writing a file called `--json` would be
        // worse than refusing.
        assert.throws(() => parseArgs(["--save", "--json"]), /--save needs a value/);
    });

    it("quotes what it got when a limit is not a whole number", () => {
        assert.throws(
            () => parseArgs(["--max-unreachable", "two"]),
            /--max-unreachable needs a whole number, got "two"/
        );
        assert.throws(() => parseArgs(["--max-ambiguous", "1.5"]), /needs a whole number/);
    });

    it("rejects a negative limit", () => {
        // It arrives as a flag-looking token, so it is reported as a missing value; either
        // way it never becomes a limit of -1.
        assert.throws(() => parseArgs(["--max-ambiguous", "-1"]), /needs a value/);
    });

    it("points at help when the option does not exist", () => {
        assert.throws(() => parseArgs(["--max-fragile", "1"]), /Unknown option "--max-fragile"/);
        assert.throws(() => parseArgs(["--max-fragile", "1"]), /Run with --help/);
    });
});

describe("args - the CI gate", () => {
    /**
     * Two unreachable elements and one ambiguous pair.
     *
     * The pair shares both its `resource-id` **and** its text on purpose: with distinct
     * text the ladder drops to a `UiSelector` on that text and calls them fragile rather
     * than ambiguous, which would gate on the wrong count.
     */
    const audit = auditScreen("android", "s", [
        element({ className: "android.widget.ImageView", xpath: "//ImageView[1]" }),
        element({ className: "android.widget.ImageView", xpath: "//ImageView[2]" }),
        element({ resourceId: "com.example.app:id/row", text: "Buy milk" }),
        element({ resourceId: "com.example.app:id/row", text: "Buy milk" }),
    ]);

    it("counts what it is about to gate on", () => {
        assert.equal(audit.counts.unreachable, 2);
        assert.equal(audit.counts.ambiguous, 2);
    });

    it("passes with no limits given", () => {
        assert.deepEqual(limitsExceeded(audit, parseArgs(["s"])), []);
    });

    it("treats the limit as a ceiling that is still allowed", () => {
        // Exactly at the limit passes; one more fails. This is what lets a team ratchet an
        // existing screen down instead of fixing everything before the gate is useful.
        assert.deepEqual(limitsExceeded(audit, parseArgs(["s", "--max-unreachable", "2"])), []);
        assert.equal(limitsExceeded(audit, parseArgs(["s", "--max-unreachable", "1"])).length, 1);
    });

    it("names the count and the limit it went over", () => {
        assert.match(
            limitsExceeded(audit, parseArgs(["s", "--max-unreachable", "0"]))[0] ?? "",
            /2 unreachable exceeds the limit of 0/
        );
    });

    it("reports every limit that was exceeded, not just the first", () => {
        const exceeded = limitsExceeded(
            audit,
            parseArgs(["s", "--max-unreachable", "0", "--max-ambiguous", "0"])
        );

        assert.equal(exceeded.length, 2);
        assert.match(exceeded.join("; "), /unreachable.*ambiguous/);
    });
});

describe("args - the help text", () => {
    it("documents every option the parser accepts", () => {
        for (const flag of ["--save", "--json", "--max-unreachable", "--max-ambiguous", "--help"]) {
            assert.ok(HELP.includes(flag), `${flag} is missing from the help text`);
        }
    });

    it("says how to get a page source, which is the first thing anyone asks", () => {
        assert.match(HELP, /uiautomator dump/);
        assert.match(HELP, /getPageSource/);
    });
});
