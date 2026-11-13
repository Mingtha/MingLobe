import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { isProviderConfigAdmin } from '@/database/utils/providerConfigOwner';
import { getSignupAllowlist, setSignupAllowlist } from '@/database/utils/signupAllowlist';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { deleteMember, listMembers, setMemberDisabled } from '@/server/services/memberAdmin';

const adminConfigProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: { isAdmin: await isProviderConfigAdmin(ctx.serverDB, ctx.userId) },
  });
});

const adminOnlyProcedure = adminConfigProcedure.use(async (opts) => {
  if (!opts.ctx.isAdmin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the admin can manage members' });
  }

  return opts.next();
});

/** Site-wide settings owned by the `ADMIN_EMAIL` account. */
export const adminConfigRouter = router({
  getAdminStatus: adminConfigProcedure.query(({ ctx }) => ({ isAdmin: ctx.isAdmin })),

  deleteMember: adminOnlyProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(({ ctx, input }) => deleteMember(ctx.serverDB, ctx.userId, input.userId)),

  getSignupAllowlist: adminOnlyProcedure.query(({ ctx }) => getSignupAllowlist(ctx.serverDB)),

  listMembers: adminOnlyProcedure.query(({ ctx }) => listMembers(ctx.serverDB)),

  setMemberDisabled: adminOnlyProcedure
    .input(z.object({ disabled: z.boolean(), userId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      setMemberDisabled(ctx.serverDB, ctx.userId, input.userId, input.disabled),
    ),

  updateSignupAllowlist: adminOnlyProcedure
    .input(z.object({ entries: z.array(z.string().trim().min(1).max(254)).max(500) }))
    .mutation(({ ctx, input }) => setSignupAllowlist(ctx.serverDB, ctx.userId, input.entries)),
});
