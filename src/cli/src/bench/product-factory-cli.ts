import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import {
  PRODUCT_FACTORY_BENCHMARK_MAX_BYTES,
  ProductFactoryBenchmarkValidationError,
  createProductFactoryBenchmarkReport,
  hashProductFactoryBenchmarkPayload,
  parseProductFactoryBenchmarkReport,
  parseProductFactoryLaneReceipt,
  parseProductFactoryBenchmarkSuite,
  type ProductFactoryBenchmarkReport,
  type ProductFactoryLaneReceipt,
} from "./product-factory.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type ProductFactoryVariant = "baseline" | "candidate";

export interface ProductFactoryCommandOptions {
  productReceipts?: string;
  experimentId?: string;
  variant?: string;
  baselineReport?: string;
  run?: boolean;
}

export interface ProductFactoryStructuralIngestionInput {
  suitePath: string;
  receiptsPath: string;
  experimentId: string;
  variant: ProductFactoryVariant;
  baselineReport?: string;
  run?: boolean;
}

export class ProductFactoryCliInputError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "ProductFactoryCliInputError";
  }
}

function fail(code: string): never {
  throw new ProductFactoryCliInputError(code);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizeProductFactoryError(error: unknown): never {
  if (error instanceof ProductFactoryCliInputError) throw error;
  // Core validation codes are intentionally not surfaced by the CLI. They can
  // reveal structure about untrusted receipt files and are not CLI contracts.
  throw new ProductFactoryCliInputError("PRODUCT_FACTORY_CLI_INPUT_INVALID");
}

export function productFactoryCliErrorCode(error: unknown): string {
  return error instanceof ProductFactoryCliInputError
    ? error.message
    : "PRODUCT_FACTORY_CLI_INPUT_INVALID";
}

/** Validates mode-specific flags without allowing product inputs to invoke a run. */
export function validateProductFactoryCommandOptions(
  options: ProductFactoryCommandOptions,
): void {
  const productMode = options.productReceipts !== undefined;
  const hasProductOnlyOption =
    options.experimentId !== undefined ||
    options.variant !== undefined ||
    options.baselineReport !== undefined;

  if (!productMode) {
    if (hasProductOnlyOption) fail("PRODUCT_FACTORY_CLI_MODE_REQUIRED");
    return;
  }
  if (!hasText(options.productReceipts))
    fail("PRODUCT_FACTORY_CLI_RECEIPTS_REQUIRED");
  if (options.run) fail("PRODUCT_FACTORY_CLI_RUN_CONFLICT");
  if (!hasText(options.experimentId))
    fail("PRODUCT_FACTORY_CLI_EXPERIMENT_REQUIRED");
  if (options.variant !== "baseline" && options.variant !== "candidate") {
    fail("PRODUCT_FACTORY_CLI_VARIANT_INVALID");
  }
  if (options.variant === "candidate" && !hasText(options.baselineReport)) {
    fail("PRODUCT_FACTORY_CLI_BASELINE_REQUIRED");
  }
  if (options.variant === "baseline" && options.baselineReport !== undefined) {
    fail("PRODUCT_FACTORY_CLI_BASELINE_FORBIDDEN");
  }
}

/**
 * Reads only a bounded, regular, non-symlink JSON file. Errors deliberately
 * expose stable codes only: user-provided paths and file contents are unsafe
 * to reproduce in CLI output.
 */
function readBoundedJsonFile(path: string): unknown {
  if (!hasText(path)) fail("PRODUCT_FACTORY_CLI_PATH_INVALID");

  let descriptor: number | undefined;
  try {
    const listed = lstatSync(path);
    if (listed.isSymbolicLink() || !listed.isFile()) {
      fail("PRODUCT_FACTORY_CLI_PATH_INVALID");
    }
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) fail("PRODUCT_FACTORY_CLI_PATH_INVALID");
    if (opened.size > PRODUCT_FACTORY_BENCHMARK_MAX_BYTES) {
      fail("PRODUCT_FACTORY_CLI_SIZE_LIMIT");
    }
    const source = readFileSync(descriptor, "utf8");
    if (
      Buffer.byteLength(source, "utf8") > PRODUCT_FACTORY_BENCHMARK_MAX_BYTES
    ) {
      fail("PRODUCT_FACTORY_CLI_SIZE_LIMIT");
    }
    try {
      const parsed: unknown = JSON.parse(source);
      // The core scanner rejects raw/secrets/deep/oversized JSON before any
      // field is read by this adapter.
      hashProductFactoryBenchmarkPayload(parsed);
      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError)
        fail("PRODUCT_FACTORY_CLI_JSON_INVALID");
      throw error;
    }
  } catch (error) {
    if (error instanceof ProductFactoryCliInputError) throw error;
    if (error instanceof ProductFactoryBenchmarkValidationError)
      return normalizeProductFactoryError(error);
    return fail("PRODUCT_FACTORY_CLI_PATH_INVALID");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function baselineReportSha256(
  baselineReport: string,
  suite: unknown,
  experimentId: string,
): Promise<string> {
  if (SHA256_PATTERN.test(baselineReport)) return baselineReport;

  let parsed: ProductFactoryBenchmarkReport;
  try {
    parsed = await parseProductFactoryBenchmarkReport(
      readBoundedJsonFile(baselineReport),
      suite,
    );
  } catch (error) {
    return normalizeProductFactoryError(error);
  }
  let parsedSuite;
  try {
    parsedSuite = parseProductFactoryBenchmarkSuite(suite);
  } catch (error) {
    return normalizeProductFactoryError(error);
  }
  if (
    parsed.role !== "baseline" ||
    parsed.experimentId !== experimentId ||
    parsed.suiteSha256 !== parsedSuite.suiteSha256
  ) {
    fail("PRODUCT_FACTORY_CLI_BASELINE_INVALID");
  }
  return parsed.reportSha256;
}

function assertSafeOutputTarget(path: string): void {
  if (!hasText(path)) fail("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
  const parent = dirname(path);
  try {
    const listedParent = lstatSync(parent);
    if (listedParent.isSymbolicLink() || !listedParent.isDirectory()) {
      fail("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
    }
    const resolvedParent = realpathSync(parent);
    const realParent = lstatSync(resolvedParent);
    if (realParent.isSymbolicLink() || !realParent.isDirectory()) {
      fail("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
    }
    try {
      const target = lstatSync(path);
      if (target.isSymbolicLink() || !target.isFile()) {
        fail("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
      }
    } catch (error) {
      if (error instanceof ProductFactoryCliInputError) throw error;
      // An absent target is safe; every other target lookup failure is not.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") fail("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
    }
  } catch (error) {
    if (error instanceof ProductFactoryCliInputError) throw error;
    fail("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
  }
}

/** Writes a report without trusting a predictable sibling temp path. */
export function writeProductFactoryReportAtomic(
  outputPath: string,
  report: ProductFactoryBenchmarkReport,
): void {
  assertSafeOutputTarget(outputPath);
  const parent = dirname(outputPath);
  const payload = JSON.stringify(report, null, 2);
  const tempPath = `${outputPath}.product-${randomBytes(24).toString("hex")}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      tempPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeSync(descriptor, payload, undefined, "utf8");
    writeSync(descriptor, "\n", undefined, "utf8");
    const tempStat = fstatSync(descriptor);
    if (!tempStat.isFile()) fail("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
    // fsync the temporary contents before making the report visible.
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    try {
      if (lstatSync(outputPath).isSymbolicLink()) {
        fail("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
      }
    } catch (error) {
      if (error instanceof ProductFactoryCliInputError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        fail("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
      }
    }
    renameSync(tempPath, outputPath);
    const directoryDescriptor = openSync(parent, constants.O_RDONLY);
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (error instanceof ProductFactoryCliInputError) throw error;
    fail("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        fail("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
      }
    }
  }
}

/**
 * Structurally ingests independently produced receipts. This intentionally
 * supplies no ProductEvidenceVerifier: a local CLI cannot attest production
 * evidence, so it can only emit a report requiring trusted host verification.
 */
export async function runProductFactoryStructuralIngestion(
  input: ProductFactoryStructuralIngestionInput,
): Promise<{ report: ProductFactoryBenchmarkReport }> {
  validateProductFactoryCommandOptions({
    productReceipts: input.receiptsPath,
    experimentId: input.experimentId,
    variant: input.variant,
    baselineReport: input.baselineReport,
    run: input.run,
  });

  let suite: unknown;
  let receipts: ProductFactoryLaneReceipt[];
  try {
    suite = readBoundedJsonFile(input.suitePath);
    const receiptsInput = readBoundedJsonFile(input.receiptsPath);
    if (!Array.isArray(receiptsInput) || receiptsInput.length === 0) {
      fail("PRODUCT_FACTORY_CLI_RECEIPTS_INVALID");
    }
    receipts = receiptsInput.map(parseProductFactoryLaneReceipt);
  } catch (error) {
    return normalizeProductFactoryError(error);
  }
  const firstReceipt = receipts[0];
  if (!firstReceipt) fail("PRODUCT_FACTORY_CLI_RECEIPTS_INVALID");

  const baselineReportSha =
    input.variant === "candidate"
      ? await baselineReportSha256(
          input.baselineReport as string,
          suite,
          input.experimentId,
        )
      : null;
  const timestamp = new Date().toISOString();
  let report: ProductFactoryBenchmarkReport;
  try {
    report = await createProductFactoryBenchmarkReport({
      suite,
      experimentId: input.experimentId,
      role: input.variant,
      baselineReportSha256: baselineReportSha,
      runId: firstReceipt.runId,
      startedAt: timestamp,
      endedAt: timestamp,
      providerTopologyFingerprint: firstReceipt.providerTopologyFingerprint,
      settingsFingerprint: firstReceipt.settingsFingerprint,
      evidenceAuthority: firstReceipt.evidenceAuthority,
      receipts,
    });
  } catch (error) {
    return normalizeProductFactoryError(error);
  }

  if (
    report.status !== "UNVERIFIED" ||
    report.productionEvidence === "verified"
  ) {
    fail("PRODUCT_FACTORY_CLI_TRUST_REQUIRED");
  }
  return { report };
}
