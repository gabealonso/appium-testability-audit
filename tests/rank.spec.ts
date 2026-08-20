/** LIBS */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankElement } from "../src/rank.ts";
import type { Context } from "../src/rank.ts";
import type { MobileElement } from "../src/types.ts";

/** FIXTURES */
const android = (over: Partial<MobileElement> = {}): MobileElement => ({
    platform: "android",
    className: "android.widget.Button",
    resourceId: null,
    accessibilityId: null,
    label: null,
    text: null,
    clickable: true,
    displayed: true,
    xpath: "//android.widget.Button[2]",
    ...over,
});

const ios = (over: Partial<MobileElement> = {}): MobileElement => ({
    platform: "ios",
    className: "XCUIElementTypeButton",
    resourceId: null,
    accessibilityId: null,
    label: null,
    text: null,
    clickable: true,
    displayed: true,
    xpath: "//XCUIElementTypeButton[2]",
    ...over,
});

/**
 * Occurrence counts default to 1 — every value unique on the screen — so a test only
 * states the collisions it cares about.
 */
const ctx = (over: Partial<Context> = {}): Context => ({
    resourceId: 1,
    accessibilityId: 1,
    label: 1,
    text: 1,
    className: 1,
    ...over,
});

/** TEST SUITE */
describe("rank - android", () => {
    it("puts resource-id first, above content-desc", () => {
        const ranked = rankElement(
            android({
                resourceId: "com.example.todoapplication:id/add_todo_button",
                accessibilityId: "add_todo_button",
                text: "Add",
            }),
            ctx()
        );

        assert.equal(ranked.tier, 1);
        assert.equal(ranked.strategy, "id");
        assert.equal(ranked.value, "com.example.todoapplication:id/add_todo_button");
        assert.equal(ranked.verdict, "stable");
        assert.match(ranked.reason, /never translated/);
    });

    it("falls to content-desc, still stable but noting it can be localized", () => {
        const ranked = rankElement(android({ accessibilityId: "add_todo_button", text: "Add" }), ctx());

        assert.equal(ranked.tier, 2);
        assert.equal(ranked.strategy, "accessibility id");
        assert.equal(ranked.value, "add_todo_button");
        assert.equal(ranked.verdict, "stable");
        assert.match(ranked.reason, /localized/);
    });

    it("falls to text as a UiSelector, and calls it fragile", () => {
        const ranked = rankElement(android({ text: "Add" }), ctx());

        assert.equal(ranked.tier, 3);
        assert.equal(ranked.strategy, "-android uiautomator");
        assert.equal(ranked.value, 'new UiSelector().text("Add")');
        assert.equal(ranked.verdict, "fragile");
    });

    it("escapes quotes inside a UiSelector so the value stays valid", () => {
        const ranked = rankElement(android({ text: 'Say "hi"' }), ctx());

        assert.equal(ranked.value, 'new UiSelector().text("Say \\"hi\\"")');
    });

    it("uses class name only when it is unique on the screen", () => {
        const ranked = rankElement(android(), ctx());

        assert.equal(ranked.tier, 4);
        assert.equal(ranked.strategy, "class name");
        assert.equal(ranked.value, "android.widget.Button");
        assert.equal(ranked.verdict, "fragile");
    });

    it("calls an element with nothing but a position unreachable", () => {
        const ranked = rankElement(android(), ctx({ className: 3 }));

        assert.equal(ranked.tier, 5);
        assert.equal(ranked.strategy, "xpath");
        assert.equal(ranked.verdict, "unreachable");
        assert.match(ranked.reason, /only its position/);
    });
});

describe("rank - uniqueness beats rank", () => {
    it("prefers a unique content-desc over a resource-id shared by twelve rows", () => {
        // The list-row case: every row's title carries the same resource-id.
        const ranked = rankElement(
            android({
                className: "android.widget.TextView",
                resourceId: "com.example.app:id/row_title",
                accessibilityId: "row_title_milk",
            }),
            ctx({ resourceId: 12, className: 12 })
        );

        assert.equal(ranked.strategy, "accessibility id");
        assert.equal(ranked.value, "row_title_milk");
        assert.equal(ranked.verdict, "stable");
    });

    it("reports ambiguity when nothing is unique, with the count and the fix", () => {
        const ranked = rankElement(
            android({
                className: "android.widget.TextView",
                resourceId: "com.example.app:id/row_title",
                text: "Milk",
            }),
            ctx({ resourceId: 12, text: 12, className: 12 })
        );

        assert.equal(ranked.verdict, "ambiguous");
        assert.equal(ranked.strategy, "id", "it still names the best string");
        assert.match(ranked.reason, /Matches 12 elements/);
        assert.match(ranked.reason, /Combine it with an index/);
    });

    it("prefers a unique class name over an ambiguous identifier", () => {
        // A working locator, however weak, beats one that cannot address the element.
        const ranked = rankElement(
            android({
                className: "android.widget.ProgressBar",
                resourceId: "com.example.app:id/shared",
            }),
            ctx({ resourceId: 4, className: 1 })
        );

        assert.equal(ranked.strategy, "class name");
        assert.equal(ranked.verdict, "fragile");
    });

    it("treats an ambiguous iOS name the same way", () => {
        const ranked = rankElement(
            ios({ className: "XCUIElementTypeCell", accessibilityId: "cell" }),
            ctx({ accessibilityId: 8, className: 8 })
        );

        assert.equal(ranked.verdict, "ambiguous");
        assert.match(ranked.reason, /Matches 8 elements/);
    });
});

describe("rank - ios", () => {
    it("puts accessibility id first, since iOS has no resource-id", () => {
        const ranked = rankElement(ios({ accessibilityId: "add_todo_button", label: "Add" }), ctx());

        assert.equal(ranked.tier, 1);
        assert.equal(ranked.strategy, "accessibility id");
        assert.equal(ranked.verdict, "stable");
    });

    it("demotes a name that merely repeats the label", () => {
        // XCUITest falls `name` back to `label` when no identifier is set, so a name
        // equal to the label is the visible text, not an identifier.
        const ranked = rankElement(ios({ accessibilityId: "Add", label: "Add" }), ctx());

        assert.equal(ranked.tier, 1, "it is still the locator to use");
        assert.equal(ranked.verdict, "fragile", "but it is not a real identifier");
        assert.match(ranked.reason, /visible text rather than a real/);
    });

    it("keeps a name stable when it differs from the label", () => {
        const ranked = rankElement(ios({ accessibilityId: "add_btn", label: "Add" }), ctx());

        assert.equal(ranked.verdict, "stable");
    });

    it("falls to a label predicate", () => {
        const ranked = rankElement(ios({ label: "Add" }), ctx());

        assert.equal(ranked.tier, 2);
        assert.equal(ranked.strategy, "-ios predicate string");
        assert.equal(ranked.value, 'label == "Add"');
        assert.equal(ranked.verdict, "fragile");
    });

    it("falls to a value predicate, noting it changes as soon as anyone types", () => {
        const ranked = rankElement(ios({ className: "XCUIElementTypeTextField", text: "milk" }), ctx());

        assert.equal(ranked.tier, 3);
        assert.equal(ranked.value, 'value == "milk"');
        assert.match(ranked.reason, /as soon as anyone types/);
    });

    it("calls an element with nothing but a position unreachable", () => {
        const ranked = rankElement(ios(), ctx({ className: 3 }));

        assert.equal(ranked.tier, 5);
        assert.equal(ranked.verdict, "unreachable");
    });
});
