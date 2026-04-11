import {
  listSystemUserAccessAssignmentResolvers,
  listSystemUserAccessSynchronizers,
} from "../../../core/systems/auth/registry/index.js";
import type { AppUserRole, ScanoRole } from "../../../types/models.js";
import type { UserAccessAssignmentInput } from "../../../core/systems/auth/types.js";

function buildAssignments(input: UserAccessAssignmentInput) {
  return Object.fromEntries(
    listSystemUserAccessAssignmentResolvers().map((resolver) => [
      resolver.systemId,
      resolver.resolveUserAccessAssignment(input),
    ]),
  );
}

export function syncUserAccess(params: {
  userId: number;
  name: string;
  upuseAccess: boolean;
  upuseRole?: AppUserRole;
  scanoAccessRole?: ScanoRole;
}) {
  const systemAssignments = buildAssignments(params);
  for (const synchronizer of listSystemUserAccessSynchronizers()) {
    synchronizer.syncUserAccess({
      userId: params.userId,
      name: params.name,
      systemAssignments,
    });
  }
}

export function assertUserAccessRevocationAllowed(params: {
  userId: number;
  currentUpuseAccess: boolean;
  currentUpuseRole?: AppUserRole;
  currentScanoAccessRole?: ScanoRole;
  nextUpuseAccess: boolean;
  nextUpuseRole?: AppUserRole;
  nextScanoAccessRole?: ScanoRole;
  errorOverrides?: Partial<Record<string, { message: string; code: string }>>;
}) {
  const currentAssignments = buildAssignments({
    upuseAccess: params.currentUpuseAccess,
    upuseRole: params.currentUpuseRole,
    scanoAccessRole: params.currentScanoAccessRole,
  });
  const nextAssignments = buildAssignments({
    upuseAccess: params.nextUpuseAccess,
    upuseRole: params.nextUpuseRole,
    scanoAccessRole: params.nextScanoAccessRole,
  });

  for (const synchronizer of listSystemUserAccessSynchronizers()) {
    synchronizer.assertUserAccessRevocationAllowed?.({
      userId: params.userId,
      currentAssignments,
      nextAssignments,
      errorOverrides: params.errorOverrides,
    });
  }
}
