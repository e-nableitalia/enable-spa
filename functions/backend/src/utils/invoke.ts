import crypto from "crypto";

export function getInvokeId(req: any): string {
  const traceHeader = req.rawRequest?.headers["x-cloud-trace-context"];
  if (traceHeader) {
    return traceHeader.split("/")[0];
  }
  return crypto.randomUUID();
}