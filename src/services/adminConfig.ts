import { lambdaClient } from '@/libs/trpc/client';

/** Site-wide settings owned by the `ADMIN_EMAIL` account. */
class AdminConfigService {
  deleteMember = (userId: string) => lambdaClient.adminConfig.deleteMember.mutate({ userId });

  getAdminStatus = () => lambdaClient.adminConfig.getAdminStatus.query();

  getSignupAllowlist = () => lambdaClient.adminConfig.getSignupAllowlist.query();

  listMembers = () => lambdaClient.adminConfig.listMembers.query();

  setMemberDisabled = (userId: string, disabled: boolean) =>
    lambdaClient.adminConfig.setMemberDisabled.mutate({ disabled, userId });

  updateSignupAllowlist = (entries: string[]) =>
    lambdaClient.adminConfig.updateSignupAllowlist.mutate({ entries });
}

export const adminConfigService = new AdminConfigService();
