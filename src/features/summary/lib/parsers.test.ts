import { describe, test, expect } from "vitest";
import { parseActionItems, parseTldr } from "./parsers";

describe("Markdown Parsers", () => {
  describe("parseActionItems", () => {
    test("matches standard dash unchecked items and trims spacing", () => {
      const input = "  - [ ]   Clean up supervisor stdout logging \n- [ ] Fix memory leaks";
      const result = parseActionItems(input);
      expect(result).toEqual([
        "Clean up supervisor stdout logging",
        "Fix memory leaks",
      ]);
    });

    test("matches asterisk unchecked items", () => {
      const input = "* [ ] Investigate PipeWire loops\n* [ ] Check windows credentials";
      const result = parseActionItems(input);
      expect(result).toEqual([
        "Investigate PipeWire loops",
        "Check windows credentials",
      ]);
    });

    test("filters out already-checked action items", () => {
      const input = "- [x] Done item\n- [ ] Pending item\n* [X] Checked with capital X";
      const result = parseActionItems(input);
      expect(result).toEqual(["Pending item"]);
    });

    test("returns empty array for empty or unrelated content", () => {
      expect(parseActionItems("")).toEqual([]);
      expect(parseActionItems("No checkboxes here\nJust text.")).toEqual([]);
    });

    test("handles 10 real-world fixture outlines correctly", () => {
      const fixtures = [
        { text: "- [ ] Task 1", count: 1 },
        { text: "* [ ] Task A\n- [ ] Task B", count: 2 },
        { text: "No items", count: 0 },
        { text: "- [x] Done\n- [ ] Todo", count: 1 },
        { text: "  * [ ] Spaced task  ", count: 1 },
        { text: "- [ ] \n- [ ] Real task", count: 1 }, // Empty tasks filtered by Boolean
        { text: "Some notes\n- [ ] Call client\nSome other details", count: 1 },
        { text: "### Action Items\n- [ ] Task 1\n* [ ] Task 2\n- [x] Task 3", count: 2 },
        { text: "- [ ] 1\n- [ ] 2\n- [ ] 3\n- [ ] 4", count: 4 },
        { text: "* [ ] Multi\nline\ntask", count: 1 }, // Matches only the check line
      ];

      fixtures.forEach((fix, index) => {
        const result = parseActionItems(fix.text);
        expect(result.length).toBe(fix.count);
      });
    });
  });

  describe("parseTldr", () => {
    test("extracts standard case-insensitive ## TL;DR section", () => {
      const input = "Some intro\n## TL;DR\nThis is the core summary.\n## Next Section";
      const result = parseTldr(input);
      expect(result).toBe("This is the core summary.");
    });

    test("extracts ## tldr section with different casings", () => {
      const input = "## tldr\nSecondary summary content.";
      const result = parseTldr(input);
      expect(result).toBe("Secondary summary content.");
    });

    test("returns null if no TL;DR section is found", () => {
      const input = "# Meeting notes\nNothing else.";
      const result = parseTldr(input);
      expect(result).toBeNull();
    });

    test("preserves internal line breaks but trims outer spacing", () => {
      const input = "## TL;DR\nLine 1\nLine 2\n\n";
      const result = parseTldr(input);
      expect(result).toBe("Line 1\nLine 2");
    });
  });
});
