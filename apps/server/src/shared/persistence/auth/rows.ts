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
}

export interface SessionRow {
  token: string;
  userId: number;
  expiresAt: string;
  createdAt: string;
}
