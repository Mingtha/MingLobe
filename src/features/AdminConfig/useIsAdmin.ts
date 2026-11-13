import { useClientDataSWR } from '@/libs/swr';
import { adminConfigService } from '@/services/adminConfig';

/** Whether the signed-in account is the `ADMIN_EMAIL` admin; `undefined` while loading. */
export const useIsAdmin = () => {
  const { data } = useClientDataSWR(['adminConfig', 'status'], () =>
    adminConfigService.getAdminStatus(),
  );

  return data?.isAdmin;
};
