/** LIBS */
import type { MobileElement, Platform, Screen } from "./types.ts";

/** One element as it appears in the XML, before it is normalized. */
interface RawNode {
    /** The tag name. `node` for a UiAutomator dump, the class name for Appium's source. */
    tag: string;
    attributes: Record<string, string>;
    /** 1-based position among siblings sharing the same effective class, for the XPath. */
    xpath: string;
}

/** FUNCTIONS */

/**
 * Read the next `name="value"` pair, starting at `from`.
 *
 * Attribute values are read between their quotes, never by scanning for the next `>`:
 * a page source routinely contains `text="a > b"` or `content-desc="Save & exit"`, and a
 * naive scan cuts the tag in half there. This is the one place a hand-rolled reader earns
 * its keep or fails.
 *
 * @param xml - The whole document.
 * @param from - Index to start scanning at.
 * @returns The pair and where it ended, or null when the tag's attributes are done.
 */
const readAttribute = (
    xml: string,
    from: number
): { name: string; value: string; end: number } | null => {
    let index = from;

    while (index < xml.length && /\s/.test(xml[index] ?? "")) {
        index += 1;
    }

    const nameStart = index;

    while (index < xml.length && /[^\s=/>]/.test(xml[index] ?? "")) {
        index += 1;
    }

    if (index === nameStart || xml[index] !== "=") {
        return null;
    }

    const name = xml.slice(nameStart, index);
    const quote = xml[index + 1];

    if (quote !== '"' && quote !== "'") {
        return null;
    }

    const valueStart = index + 2;
    const valueEnd = xml.indexOf(quote, valueStart);

    if (valueEnd === -1) {
        return null;
    }

    return { name, value: xml.slice(valueStart, valueEnd), end: valueEnd + 1 };
};

/** The five entities a page source can carry. Nothing else appears in practice. */
const ENTITIES: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
};

/**
 * Decode XML entities, including numeric ones.
 *
 * @param value - The raw attribute value.
 * @returns The decoded text.
 */
const decode = (value: string): string => {
    return value
        .replace(/&(?:amp|lt|gt|quot|apos);/g, (match) => ENTITIES[match] ?? match)
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
};

/**
 * Wrappers that are structure rather than elements anyone would test.
 *
 * `hierarchy` is the root of an Android page source; `AppiumAUT` is the envelope Appium
 * puts around an iOS one.
 */
const ROOT_WRAPPERS = new Set(["hierarchy", "AppiumAUT"]);

/**
 * Wrappers that must not appear in an XPath either.
 *
 * `hierarchy` **is** the document root on Android, so `/hierarchy[1]/...` is a valid
 * absolute path there and has to stay. `AppiumAUT` is not part of the app tree: Appium's
 * iOS XPath engine is rooted at `XCUIElementTypeApplication`, so any path that leads with
 * `/AppiumAUT[1]/` matches nothing — the one locator we hand out as a last resort would be
 * the one locator guaranteed to fail.
 */
const PATH_TRANSPARENT = new Set(["AppiumAUT"]);

/**
 * Walk a page source and yield every element, in document order, with its XPath.
 *
 * **This is not a general XML parser, and does not try to be.** It reads UiAutomator and
 * XCUITest dumps: machine-generated, no CDATA, no namespaces, no comments beyond the
 * declaration. What it does handle properly is the part that actually bites — quoted
 * attribute values containing `>`, `<` or quotes.
 *
 * It accepts both shapes a page source comes in: `<node class="android.widget.Button">`
 * from `uiautomator dump`, and `<android.widget.Button>` from Appium's own
 * `getPageSource()`, where the class *is* the tag.
 *
 * @param xml - The page source.
 * @returns Every element node found.
 */
const readNodes = (xml: string): RawNode[] => {
    const nodes: RawNode[] = [];
    /** Per depth, how many siblings of each effective class have been seen. */
    const siblingCounts: Map<string, number>[] = [new Map()];
    /** One entry per open element; `null` for a wrapper that contributes no XPath step. */
    const pathStack: (string | null)[] = [];
    let index = 0;

    while (index < xml.length) {
        const open = xml.indexOf("<", index);

        if (open === -1) {
            break;
        }

        // Skip the declaration and anything else that is not an element.
        if (/[?!]/.test(xml[open + 1] ?? "")) {
            index = xml.indexOf(">", open) + 1;
            continue;
        }

        // A closing tag pops one level.
        if (xml[open + 1] === "/") {
            siblingCounts.pop();
            pathStack.pop();
            index = xml.indexOf(">", open) + 1;
            continue;
        }

        let cursor = open + 1;
        const tagStart = cursor;

        while (cursor < xml.length && /[^\s/>]/.test(xml[cursor] ?? "")) {
            cursor += 1;
        }

        const tag = xml.slice(tagStart, cursor);
        const attributes: Record<string, string> = {};

        for (;;) {
            const attribute = readAttribute(xml, cursor);

            if (!attribute) {
                break;
            }

            attributes[attribute.name] = decode(attribute.value);
            cursor = attribute.end;
        }

        while (cursor < xml.length && xml[cursor] !== ">") {
            cursor += 1;
        }

        const selfClosing = xml[cursor - 1] === "/";
        // `class` when the tag is a generic `node`, the tag itself otherwise.
        const effective = attributes["class"] || tag;
        const level = siblingCounts[siblingCounts.length - 1] ?? new Map();
        const position = (level.get(effective) ?? 0) + 1;
        level.set(effective, position);

        const transparent = PATH_TRANSPARENT.has(tag);
        const step = `${effective}[${position}]`;
        const ancestors = pathStack.filter((entry): entry is string => entry !== null);
        const xpath = `/${[...ancestors, step].join("/")}`;

        if (!ROOT_WRAPPERS.has(tag)) {
            nodes.push({ tag, attributes, xpath });
        }

        if (!selfClosing) {
            siblingCounts.push(new Map());
            pathStack.push(transparent ? null : step);
        }

        index = cursor + 1;
    }

    return nodes;
};

/**
 * Whether a `bounds` rectangle has any area.
 *
 * A UiAutomator dump has no `displayed` attribute — Appium's own page source adds that,
 * but `uiautomator dump` does not — so a zero-area rectangle is the only signal that an
 * element is not on screen.
 *
 * @param bounds - The raw `bounds` value, e.g. `[0,0][1080,2400]`.
 * @returns True when the element occupies space.
 */
const hasArea = (bounds: string | undefined): boolean => {
    const match = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(bounds ?? "");

    if (!match) {
        // No bounds at all: assume it is on screen rather than silently dropping it.
        return true;
    }

    return Number(match[3]) > Number(match[1]) && Number(match[4]) > Number(match[2]);
};

/**
 * Decide which platform a page source came from, by what its nodes look like.
 *
 * @param nodes - The parsed nodes.
 * @returns The platform.
 */
const detectPlatform = (nodes: RawNode[]): Platform => {
    const iosish = nodes.filter((node) => node.tag.startsWith("XCUIElementType")).length;

    return iosish > nodes.length / 2 ? "ios" : "android";
};

/** Read an attribute, treating the empty string as absent. */
const attr = (node: RawNode, name: string): string | null => {
    const value = node.attributes[name];

    return value === undefined || value === "" ? null : value;
};

/**
 * Normalize one raw node into the shape the audit consumes.
 *
 * @param node - The raw node.
 * @param platform - Which platform the page source came from.
 * @returns The normalized element.
 */
const normalize = (node: RawNode, platform: Platform): MobileElement => {
    const className = attr(node, "class") ?? attr(node, "type") ?? node.tag;

    if (platform === "android") {
        return {
            platform,
            className,
            resourceId: attr(node, "resource-id"),
            accessibilityId: attr(node, "content-desc"),
            label: null,
            // `hint` is a text field's placeholder — the only thing some inputs show.
            text: attr(node, "text") ?? attr(node, "hint"),
            clickable: node.attributes["clickable"] === "true",
            displayed:
                node.attributes["displayed"] === undefined
                    ? hasArea(node.attributes["bounds"])
                    : node.attributes["displayed"] === "true",
            xpath: node.xpath,
        };
    }

    return {
        platform,
        className,
        resourceId: null,
        accessibilityId: attr(node, "name"),
        label: attr(node, "label"),
        text: attr(node, "value"),
        // XCUITest reports no `clickable`; anything enabled and hittable can be tapped.
        clickable: node.attributes["enabled"] === "true",
        displayed:
            node.attributes["visible"] === undefined
                ? true
                : node.attributes["visible"] === "true",
        xpath: node.xpath,
    };
};

/**
 * Read a page source into a screen.
 *
 * @param xml - The page source, from `uiautomator dump` or `driver.getPageSource()`.
 * @param source - Where it came from, for the report header.
 * @returns The screen, ready to audit.
 */
const readPageSource = (xml: string, source: string): Screen => {
    const nodes = readNodes(xml);

    if (nodes.length === 0) {
        throw new Error(
            "No elements found. Is this an Appium page source or a `uiautomator dump`?"
        );
    }

    const platform = detectPlatform(nodes);

    return {
        platform,
        source,
        readAt: new Date().toISOString(),
        elements: nodes.map((node) => normalize(node, platform)),
    };
};

/** EXPORTS */
export { readAttribute, decode, readNodes, hasArea, detectPlatform, normalize, readPageSource };
