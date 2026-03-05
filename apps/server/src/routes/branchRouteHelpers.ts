export function parseBranchIdParam(rawId: unknown) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

export function buildDeleteBranchResponse(
  rawId: unknown,
  removeBranch: (id: number) => number,
) {
  const id = parseBranchIdParam(rawId);
  if (!id) {
    return {
      statusCode: 400,
      body: { ok: false, message: "Invalid branch id" },
    };
  }

  const deletedCount = removeBranch(id);
  if (!deletedCount) {
    return {
      statusCode: 404,
      body: { ok: false, message: "Branch not found" },
    };
  }

  return {
    statusCode: 200,
    body: { ok: true },
  };
}
