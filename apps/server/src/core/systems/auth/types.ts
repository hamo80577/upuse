import type { AppUser, AppUserRole, ScanoRole } from "../../../types/models.js";

export interface UserSystemAssignment {
  enabled?: boolean;
  role?: string;
}

export interface UserAccessAssignmentInput {
  upuseAccess: boolean;
  upuseRole?: AppUserRole;
  scanoAccessRole?: ScanoRole;
}

export interface UserAccessSyncInput {
  userId: number;
  name: string;
  systemAssignments: Partial<Record<string, UserSystemAssignment>>;
}

export interface UserAccessRevocationCheckInput {
  userId: number;
  currentAssignments: Partial<Record<string, UserSystemAssignment>>;
  nextAssignments: Partial<Record<string, UserSystemAssignment>>;
  errorOverrides?: Partial<Record<string, { message: string; code: string }>>;
}

export interface SystemUserAccessSynchronizer {
  systemId: string;
  syncUserAccess(input: UserAccessSyncInput): void;
  assertUserAccessRevocationAllowed?(input: UserAccessRevocationCheckInput): void;
}

export interface SystemUserAccessAssignmentResolver {
  systemId: string;
  resolveUserAccessAssignment(input: UserAccessAssignmentInput): UserSystemAssignment;
}

export interface SystemUserProjection {
  systemId: string;
  enrichUser(user: AppUser): AppUser;
}
