// Avoid dumping a whole HTML page when a source-structure assertion fails.
export default async function* compactReporter(source) {
  for await (const { type, data } of source) {
    if (type === "test:fail") {
      const cause = data.details?.error?.cause || data.details?.error;
      yield "FAIL " + data.name + " (" + data.file + ":" + data.line + ")\n";
      yield String(cause?.message || "failed").split("\n")[0].slice(0,300) + "\n";
      if (cause?.expected instanceof RegExp) yield "Expected: " + cause.expected + "\n";
    }
    if (type === "test:summary") yield JSON.stringify(data.counts || data) + "\n";
  }
}
