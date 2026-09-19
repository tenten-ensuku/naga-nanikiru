// Browsers need single byte ranges to seek through the public introduction video.
// Keep the upstream asset streamed, including when skipping to a distant offset.
// The ASSETS binding omits Content-Length. These immutable asset sizes are checked
// against every published guide MP4 in the regression test when media changes.
const videoLengths = {
  '/guide/video/minkiru-promo-portrait-v295.mp4': 10991682,
  '/guide/video/minkiru-promo-landscape-v295.mp4': 11713226
};

function byteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value?.trim() || '');
  if (!match || (!match[1] && !match[2])) return null;
  const a = match[1] ? Number(match[1]) : null;
  const b = match[2] ? Number(match[2]) : null;
  if ((a !== null && !Number.isSafeInteger(a)) || (b !== null && !Number.isSafeInteger(b))) return null;
  if (a === null) return b > 0 && size > 0 ? { start: Math.max(0, size - b), end: size - 1 } : false;
  if (a >= size || (b !== null && b < a)) return false;
  return { start: a, end: b === null ? size - 1 : Math.min(b, size - 1) };
}

function matchesIfRange(value, headers) {
  if (!value) return true;
  if (value.startsWith('"')) return value === headers.get('ETag');
  if (value.startsWith('W/')) return false;
  const requested = Date.parse(value), modified = Date.parse(headers.get('Last-Modified') || '');
  return Number.isFinite(requested) && Number.isFinite(modified) && modified <= requested;
}

function takeRange(body, start, length) {
  const reader = body.getReader();
  let offset = 0, remaining = length;
  return new ReadableStream({
    async pull(controller) {
      try {
        while (remaining > 0) {
          const { value, done } = await reader.read();
          if (done) throw new Error('Video asset ended before its declared length');
          const skip = Math.max(0, start - offset); offset += value.byteLength;
          if (skip >= value.byteLength) continue;
          const chunk = value.subarray(skip, skip + remaining);
          remaining -= chunk.byteLength; controller.enqueue(chunk);
          if (remaining === 0) { controller.close(); await reader.cancel(); }
          return;
        }
      } catch (error) { controller.error(error); await reader.cancel(error); }
    },
    cancel(reason) { return reader.cancel(reason); }
  });
}

function fixedLength(body, length) {
  // Workers derives Content-Length from this stream, not a manually set header.
  if (typeof globalThis.FixedLengthStream !== 'function') return body;
  const stream = new globalThis.FixedLengthStream(length);
  body.pipeTo(stream.writable).catch(() => {}); // The readable carries pipe errors to the client.
  return stream.readable;
}

export async function guideVideo(request, assets) {
  const sourceHeaders = new Headers(request.headers);
  sourceHeaders.delete('Range'); sourceHeaders.delete('If-Range');
  // Get metadata and a stream even for HEAD; cancelling below avoids reading it.
  const source = await assets.fetch(new Request(request.url, { method: 'GET', headers: sourceHeaders }));
  if (source.status !== 200) return source;
  const headers = new Headers(source.headers);
  const declaredLength = Number(headers.get('Content-Length'));
  const size = declaredLength > 0 ? declaredLength : videoLengths[new URL(request.url).pathname];
  if (!Number.isSafeInteger(size) || size <= 0 || !source.body) return source;
  headers.set('Content-Length', String(size));
  headers.set('Accept-Ranges', 'bytes');
  // Partial responses are per request; don't let an intermediary store one as a full asset.
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  if (request.method === 'HEAD') {
    await source.body.cancel();
    return new Response(null, { headers });
  }
  const range = matchesIfRange(request.headers.get('If-Range'), headers)
    ? byteRange(request.headers.get('Range'), size) : null;
  if (range === false) {
    await source.body.cancel();
    headers.set('Content-Range', `bytes */${size}`); headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  if (!range) return new Response(fixedLength(source.body, size), { headers });
  const length = range.end - range.start + 1;
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('Content-Length', String(length));
  return new Response(fixedLength(takeRange(source.body, range.start, length), length), { status: 206, headers });
}
