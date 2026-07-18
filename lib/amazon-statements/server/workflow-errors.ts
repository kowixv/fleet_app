import "server-only";

import type { AmazonWorkflowErrorShape, AmazonWorkflowResult, AmazonWorkflowStage } from "./workflow-types";

export class AmazonWorkflowError extends Error {
  readonly code: string;
  readonly stage?: AmazonWorkflowStage;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(shape: AmazonWorkflowErrorShape) {
    super(shape.message);
    this.name = "AmazonWorkflowError";
    this.code = shape.code;
    this.stage = shape.stage;
    this.retryable = shape.retryable ?? false;
    this.details = shape.details;
  }

  toShape(): AmazonWorkflowErrorShape {
    return {
      code: this.code,
      message: this.message,
      stage: this.stage,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

export function workflowOk<T>(data: T): AmazonWorkflowResult<T> {
  return { ok: true, data };
}

export function workflowFail(error: unknown, stage?: AmazonWorkflowStage): AmazonWorkflowResult<never> {
  if (error instanceof AmazonWorkflowError) return { ok: false, error: error.toShape() };
  return {
    ok: false,
    error: {
      code: "unexpected_error",
      message: error instanceof Error ? error.message : String(error),
      stage,
      retryable: false,
    },
  };
}

export function assertWorkflow(condition: unknown, shape: AmazonWorkflowErrorShape): asserts condition {
  if (!condition) throw new AmazonWorkflowError(shape);
}
