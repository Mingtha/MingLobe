// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminConfigRouter } from '../adminConfig';

const { mockIsAdmin, mockService } = vi.hoisted(() => ({
  mockIsAdmin: vi.fn(),
  mockService: {
    deleteMember: vi.fn(),
    listMembers: vi.fn(async () => []),
    setMemberDisabled: vi.fn(),
  },
}));

vi.mock('@/database/utils/providerConfigOwner', () => ({ isProviderConfigAdmin: mockIsAdmin }));
vi.mock('@/server/services/memberAdmin', () => mockService);

const caller = adminConfigRouter.createCaller({ userId: 'caller' } as any);

describe('adminConfig member management', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects every member operation from a non-admin', async () => {
    mockIsAdmin.mockResolvedValue(false);

    await expect(caller.listMembers()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.setMemberDisabled({ disabled: true, userId: 'u' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.deleteMember({ userId: 'u' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mockService.setMemberDisabled).not.toHaveBeenCalled();
    expect(mockService.deleteMember).not.toHaveBeenCalled();
  });

  it('passes the admin as the acting account', async () => {
    mockIsAdmin.mockResolvedValue(true);

    await caller.deleteMember({ userId: 'u' });

    expect(mockService.deleteMember).toHaveBeenCalledWith(expect.anything(), 'caller', 'u');
  });
});
