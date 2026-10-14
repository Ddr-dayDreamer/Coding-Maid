import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { handleFetchWebpage } from "../tools/handler/fetch-webpage-handler";
import type { ToolExecutionContext } from "../tools/types";

const server = createServer((request, response) => {
  if (request.url === "/redirect") {
    response.writeHead(302, { Location: "/docs" }).end();
    return;
  }

  const paragraph = "Godot documentation content with a [reference]. ";
  const longText = paragraph.repeat(400);
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`
    <html>
      <head><title>Godot Documentation</title></head>
      <body>
        <nav>Navigation that should not be included</nav>
        <main>
          <h1>Getting Started</h1>
          <p>${longText}</p>
          <pre><code>extends Node
func _ready():
    print("Hello")
</code></pre>
          <a href="/classes/class_node.html">Node reference</a>
        </main>
        <footer>Footer that should not be included</footer>
      </body>
    </html>
  `);
});

const context: ToolExecutionContext = {
  sessionId: "fetch-webpage-test",
  projectRoot: "",
  toolCall: {
    id: "fetch-webpage-test-call",
    type: "function",
    function: { name: "fetch_webpage", arguments: "{}" },
  },
};

let baseUrl = "";
const listening = new Promise<void>((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Failed to start test server.");
    baseUrl = `http://127.0.0.1:${address.port}`;
    resolve();
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("follows documentation redirects, extracts the article, and supports continuation", async () => {
  await listening;
  const first = await handleFetchWebpage({ url: `${baseUrl}/redirect`, limit: 500 }, context);
  assert.equal(first.ok, true);
  assert.match(first.output ?? "", /^# Godot Documentation\n\nSource: http:\/\/127\.0\.0\.1:\d+\/docs/);
  assert.match(first.output ?? "", /Getting Started/);
  assert.doesNotMatch(first.output ?? "", /Navigation that should not be included/);
  assert.doesNotMatch(first.output ?? "", /Footer that should not be included/);

  const firstMetadata = first.metadata as { nextOffset?: number | null; chars?: number };
  assert.ok(typeof firstMetadata.nextOffset === "number" && firstMetadata.nextOffset <= 500);
  assert.ok((firstMetadata.chars ?? 0) > 500);

  const second = await handleFetchWebpage(
    { url: `${baseUrl}/redirect`, offset: firstMetadata.nextOffset, limit: 30_000 },
    context
  );
  assert.equal(second.ok, true);
  assert.equal((second.metadata as { offset: number }).offset, firstMetadata.nextOffset);
  assert.equal((second.metadata as { nextOffset: number | null }).nextOffset, null);
  assert.match(first.output ?? "", /More content available/);
  assert.match(second.output ?? "", /Source: http:\/\/127\.0\.0\.1:\d+\/docs/);
  assert.match(second.output ?? "", /\[Node reference\]\(http:\/\/127\.0\.0\.1:\d+\/classes\/class_node\.html\)/);
});

test("preserves code indentation in documentation pages", async () => {
  await listening;
  const result = await handleFetchWebpage({ url: `${baseUrl}/docs`, limit: 30_000 }, context);
  assert.equal(result.ok, true);
  assert.match(result.output ?? "", /```[\s\S]*func _ready\(\):\n    print\("Hello"\)[\s\S]*```/);
});
