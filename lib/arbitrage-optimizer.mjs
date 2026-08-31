function uniquePositive(values, maximum) {
  return [
    ...new Set(
      values
        .filter((value) => value > 0n && value <= maximum)
        .map((value) => value.toString()),
    ),
  ]
    .map(BigInt)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Finds the strongest executable result within a fixed permission.
 * The bounded refinement keeps browser relay and keeper decisions identical.
 * @param {bigint} maximum
 * @param {(amount: bigint) => Promise<any>} evaluate
 * @param {{ coarseSteps?: number, refinementRounds?: number, onEvaluationError?: (error: unknown, amount: bigint) => "ignore" | "throw" }} options
 */
export async function maximizeExecutable(maximum, evaluate, options = {}) {
  if (maximum <= 0n) return null;
  const coarseSteps = options.coarseSteps ?? 7;
  const refinementRounds = options.refinementRounds ?? 3;
  const cache = new Map();
  let best = null;

  async function consider(amount) {
    if (amount <= 0n || amount > maximum) return;
    const key = amount.toString();
    let result = cache.get(key);
    if (result === undefined) {
      try {
        result = await evaluate(amount);
      } catch (error) {
        const action = options.onEvaluationError?.(error, amount) ?? "ignore";
        if (action === "throw") throw error;
        result = null;
      }
      cache.set(key, result);
    }
    if (result && (!best || result.net > best.net)) best = result;
  }

  if (maximum <= 64n) {
    for (let amount = 1n; amount <= maximum; amount += 1n)
      await consider(amount);
    return best;
  }

  const coarse = [];
  for (let index = 1; index <= coarseSteps; index += 1) {
    coarse.push((maximum * BigInt(index)) / BigInt(coarseSteps));
  }
  coarse.push(maximum / 16n, maximum / 32n);
  await Promise.all(
    uniquePositive(coarse, maximum).map((amount) => consider(amount)),
  );
  if (!best) return null;

  let radius = maximum / BigInt(coarseSteps);
  for (let round = 0; round < refinementRounds && radius > 1n; round += 1) {
    const center = best.amount;
    await Promise.all([
      consider(center > radius / 2n ? center - radius / 2n : 1n),
      consider(
        center + radius / 2n <= maximum ? center + radius / 2n : maximum,
      ),
    ]);
    radius /= 2n;
  }
  return best;
}
