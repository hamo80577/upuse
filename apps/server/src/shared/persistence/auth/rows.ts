export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: string;
  passwordHash: string;
  active: number;
  createdAt: string;
  upuseAccess: number;
  isPrimaryAdmin: number;
  scanoMemberId?: number | null;
  scanoRole?: string | null;
}

export interface SessionRow {
  token: string;
  userId: number;
  expiresAt: string;
  createdAt: string;
}
