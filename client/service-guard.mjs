export function createServiceGuard({ fetchImpl = globalThis.fetch, onRestricted = () => {} } = {}) {
  let blocked = false, probeInFlight = null;
  function unavailable() {
    const error = new Error("保存サービスは利用制限中です。通信を停止しています。");
    error.status = 402;
    error.code = "SERVICE_RESTRICTED";
    return error;
  }
  return {
    available: () => !blocked,
    async fetch(input, options) {
      if (blocked) throw unavailable();
      const response = await fetchImpl(input, options);
      if (response.status === 402) {
        blocked = true;
        onRestricted({ status: 402 });
      }
      return response;
    },
    // Only an explicit retry action calls this. No timer or retry loop.
    probe(url, publishableKey) {
      if (probeInFlight) return probeInFlight;
      probeInFlight = (async () => {
        try {
          const response = await fetchImpl(url, { headers: { apikey: publishableKey }, cache: "no-store", signal: AbortSignal.timeout(10000) });
          if (response.status === 200) { blocked = false; return true; }
          if (response.status === 402) { blocked = true; onRestricted({ status: 402 }); }
          return false;
        } catch { return false; }
        finally { probeInFlight = null; }
      })();
      return probeInFlight;
    }
  };
}
