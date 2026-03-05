import axios from "axios";

export async function getWithRetry(url: string, headers: Record<string, string>, retries = 2) {
  let lastErr: any;
  for (let index = 0; index <= retries; index += 1) {
    try {
      return await axios.get(url, { headers, timeout: 15000 });
    } catch (error: any) {
      lastErr = error;
      const status = error?.response?.status;
      const backoff = 400 * Math.pow(2, index);
      if (status === 429 || status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}
