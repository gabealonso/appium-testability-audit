/** LIBS */
import { rankElement } from "./rank.ts";
import type { Context } from "./rank.ts";
import type { Audit, MobileElement, Platform, Screen, Verdict } from "./types.ts";

/** FUNCTIONS */

/**
 * Whether an element is worth auditing at all.
 *
 * A page source is mostly scaffolding: layout containers that hold other things and that
 * no test will ever address. What a mobile test actually targets is anything it can tap
 * **or assert on** — and on mobile the assertions are half the suite, so a label with no
 * identifier is as much of a problem as an unreachable button.
 *
 * @param element - The element to consider.
 * @returns True when a test could plausibly target it.
 */
const isWorthAuditing = (element: MobileElement): boolean => {
    if (!element.displayed) {
        return false;
    }

    return Boolean(
        element.clickable ||
            element.resourceId ||
            element.accessibilityId ||
            element.text ||
            element.label
    );
};

/**
 * Count how many times each value occurs across the screen, per attribute.
 *
 * Counted over **every** element, not just the audited ones: a second button still
 * collides with the first even when it carries no text of its own and is filtered out of
 * the report.
 *
 * @param elements - Every element the reader found.
 * @returns One occurrence map per attribute.
 */
const countValues = (
    elements: MobileElement[]
): Record<"resourceId" | "accessibilityId" | "label" | "text" | "className", Map<string, number>> => {
    const counts = {
        resourceId: new Map<string, number>(),
        accessibilityId: new Map<string, number>(),
        label: new Map<string, number>(),
        text: new Map<string, number>(),
        className: new Map<string, number>(),
    };

    const bump = (map: Map<string, number>, value: string | null): void => {
        if (value) {
            map.set(value, (map.get(value) ?? 0) + 1);
        }
    };

    for (const element of elements) {
        bump(counts.resourceId, element.resourceId);
        bump(counts.accessibilityId, element.accessibilityId);
        bump(counts.label, element.label);
        bump(counts.text, element.text);
        bump(counts.className, element.className);
    }

    return counts;
};

/**
 * Build the occurrence context for one element.
 *
 * A count of 0 means the element has no value for that attribute, which the ranking
 * treats the same as not usable — it only ever asks whether a candidate it already built
 * is unique.
 *
 * @param element - The element being ranked.
 * @param counts - The occurrence maps for the whole screen.
 * @returns How many elements share each of this element's values.
 */
const contextFor = (
    element: MobileElement,
    counts: ReturnType<typeof countValues>
): Context => {
    const look = (map: Map<string, number>, value: string | null): number =>
        value ? (map.get(value) ?? 0) : 0;

    return {
        resourceId: look(counts.resourceId, element.resourceId),
        accessibilityId: look(counts.accessibilityId, element.accessibilityId),
        label: look(counts.label, element.label),
        text: look(counts.text, element.text),
        className: look(counts.className, element.className),
    };
};

/**
 * Audit a screen: keep the elements a test could target, rank each one, then count and
 * score the result.
 *
 * The score is the share of elements that are **stable**. Counting "has some locator"
 * would score every screen 100% — every element has an XPath — and measure nothing.
 *
 * @param platform - Which platform the page source came from.
 * @param source - Where it came from, for the report header.
 * @param elements - Every element the reader found.
 * @returns The audit, with the ranked elements ordered worst-first.
 */
const auditScreen = (platform: Platform, source: string, elements: MobileElement[]): Audit => {
    const counts = countValues(elements);

    // Worst first, by verdict rather than by tier: an ambiguous `resource-id` is tier 1,
    // so sorting on tier alone buries the real problems underneath everything that is
    // fine. The report exists to surface what needs fixing.
    const severity: Record<Verdict, number> = {
        unreachable: 0,
        ambiguous: 1,
        fragile: 2,
        stable: 3,
    };

    const ranked = elements
        .filter(isWorthAuditing)
        .map((element) => rankElement(element, contextFor(element, counts)))
        .sort((a, b) => severity[a.verdict] - severity[b.verdict] || b.tier - a.tier);

    const verdicts: Record<Verdict, number> = {
        stable: 0,
        ambiguous: 0,
        fragile: 0,
        unreachable: 0,
    };

    for (const item of ranked) {
        verdicts[item.verdict] += 1;
    }

    return {
        platform,
        source,
        ranked,
        counts: verdicts,
        score: ranked.length === 0 ? 100 : Math.round((verdicts.stable / ranked.length) * 100),
    };
};

/**
 * Validate an unknown value as a screen, so a hand-edited or truncated file fails with a
 * clear message instead of a `TypeError` deep in the ranking.
 *
 * @param value - The parsed JSON.
 * @returns The value as a screen.
 */
const parseScreen = (value: unknown): Screen => {
    const shape = value as Partial<Screen> | null;

    if (!shape || (shape.platform !== "android" && shape.platform !== "ios")) {
        throw new Error('That is not a screen. `platform` must be "android" or "ios".');
    }

    if (!Array.isArray(shape.elements)) {
        throw new Error("That is not a screen. `elements` must be an array.");
    }

    shape.elements.forEach((element, index) => {
        if (typeof element?.className !== "string" || typeof element?.xpath !== "string") {
            throw new Error(
                `Element ${index} is missing \`className\` or \`xpath\`; every element needs both.`
            );
        }

        if (element.platform !== shape.platform) {
            throw new Error(
                `Element ${index} says it is ${element.platform}, but the screen is ` +
                    `${shape.platform}.`
            );
        }
    });

    return {
        platform: shape.platform,
        source: typeof shape.source === "string" ? shape.source : "(unknown)",
        readAt: typeof shape.readAt === "string" ? shape.readAt : "",
        elements: shape.elements,
    };
};

/** EXPORTS */
export { isWorthAuditing, countValues, contextFor, auditScreen, parseScreen };
