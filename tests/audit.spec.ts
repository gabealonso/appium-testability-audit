/** LIBS */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditScreen, isWorthAuditing, parseScreen } from "../src/audit.ts";
import type { MobileElement } from "../src/types.ts";

/** FIXTURES */
const element = (over: Partial<MobileElement> = {}): MobileElement => ({
    platform: "android",
    className: "android.widget.TextView",
    resourceId: null,
    accessibilityId: null,
    label: null,
    text: null,
    clickable: false,
    displayed: true,
    xpath: "//android.widget.TextView[1]",
    ...over,
});

/** TEST SUITE */
describe("audit - what is worth auditing", () => {
    it("skips anything not displayed", () => {
        assert.equal(isWorthAuditing(element({ text: "Hi", displayed: false })), false);
    });

    it("skips layout scaffolding with nothing to target", () => {
        assert.equal(isWorthAuditing(element({ className: "android.widget.LinearLayout" })), false);
    });

    it("keeps what a test can tap", () => {
        assert.ok(isWorthAuditing(element({ clickable: true })));
    });

    it("keeps what a test can assert on, even when it is not tappable", () => {
        // Half of a mobile suite is assertions on labels, so a label with no identifier
        // is as much of a problem as an unreachable button.
        assert.ok(isWorthAuditing(element({ text: "No todos yet" })));
        assert.ok(isWorthAuditing(element({ accessibilityId: "empty_state" })));
        assert.ok(isWorthAuditing(element({ resourceId: "com.example.app:id/empty" })));
    });
});

describe("audit - counting and scoring", () => {
    it("scores the share that is stable, not the share that has any locator", () => {
        const audit = auditScreen("android", "test", [
            element({ resourceId: "com.example.app:id/a", clickable: true }),
            element({ className: "android.widget.ImageView", clickable: true }),
            element({ className: "android.widget.ImageView", clickable: true }),
        ]);

        // Every element has an xpath, so "has a locator" would score 100%.
        assert.equal(audit.score, 33);
        assert.deepEqual(audit.counts, {
            stable: 1,
            ambiguous: 0,
            fragile: 0,
            unreachable: 2,
        });
    });

    it("counts collisions across the whole screen, including filtered-out elements", () => {
        // The second button carries nothing of its own and is filtered out of the report,
        // but it still collides with the first one's class.
        const audit = auditScreen("android", "test", [
            element({ className: "android.widget.Button", text: "Save", clickable: true }),
            element({ className: "android.widget.Button", clickable: false }),
        ]);

        assert.equal(audit.ranked.length, 1);
        assert.equal(audit.ranked[0]?.strategy, "-android uiautomator", "class name was not unique");
    });

    it("puts the problems first, not the best tiers first", () => {
        const audit = auditScreen("android", "test", [
            element({ resourceId: "com.example.app:id/ok", accessibilityId: "ok", clickable: true }),
            element({ className: "android.widget.ImageView", clickable: true }),
            element({ className: "android.widget.ImageView", clickable: true }),
            element({ resourceId: "com.example.app:id/row", text: "same", clickable: true }),
            element({ resourceId: "com.example.app:id/row", text: "same", clickable: true }),
        ]);

        assert.deepEqual(
            audit.ranked.map((item) => item.verdict),
            ["unreachable", "unreachable", "ambiguous", "ambiguous", "stable"]
        );
    });

    it("scores an empty screen 100 rather than dividing by zero", () => {
        const audit = auditScreen("android", "test", []);

        assert.equal(audit.score, 100);
        assert.equal(audit.ranked.length, 0);
    });
});

describe("audit - reading a screen file", () => {
    const valid = {
        platform: "android",
        source: "s",
        readAt: "2026-08-20T12:00:00.000Z",
        elements: [element()],
    };

    it("accepts a well-formed screen", () => {
        assert.equal(parseScreen(valid).elements.length, 1);
    });

    it("defaults a missing source rather than failing", () => {
        assert.equal(parseScreen({ ...valid, source: undefined }).source, "(unknown)");
    });

    it("rejects an unknown platform", () => {
        assert.throws(() => parseScreen({ ...valid, platform: "windows" }), /must be "android" or "ios"/);
    });

    it("rejects elements that are not an array", () => {
        assert.throws(() => parseScreen({ ...valid, elements: {} }), /must be an array/);
    });

    it("names the element that is missing a required field", () => {
        assert.throws(
            () => parseScreen({ ...valid, elements: [element(), { className: "x" }] }),
            /Element 1 is missing/
        );
    });

    it("catches an element whose platform disagrees with the screen", () => {
        assert.throws(
            () => parseScreen({ ...valid, elements: [element({ platform: "ios" })] }),
            /says it is ios, but the screen is android/
        );
    });
});
