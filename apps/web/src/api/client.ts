export {
  AUTH_FORBIDDEN_EVENT,
  AUTH_UNAUTHORIZED_EVENT,
  describeApiError,
} from "../shared/api/httpClient";
import { authApi } from "../shared/api/authClient";
import { healthApi } from "../shared/api/healthClient";
import { opsApi } from "../systems/ops/api/endpoints";
import { scanoApi } from "../systems/scano/api/endpoints";
import { upuseApi } from "../systems/upuse/api/endpoints";

export const api = {
  ...healthApi,
  ...authApi,
  ...upuseApi,
  ...scanoApi,
  ...opsApi,
};
