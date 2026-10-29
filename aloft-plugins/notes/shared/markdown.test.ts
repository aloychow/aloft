import { describe, expect, it } from "vitest";
import {
  frontmatterList,
  inlineTags,
  noteTags,
  parseWikiLink,
  previewText,
  sanitizeTitle,
  splitFrontmatter,
  toReadingMarkdown,
  wikiLinks,
} from "./markdown";

describe("front matter", () => {
  it("splits front matter from the body", () => {
    expect(splitFrontmatter("---\ntitle: x\n---\nBody")).toEqual({
      frontmatter: "title: x",
      body: "Body",
    });
    expect(splitFrontmatter("No front matter")).toEqual({
      frontmatter: null,
      body: "No front matter",
    });
  });

  it("reads list values in inline, comma and block form", () => {
    expect(frontmatterList("tags: [a, 'b', \"#c\"]", "tags")).toEqual(["a", "b", "c"]);
    expect(frontmatterList("tags: a, b", "tags")).toEqual(["a", "b"]);
    expect(frontmatterList("tags:\n  - a\n  - b\nother: x", "tags")).toEqual(["a", "b"]);
    expect(frontmatterList("other: x", "tags")).toEqual([]);
  });
});

describe("tags", () => {
  it("finds inline tags outside code and skips headings and numbers", () => {
    expect(
      inlineTags("# Heading\nText #idea and #work/project, not #123\n`#code`\n```\n#fence\n```"),
    ).toEqual(["idea", "work/project"]);
  });

  it("merges front matter and inline tags case-insensitively", () => {
    expect(noteTags("---\ntags: [Idea]\n---\n#idea #other")).toEqual(["Idea", "other"]);
  });
});

describe("wiki-links", () => {
  it("parses targets, headings, block references and aliases", () => {
    expect(parseWikiLink("Note#Heading|label", false)).toEqual({
      target: "Note",
      heading: "Heading",
      alias: "label",
      embed: false,
    });
    expect(parseWikiLink("Folder/Note^block", true)).toEqual({
      target: "Folder/Note",
      heading: "block",
      alias: null,
      embed: true,
    });
  });

  it("finds links outside code blocks", () => {
    expect(wikiLinks("[[A]] `[[B]]` ![[C.png]]").map((link) => link.target)).toEqual([
      "A",
      "C.png",
    ]);
  });

  it("renders links as bold text for the reading view", () => {
    expect(toReadingMarkdown("---\na: 1\n---\nSee [[A|this]] and [[B#Part]] ![[img.png]]")).toBe(
      "See **this** and **B › Part** *[embedded: img.png]*",
    );
  });
});

describe("text helpers", () => {
  it("builds a plain preview", () => {
    expect(previewText("# Title\n- [ ] Task with [[Link|label]] and **bold**")).toBe(
      "Title Task with label and bold",
    );
  });

  it("skips a leading heading that repeats the title", () => {
    expect(previewText("# Laksa\n\nCoconut milk", 160, "Laksa")).toBe("Coconut milk");
    expect(previewText("# Other\n\nCoconut milk", 160, "Laksa")).toBe("Other Coconut milk");
  });

  it("sanitizes titles into file names", () => {
    expect(sanitizeTitle("  Plan: Q4/Q1?  ")).toBe("Plan Q4 Q1");
    expect(sanitizeTitle("...")).toBe("Untitled");
    expect(sanitizeTitle("")).toBe("Untitled");
  });
});
