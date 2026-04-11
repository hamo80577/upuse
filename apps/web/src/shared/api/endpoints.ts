import { authApi } from "./authClient";
import { healthApi } from "./healthClient";

export {
  AUTH_FORBIDDEN_EVENT,
  AUTH_UNAUTHORIZED_EVENT,
  describeApiError,
} from "./httpClient";

export const api = {
  ...healthApi,
  ...authApi,
};
