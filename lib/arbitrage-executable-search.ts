import { maximizeExecutable } from "./arbitrage-optimizer.mjs";
import {
  isArbitrageInfrastructureError,
  isArbitrageRouteUnavailableError,
} from "./arbitrage-execution-errors";

type ExecutableCandidate = {
  amount: bigint;
  net: bigint;
};

export type ArbitrageDirectionSearch<T> = {
  candidate: T | null;
  complete: boolean;
};

export async function searchArbitrageDirection<T extends ExecutableCandidate>(
  maximum: bigint,
  evaluate: (amount: bigint) => Promise<T | null>,
): Promise<ArbitrageDirectionSearch<T>> {
  try {
    const candidate = await maximizeExecutable(maximum, evaluate, {
      onEvaluationError(error) {
        return isArbitrageRouteUnavailableError(error) ? "ignore" : "throw";
      },
    });
    return { candidate, complete: true };
  } catch (error) {
    if (isArbitrageInfrastructureError(error)) {
      return { candidate: null, complete: false };
    }
    throw error;
  }
}
