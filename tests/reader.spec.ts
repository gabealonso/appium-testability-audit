/** LIBS */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasArea, readPageSource } from "../src/reader.ts";

/** FIXTURES */

/** A `uiautomator dump`: the class lives in an attribute, the tag is always `node`. */
const DUMP = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node class="android.widget.TextView" resource-id="com.example.app:id/summary" content-desc="Save &amp; exit" text="1 &lt; 2 &gt; 0" bounds="[0,0][1080,120]" clickable="false" />
  <node class="android.widget.EditText" resource-id="" content-desc="" text="" hint="Search todos" bounds="[0,120][1080,240]" clickable="true" />
  <node class="android.widget.ImageView" content-desc="Collapsed" bounds="[540,240][540,240]" clickable="true" />
</hierarchy>`;

/** Appium's own `getPageSource()` on iOS: the class is the tag, wrapped in `AppiumAUT`. */
const IOS_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Todo" label="Todo" enabled="true" visible="true">
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="add_button" label="Add" value="" enabled="true" visible="true" />
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Buy milk" label="Buy milk" enabled="true" visible="false" />
  </XCUIElementTypeApplication>
</AppiumAUT>`;

/** TEST SUITE */
describe("reader - attribute values that break naive parsers", () => {
    const screen = readPageSource(DUMP, "test");

    it("reads a value containing > without cutting the tag in half", () => {
        // The entire reason this reader does not scan for the next `>`. A page source
        // carries user-facing copy, and user-facing copy contains angle brackets.
        assert.equal(screen.elements[0]?.text, "1 < 2 > 0");
    });

    it("decodes named entities", () => {
        assert.equal(screen.elements[0]?.accessibilityId, "Save & exit");
    });

    it("decodes numeric entities, decimal and hex", () => {
        const source = `<hierarchy><node class="X" text="caf&#233; &#x2014; bar" /></hierarchy>`;

        assert.equal(readPageSource(source, "t").elements[0]?.text, "café — bar");
    });

    it("treats an empty attribute as absent, because a dump writes \"\" not nothing", () => {
        assert.equal(screen.elements[1]?.resourceId, null);
        assert.equal(screen.elements[1]?.accessibilityId, null);
    });

    it("falls back to hint, the only text an empty field shows", () => {
        assert.equal(screen.elements[1]?.text, "Search todos");
    });
});

describe("reader - both shapes a page source comes in", () => {
    it("reads the class out of the attribute when the tag is a generic node", () => {
        assert.equal(readPageSource(DUMP, "t").elements[0]?.className, "android.widget.TextView");
    });

    it("reads the class off the tag itself when that is where it lives", () => {
        const screen = readPageSource(IOS_SOURCE, "t");

        assert.equal(screen.elements[1]?.className, "XCUIElementTypeButton");
    });

    it("detects the platform from what the nodes look like", () => {
        assert.equal(readPageSource(DUMP, "t").platform, "android");
        assert.equal(readPageSource(IOS_SOURCE, "t").platform, "ios");
    });

    it("maps iOS attributes onto the shared shape", () => {
        const button = readPageSource(IOS_SOURCE, "t").elements[1];

        assert.equal(button?.accessibilityId, "add_button");
        assert.equal(button?.label, "Add");
        assert.equal(button?.resourceId, null, "iOS has no resource-id");
    });

    it("honours iOS visible=false", () => {
        assert.equal(readPageSource(IOS_SOURCE, "t").elements[2]?.displayed, false);
    });
});

describe("reader - the xpath it hands out as a last resort", () => {
    it("keeps hierarchy, which really is the Android document root", () => {
        assert.equal(
            readPageSource(DUMP, "t").elements[0]?.xpath,
            "/hierarchy[1]/android.widget.TextView[1]"
        );
    });

    it("drops AppiumAUT, which is an envelope and not part of the app tree", () => {
        // Appium's iOS XPath engine is rooted at XCUIElementTypeApplication, so a path
        // leading with /AppiumAUT[1]/ matches nothing at all.
        const screen = readPageSource(IOS_SOURCE, "t");

        assert.equal(
            screen.elements[1]?.xpath,
            "/XCUIElementTypeApplication[1]/XCUIElementTypeButton[1]"
        );
        assert.equal(
            screen.elements.some((element) => element.xpath.includes("AppiumAUT")),
            false
        );
    });

    it("counts siblings per depth, so a second row starts its children at 1 again", () => {
        const nested = `<hierarchy>
            <node class="Row"><node class="Cell" /><node class="Cell" /></node>
            <node class="Row"><node class="Cell" /></node>
        </hierarchy>`;

        assert.deepEqual(
            readPageSource(nested, "t").elements.map((element) => element.xpath),
            [
                "/hierarchy[1]/Row[1]",
                "/hierarchy[1]/Row[1]/Cell[1]",
                "/hierarchy[1]/Row[1]/Cell[2]",
                "/hierarchy[1]/Row[2]",
                "/hierarchy[1]/Row[2]/Cell[1]",
            ]
        );
    });
});

describe("reader - deciding what is on screen", () => {
    it("reads visibility off bounds, because a dump has no displayed attribute", () => {
        // `uiautomator dump` never writes `displayed`; a zero-area rectangle is the only
        // signal left that an element is collapsed.
        assert.equal(readPageSource(DUMP, "t").elements[2]?.displayed, false);
    });

    it("prefers an explicit displayed attribute when Appium provides one", () => {
        const source = `<hierarchy><node class="X" text="Hi" displayed="false" bounds="[0,0][100,100]" /></hierarchy>`;

        assert.equal(readPageSource(source, "t").elements[0]?.displayed, false);
    });

    it("measures a bounds rectangle", () => {
        assert.ok(hasArea("[0,0][1080,2400]"));
        assert.equal(hasArea("[540,1200][540,1200]"), false, "no area at all");
        assert.equal(hasArea("[0,100][1080,100]"), false, "zero height");
        assert.ok(hasArea(undefined), "no bounds: assume on screen rather than drop it");
    });
});

describe("reader - refusing to guess", () => {
    it("says what it expected when handed something that is not a page source", () => {
        assert.throws(() => readPageSource("just some text", "t"), /page source/);
    });
});
