import { db } from "../config/db.js";
import type { ScanoRole, ScanoTeamMember } from "../types/models.js";

interface ScanoTeamMemberRow {
  id: number;
  name: string;
  linkedUserId: number;
  role: string;
  active: number;
  createdAt: string;
  updatedAt: string;
  linkedUserName: string;
  linkedUserEmail: string;
}

interface TeamMemberInput {
  linkedUserId: number;
  role: ScanoRole;
  active: boolean;
}

export class ScanoTeamStoreError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ScanoTeamStoreError";
    this.status = status;
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSqliteError(error: unknown) {
  const message = typeof (error as { message?: unknown })?.message === "string"
    ? (error as { message: string }).message
    : "";

  if (/unique constraint failed/i.test(message) && message.includes("scano_team_members.linkedUserId")) {
    throw new ScanoTeamStoreError("This app user is already linked to another Scano team member.", 409, "SCANO_TEAM_LINKED_USER_EXISTS");
  }

  throw error;
}

function getLinkedUserOrThrow(userId: number) {
  const row = db.prepare<[number], { id: number; active: number; name: string }>(`
    SELECT id, active, name
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!row) {
    throw new ScanoTeamStoreError("Linked app user was not found.", 404, "SCANO_TEAM_LINKED_USER_NOT_FOUND");
  }
  if (row.active !== 1) {
    throw new ScanoTeamStoreError("Linked app user must be active.", 409, "SCANO_TEAM_LINKED_USER_INACTIVE");
  }

  return row;
}

function normalizeScanoRole(role: string): ScanoRole {
  return role === "team_lead" ? "team_lead" : "scanner";
}

function mapRow(row: ScanoTeamMemberRow): ScanoTeamMember {
  return {
    id: row.id,
    name: row.name,
    linkedUserId: row.linkedUserId,
    linkedUserName: row.linkedUserName,
    linkedUserEmail: row.linkedUserEmail,
    role: normalizeScanoRole(row.role),
    active: row.active === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getJoinedMemberQuery(whereClause = "") {
  return `
    SELECT
      m.id,
      m.name,
      m.linkedUserId,
      m.role,
      m.active,
      m.createdAt,
      m.updatedAt,
      u.name AS linkedUserName,
      u.email AS linkedUserEmail
    FROM scano_team_members m
    INNER JOIN users u ON u.id = m.linkedUserId
    ${whereClause}
    ORDER BY LOWER(m.name) ASC, m.id ASC
  `;
}

function getScanoTeamMemberOrThrow(id: number) {
  const row = db.prepare<[number], ScanoTeamMemberRow>(getJoinedMemberQuery("WHERE m.id = ?")).get(id);
  if (!row) {
    throw new ScanoTeamStoreError("Scano team member not found.", 404, "SCANO_TEAM_MEMBER_NOT_FOUND");
  }
  return mapRow(row);
}

export function listScanoTeamMembers() {
  const rows = db.prepare<[], ScanoTeamMemberRow>(getJoinedMemberQuery()).all();
  return rows.map(mapRow);
}

export function createScanoTeamMember(input: TeamMemberInput) {
  const linkedUser = getLinkedUserOrThrow(input.linkedUserId);

  const createdAt = nowIso();
  try {
    const result = db.prepare(`
      INSERT INTO scano_team_members (
        name,
        linkedUserId,
        role,
        active,
        createdAt,
        updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      linkedUser.name.trim(),
      input.linkedUserId,
      input.role,
      input.active ? 1 : 0,
      createdAt,
      createdAt,
    );

    return getScanoTeamMemberOrThrow(Number(result.lastInsertRowid));
  } catch (error) {
    normalizeSqliteError(error);
    throw error;
  }
}

export function updateScanoTeamMember(id: number, input: TeamMemberInput) {
  getScanoTeamMemberOrThrow(id);
  const linkedUser = getLinkedUserOrThrow(input.linkedUserId);

  try {
    db.prepare(`
      UPDATE scano_team_members
      SET
        name = ?,
        linkedUserId = ?,
        role = ?,
        active = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      linkedUser.name.trim(),
      input.linkedUserId,
      input.role,
      input.active ? 1 : 0,
      nowIso(),
      id,
    );
  } catch (error) {
    normalizeSqliteError(error);
    throw error;
  }

  return getScanoTeamMemberOrThrow(id);
}

export function deleteScanoTeamMember(id: number) {
  getScanoTeamMemberOrThrow(id);

  const assignedTask = db.prepare<[number], { taskId: number }>(`
    SELECT taskId
    FROM scano_task_assignees
    WHERE teamMemberId = ?
    LIMIT 1
  `).get(id);

  if (assignedTask) {
    throw new ScanoTeamStoreError("This Scano team member is already assigned to tasks. Deactivate or reassign them first.", 409, "SCANO_TEAM_MEMBER_ASSIGNED");
  }

  db.prepare<[number]>("DELETE FROM scano_team_members WHERE id = ?").run(id);
}
