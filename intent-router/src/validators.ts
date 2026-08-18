import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { RouterError } from "./errors.js";

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "校验失败"}`)
    .join("; ");
}

export class SchemaValidator<T> {
  private readonly validateFunction: ValidateFunction<T>;

  constructor(schema: Record<string, unknown>) {
    const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: true });
    this.validateFunction = ajv.compile<T>(schema);
  }

  validate(value: unknown, code: string): T {
    const candidate = structuredClone(value);
    if (!this.validateFunction(candidate)) {
      throw new RouterError(formatErrors(this.validateFunction.errors), code, 400);
    }
    return candidate as T;
  }
}
