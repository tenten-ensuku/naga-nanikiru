import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);

test("V210 keeps the PC comment composer reachable inside the scrollable comment pane", async () => {
  const html = await readFile(indexUrl, "utf8");
  const desktopLayout = html.match(/@media \(min-width: 801px\) \{[\s\S]*?\.page\.desktop-split-layout:not\(\.menu-active\) > \.below-note/)?.[0] || "";

  assert.match(html, /const APP_VERSION = 222;/);
  assert.match(desktopLayout, /V210: keep the comment composer reachable/);
  assert.match(desktopLayout, /\.page\.desktop-split-layout:not\(\.menu-active\) > \.comments-panel/);
  assert.match(desktopLayout, /overflow-y: auto;/);
  assert.match(desktopLayout, /overflow-x: hidden;/);
  assert.match(desktopLayout, /overscroll-behavior: contain;/);
  assert.match(desktopLayout, /scrollbar-gutter: stable;/);
  assert.match(desktopLayout, /\.comments-panel \.comments-scroll[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/);
  assert.match(html, /id="commentSubmitButton"[^>]*>コメントを追加<\/button>/);
});
