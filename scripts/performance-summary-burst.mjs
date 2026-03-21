function getArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function requireArg(name) {
  const value = getArg(name);
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

async function runBurst({ url, cookie, requests, concurrency }) {
  const latencies = [];
  let successes = 0;
  let failures = 0;
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= requests) return;

      const startedAt = performance.now();
      try {
        const response = await fetch(url, {
          headers: {
            Cookie: cookie,
          },
        });
        const elapsed = performance.now() - startedAt;
        latencies.push(elapsed);

        if (!response.ok) {
          failures += 1;
          console.error(`[summary] request ${current + 1} failed with ${response.status}`);
          await response.text().catch(() => "");
          continue;
        }

        successes += 1;
        await response.arrayBuffer();
      } catch (error) {
        failures += 1;
        console.error(`[summary] request ${current + 1} error:`, error instanceof Error ? error.message : error);
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, () => worker()),
  );

  latencies.sort((left, right) => left - right);
  const mean = latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0;
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0;

  return {
    requests,
    concurrency,
    successes,
    failures,
    minMs: latencies[0] ?? 0,
    meanMs: mean,
    p95Ms: p95,
    maxMs: latencies[latencies.length - 1] ?? 0,
  };
}

async function main() {
  const baseUrl = getArg("base", "http://localhost:8080");
  const cookie = requireArg("cookie");
  const requests = Number(getArg("requests", "50"));
  const concurrency = Number(getArg("concurrency", "10"));

  const result = await runBurst({
    url: `${baseUrl.replace(/\/$/, "")}/api/performance`,
    cookie,
    requests,
    concurrency,
  });

  console.log(JSON.stringify({
    target: "performance-summary",
    baseUrl,
    ...result,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
