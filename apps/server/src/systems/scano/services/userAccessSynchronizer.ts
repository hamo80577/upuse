import { db } from "../../../config/db.js";
import type { AppUser, ScanoRole } from "../../../types/models.js";
import type {
  SystemUserAccessAssignmentResolver,
  SystemUserAccessSynchronizer,
  SystemUserProjection,
  UserSystemAssignment,
} from "../../../core/systems/auth/types.js";
import { AuthStoreError } from "../../../shared/persistence/auth/errors.js";
import { nowIso } from "../../../shared/persistence/auth/clock.js";

const SCANO_SYSTEM_ID = "scano";

interface ExistingScanoMemberRow {
  id: number;
}

function getScanoRole(assignment?: UserSystemAssignment) {
  const role = assignment?.role;
  return role === "team_lead" || role === "scanner" ? role as ScanoRole : undefined;
}

function getScanoMemberForUser(userId: number) {
  return db.prepare<[number], { id: number; role: string }>(`
    SELECT id, role
    FROM scano_team_members
    WHERE linkedUserId = ? AND active = 1
  `).get(userId);
}

function syncScanoAccessForUser(userId: number, name: string, scanoAccessRole?: ScanoRole) {
  const existingMember = db.prepare<[number], ExistingScanoMemberRow>(`
    SELECT id
    FROM scano_team_members
    WHERE linkedUserId = ?
  `).get(userId);

  if (scanoAccessRole) {
    if (existingMember) {
      db.prepare(`
        UPDATE scano_team_members
        SET
          name = ?,
          role = ?,
          active = 1,
          updatedAt = ?
        WHERE linkedUserId = ?
      `).run(name, scanoAccessRole, nowIso(), userId);
      return;
    }

    const createdAt = nowIso();
    db.prepare(`
      INSERT INTO scano_team_members (name, linkedUserId, role, active, createdAt, updatedAt)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(name, userId, scanoAccessRole, createdAt, createdAt);
    return;
  }

  if (existingMember) {
    db.prepare(`
      UPDATE scano_team_members
      SET
        name = ?,
        active = 0,
        updatedAt = ?
      WHERE linkedUserId = ?
    `).run(name, nowIso(), userId);
  }
}

function assertNoIncompleteScanoTaskAssignments(userId: number, message: string, code: string) {
  const activeAssignment = db.prepare<[number], { taskId: string }>(`
    SELECT t.id AS taskId
    FROM scano_team_members m
    INNER JOIN scano_task_assignees a
      ON a.teamMemberId = m.id
    INNER JOIN scano_tasks t
      ON t.id = a.taskId
    WHERE m.linkedUserId = ?
      AND t.status IN ('pending', 'in_progress', 'awaiting_review')
    LIMIT 1
  `).get(userId);

  if (activeAssignment) {
    throw new AuthStoreError(message, 409, code);
  }
}

export const scanoUserAccessSynchronizer: SystemUserAccessSynchronizer = {
  systemId: SCANO_SYSTEM_ID,
  syncUserAccess(input) {
    syncScanoAccessForUser(input.userId, input.name, getScanoRole(input.systemAssignments[SCANO_SYSTEM_ID]));
  },
  assertUserAccessRevocationAllowed(input) {
    const currentRole = getScanoRole(input.currentAssignments[SCANO_SYSTEM_ID]);
    const nextRole = getScanoRole(input.nextAssignments[SCANO_SYSTEM_ID]);

    if (currentRole && !nextRole) {
      const override = input.errorOverrides?.[SCANO_SYSTEM_ID];
      assertNoIncompleteScanoTaskAssignments(
        input.userId,
        override?.message ?? "Scano access cannot be removed while this user is assigned to non-completed Scano tasks.",
        override?.code ?? "SCANO_ACCESS_ACTIVE_TASKS",
      );
    }
  },
};

export const scanoUserAccessAssignmentResolver: SystemUserAccessAssignmentResolver = {
  systemId: SCANO_SYSTEM_ID,
  resolveUserAccessAssignment(input) {
    return input.scanoAccessRole
      ? {
          enabled: true,
          role: input.scanoAccessRole,
        }
      : {
          enabled: false,
        };
  },
};

export const scanoUserProjection: SystemUserProjection = {
  systemId: SCANO_SYSTEM_ID,
  enrichUser(user: AppUser) {
    const member = getScanoMemberForUser(user.id);
    const role = getScanoRole(member ? { enabled: true, role: member.role } : undefined);
    if (!member || !role) {
      return user;
    }

    return {
      ...user,
      scanoRole: role,
      scanoMemberId: member.id,
    };
  },
};
