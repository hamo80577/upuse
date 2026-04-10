import { authApi } from "../../../shared/api/authClient";
import { healthApi } from "../../../shared/api/healthClient";
export {
  AUTH_FORBIDDEN_EVENT,
  AUTH_UNAUTHORIZED_EVENT,
  describeApiError,
} from "../../../shared/api/httpClient";
import { scanoApi } from "./endpoints";

export const api = {
  ...healthApi,
  ...authApi,
  ...scanoApi,
};
