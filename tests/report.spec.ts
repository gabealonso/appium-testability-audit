/** LIBS */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adviceFor } from "../src/advice.ts";
import { auditScreen } from "../src/audit.ts";
import { renderJson, renderReport } from "../src/report.ts";
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
    xpath: "//android.widget.TextView[1]",
    ...over,
});

/** A Compose screen that never opted into testTagsAsResourceId. */
const composeish = (id: string): MobileElement =>
    element({ className: "android.view.View", accessibilityId: id, clickable: false });

/** TEST SUITE */
describe("advice - Compose", () => {
    it("spots a Compose screen whose testTags never reached Appium", () => {
        const audit = auditScreen("android", "s", [
            composeish("banner"),
            composeish("title"),
            composeish("row"),
        ]);

        const advice = adviceFor(audit);

        assert.match(advice[0]?.title ?? "", /Enable testTagsAsResourceId \(3 elements/);
        assert.match(advice[0]?.detail ?? "", /Modifier\.semantics \{ testTagsAsResourceId = true \}/);
    });

    it("stays quiet below the threshold, so one generic view is not a diagnosis", () => {
        const audit = auditScreen("android", "s", [composeish("banner"), composeish("title")]);

        assert.equal(
            adviceFor(audit).some((item) => /testTagsAsResourceId/.test(item.title)),
            false
        );
    });

    it("stays quiet when a bare resource-id proves the app already opted in", () => {
        // Found against a real app that had testTagsAsResourceId enabled. Compose merges
        // semantics, so the same logical element shows up twice: a parent carrying the
        // merged content-desc and a child carrying the resource-id. The parents alone look
        // untagged, and the advice told the team to enable what they had already enabled.
        const audit = auditScreen("android", "s", [
            composeish("todo_input_field"),
            composeish("add_todo_button"),
            composeish("webview_button"),
            // `blue_banner`, not `com.example.app:id/blue_banner`: a bare id can only have
            // come from a testTag, so the opt-in is demonstrably there.
            element({ resourceId: "blue_banner", text: "Todo App" }),
        ]);

        assert.equal(
            adviceFor(audit).some((item) => /testTagsAsResourceId/.test(item.title)),
            false
        );
    });

    it("does not count an element that a sibling already exposes at tier 1", () => {
        // The count has to mean what it says: these two are addressable through the node
        // that carries the resource-id, so the opt-in would buy nothing for them.
        const audit = auditScreen("android", "s", [
            composeish("add_todo_button"),
            composeish("webview_button"),
            composeish("only_untagged_one"),
            element({ resourceId: "com.example.app:id/add_todo_button" }),
            element({ resourceId: "com.example.app:id/webview_button" }),
        ]);

        assert.equal(
            adviceFor(audit).some((item) => /testTagsAsResourceId/.test(item.title)),
            false,
            "only one element is genuinely uncovered, which is below the threshold"
        );
    });

    it("still fires when the tags really never arrived", () => {
        // The rule must not become so cautious that it stops finding the real problem: no
        // resource-id anywhere, three generic views with a content-desc.
        const audit = auditScreen("android", "s", [
            composeish("banner"),
            composeish("title"),
            composeish("row"),
        ]);

        assert.match(adviceFor(audit)[0]?.title ?? "", /Enable testTagsAsResourceId/);
    });

    it("does not fire when the resource-ids are already there", () => {
        const audit = auditScreen("android", "s", [
            element({ resourceId: "com.example.app:id/a", accessibilityId: "a" }),
            element({ resourceId: "com.example.app:id/b", accessibilityId: "b" }),
            element({ resourceId: "com.example.app:id/c", accessibilityId: "c" }),
        ]);

        assert.deepEqual(adviceFor(audit), []);
    });
});

describe("advice - iOS identifiers", () => {
    it("calls out names that merely echo the label", () => {
        const ios = (name: string): MobileElement =>
            element({
                platform: "ios",
                className: "XCUIElementTypeButton",
                accessibilityId: name,
                label: name,
            });

        const audit = auditScreen("ios", "s", [ios("Save"), ios("Cancel")]);
        const advice = adviceFor(audit);

        assert.match(
            advice.find((item) => /accessibility identifier/.test(item.title))?.title ?? "",
            /2 iOS elements/
        );
    });
});

describe("report - readable output", () => {
    const audit = auditScreen("android", "the login screen", [
        element({ resourceId: "com.example.app:id/ok", accessibilityId: "ok" }),
        element({ className: "android.widget.ImageView" }),
        element({ className: "android.widget.ImageView" }),
    ]);

    const output = renderReport(audit);

    it("leads with the platform, source and score", () => {
        assert.match(output, /Platform: android/);
        assert.match(output, /Source: the login screen/);
        assert.match(output, /Score: 33% stable/);
    });

    it("shows all four counts", () => {
        assert.match(output, /Stable: 1 · Ambiguous: 0 · Fragile: 0 · Unreachable: 2/);
    });

    it("shows the strategy and the value a test would actually use", () => {
        assert.match(output, /id\s+com\.example\.app:id\/ok/);
    });

    it("shortens the class name so the table stays readable", () => {
        assert.match(output, /ImageView/);
        assert.doesNotMatch(output, /android\.widget\.ImageView\s+xpath/);
    });

    it("says so when there is nothing to fix", () => {
        const clean = renderReport(
            auditScreen("android", "s", [element({ resourceId: "com.example.app:id/only" })])
        );

        assert.match(clean, /Every element has a unique locator/);
    });

    it("handles a screen with nothing a test could target", () => {
        const empty = renderReport(auditScreen("android", "s", []));

        assert.match(empty, /No element on this screen could be targeted/);
    });
});

describe("report - JSON output", () => {
    const parsed = JSON.parse(
        renderJson(
            auditScreen("android", "s", [
                element({ resourceId: "com.example.app:id/ok" }),
                element({
                    className: "android.widget.ImageView",
                    xpath: "//android.widget.ImageView[1]",
                }),
                element({
                    className: "android.widget.ImageView",
                    xpath: "//android.widget.ImageView[2]",
                }),
            ])
        )
    );

    it("carries the score, counts and advice", () => {
        assert.equal(parsed.score, 33);
        assert.equal(parsed.counts.unreachable, 2);
        assert.ok(Array.isArray(parsed.advice));
    });

    it("keeps one entry per element, worst first", () => {
        assert.equal(parsed.elements.length, 3);
        assert.equal(parsed.elements[0].verdict, "unreachable");
    });

    it("includes the xpath so a human can still find the element", () => {
        assert.match(parsed.elements[0].xpath, /ImageView/);
    });
});
