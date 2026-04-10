import type { AuthMeResponse, AuthUsersResponse, LoginResponse, UpuseUserAccessPayload } from "../../api/types";
import { requestJson } from "./httpClient";

export const authApi = {
  login: (payload: { email: string; password: string }) =>
    requestJson<LoginResponse>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  me: () => requestJson<AuthMeResponse>("/api/auth/me"),
  logout: () => requestJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  listUsers: () => requestJson<AuthUsersResponse>("/api/auth/users"),
  createUser: (payload: UpuseUserAccessPayload & { password: string }) =>
    requestJson<{ ok: boolean; user: AuthUsersResponse["items"][number] }>("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  updateUser: (id: number, payload: UpuseUserAccessPayload) =>
    requestJson<{ ok: boolean; user: AuthUsersResponse["items"][number] }>(`/api/auth/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  deleteUser: (id: number) =>
    requestJson<{ ok: boolean }>(`/api/auth/users/${id}`, {
      method: "DELETE",
    }),
};
