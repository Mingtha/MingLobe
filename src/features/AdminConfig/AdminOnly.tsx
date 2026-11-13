'use client';

import { Center, Empty } from '@lobehub/ui';
import { ShieldCheck } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsAdmin } from './useIsAdmin';

/** Renders admin-only settings for the admin, and a "contact the admin" notice for everyone else. */
const AdminOnly = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation('setting');
  const isAdmin = useIsAdmin();

  if (isAdmin === undefined) return null;
  if (isAdmin) return children;

  return (
    <Center height="100%" style={{ minHeight: '50vh' }} width="100%">
      <Empty
        description={t('adminConfig.contactAdmin.desc')}
        icon={ShieldCheck}
        style={{ maxWidth: 400 }}
        title={t('adminConfig.contactAdmin.title')}
      />
    </Center>
  );
};

export default AdminOnly;
