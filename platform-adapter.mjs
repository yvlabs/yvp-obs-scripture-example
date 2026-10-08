// Inject an operator-owned, pinned official BibleClient. No credential lookup here.
import './display-contract.js';
const { validateDisplay } = globalThis.SurfaceDisplay;

export function createPlatformLoader(bibleClient, allowedSelections, {
  minIntervalMs = 1000, maxCalls = 30, windowMs = 3600000, now = Date.now,
} = {}) {
  if (!bibleClient || typeof bibleClient.getPassageDisplay !== 'function' ||
      !allowedSelections || typeof allowedSelections !== 'object' || Array.isArray(allowedSelections) ||
      !Number.isFinite(minIntervalMs) || minIntervalMs < 0 ||
      !Number.isSafeInteger(maxCalls) || maxCalls < 1 ||
      !Number.isFinite(windowMs) || windowMs <= 0) throw new Error('Invalid adapter configuration');
  const selections = new Map(Object.entries(allowedSelections).map(([name, value]) => {
    const match = typeof value?.passageId === 'string' &&
      /^([A-Z0-9]{3})\.([1-9]\d*)(?:\.([1-9]\d*)(?:-([1-9]\d*))?)?$/.exec(value.passageId);
    if (!name || !Number.isSafeInteger(value?.versionId) || value.versionId <= 0 || !match ||
        value.passageId.length > 64 || (match[4] && Number(match[4]) < Number(match[3])) ||
        match.slice(2).some(part => part && !Number.isSafeInteger(Number(part)))) {
      throw new Error('Invalid selection configuration');
    }
    return [name, Object.freeze({ versionId: value.versionId, passageId: value.passageId })];
  }));
  let busy = false;
  let attempts = [];
  let lastNow = -Infinity;
  return async (name, { signal } = {}) => {
    const selection = selections.get(name);
    if (!selection) throw new Error('Selection is not configured');
    if (signal?.aborted) throw new Error('Display cancelled');
    // No concurrent requests, queues, automatic retries or content/metadata cache.
    // A timed-out SDK call occupies this slot until it actually settles.
    const time = now();
    if (!Number.isFinite(time) || time < lastNow) throw new Error('Clock unavailable');
    lastNow = time;
    attempts = attempts.filter(value => time - value < windowMs);
    if (busy || attempts.length >= maxCalls ||
        (attempts.length && time - attempts.at(-1) < minIntervalMs)) throw new Error('Request budget unavailable');
    attempts.push(time);
    busy = true;
    try {
      const display = await bibleClient.getPassageDisplay({
        ...selection, includeHeadings: true, includeNotes: true,
      });
      if (signal?.aborted) throw new Error('Display cancelled');
      return validateDisplay(display);
    } catch {
      // SDK failures can embed request URLs/keys. Never forward raw diagnostics.
      throw new Error('Platform display unavailable');
    } finally {
      busy = false;
    }
  };
}
