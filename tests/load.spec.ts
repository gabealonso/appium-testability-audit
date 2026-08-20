/** LIBS */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatOf, loadScreen } from "../src/load.ts";

/** FIXTURES */

/**
 * Write a file into a throwaway directory.
 *
 * @param name - The file name, which the reported source is taken from.
 * @param contents - What to write.
 * @returns The full path.
 */
const tempFile = async (name: string, contents: string): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), "appium-audit-"));
    const path = join(directory, name);

    await writeFile(path, contents);

    return path;
};

const DUMP = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node class="android.widget.Button" resource-id="com.example.app:id/add" text="Add" bounds="[0,0][200,100]" clickable="true" />
</hierarchy>`;

const SCREEN = JSON.stringify({
    platform: "android",
    source: "saved earlier",
    readAt: "2026-08-20T12:00:00.000Z",
    elements: [
        {
            platform: "android",
            className: "android.widget.Button",
            resourceId: "com.example.app:id/add",
            accessibilityId: null,
            label: null,
            text: "Add",
            clickable: true,
            displayed: true,
            xpath: "/hierarchy[1]/android.widget.Button[1]",
        },
    ],
});

/** TEST SUITE */
describe("load - telling the two formats apart", () => {
    it("reads the format off the first character, not the file name", () => {
        assert.equal(formatOf("<hierarchy>"), "page-source");
        assert.equal(formatOf('{"platform":"android"}'), "screen");
        assert.equal(formatOf("hello"), "unknown");
    });

    it("recognises an XML declaration as a page source", () => {
        assert.equal(formatOf("<?xml version='1.0'?><hierarchy />"), "page-source");
    });
});

describe("load - reading a file", () => {
    it("reads a page source through the reader", async () => {
        const screen = await loadScreen(await tempFile("ui.xml", DUMP));

        assert.equal(screen.platform, "android");
        assert.equal(screen.elements[0]?.resourceId, "com.example.app:id/add");
    });

    it("reads a page source saved under any extension", async () => {
        // The format is self-describing, so the name is not load-bearing.
        const screen = await loadScreen(await tempFile("dump.txt", DUMP));

        assert.equal(screen.elements.length, 1);
    });

    it("reads a saved screen and keeps the source it was saved with", async () => {
        const screen = await loadScreen(await tempFile("screen.json", SCREEN));

        assert.equal(screen.source, "saved earlier");
    });

    it("reports a page source by base name, so no local path travels with the report", async () => {
        // A report gets pasted into pull requests; the absolute path of someone's laptop
        // has no business going with it.
        const path = await tempFile("login.xml", DUMP);
        const screen = await loadScreen(path);

        assert.equal(screen.source, "login.xml");
        assert.doesNotMatch(screen.source, /\//);
    });

    it("names the file and what it saw when the format is neither", async () => {
        const path = await tempFile("notes.txt", "just some notes");

        await assert.rejects(loadScreen(path), /notes\.txt is neither a page source nor a saved screen/);
    });

    it("does not leak the containing directory in that error either", async () => {
        const path = await tempFile("notes.txt", "just some notes");

        await assert.rejects(loadScreen(path), (error: Error) => {
            assert.doesNotMatch(error.message, /tmp|appium-audit-/);

            return true;
        });
    });
});
