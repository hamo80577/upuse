import "express-serve-static-core";
import type { AppUser } from "./models.js";

declare module "express-serve-static-core" {
  interface Request {
    authUser?: AppUser;
    authSessionToken?: string;
  }
}
