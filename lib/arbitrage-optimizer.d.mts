export type ExecutableCandidate = {
  amount: bigint;
  net: bigint;
};

export function maximizeExecutable<T extends ExecutableCandidate>(
  maximum: bigint,
  evaluate: (amount: bigint) => Promise<T | null>,
  options?: {
    coarseSteps?: number;
    refinementRounds?: number;
    onEvaluationError?: (
      error: unknown,
      amount: bigint,
    ) => "ignore" | "throw";
  },
): Promise<T | null>;
