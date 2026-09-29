import { matchGlob } from "./glob.js";

describe("matchGlob", () => {
  it("matches nested markdown and not a longer suffix", () => {
    expect(matchGlob("docs/**/*.md", "docs/guide.md")).toBe(true);
    expect(matchGlob("docs/**/*.md", "docs/adr/0001.md")).toBe(true);
    expect(matchGlob("docs/**/*.md", "docs/guide.mdx")).toBe(false);
    expect(matchGlob("docs/**/*.md", "README.md")).toBe(false);
  });

  it("matches a directory tree without swallowing a sibling prefix", () => {
    expect(
      matchGlob(
        "docs/interviews/panel-2/**",
        "docs/interviews/panel-2/slides/slides.md",
      ),
    ).toBe(true);
    expect(
      matchGlob(
        "docs/interviews/panel-2/**",
        "docs/interviews/machinify-panel-2-project-plan.md",
      ),
    ).toBe(false);
  });

  it("matches draft filenames anywhere and ignores published siblings", () => {
    expect(matchGlob("**/_*.mdx", "src/content/works/_draft.mdx")).toBe(true);
    expect(matchGlob("**/_*.mdx", "_draft.mdx")).toBe(true);
    expect(matchGlob("**/_*.mdx", "src/content/works/nike-snkrs-juno.mdx")).toBe(
      false,
    );
  });

  it("treats a trailing slash as a path prefix", () => {
    expect(matchGlob("docs/interviews/panel-2/", "docs/interviews/panel-2/README.md")).toBe(
      true,
    );
    expect(matchGlob("docs/interviews/panel-2/", "docs/interviews/other.md")).toBe(
      false,
    );
  });
});
