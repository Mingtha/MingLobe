'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Outlet, useParams } from 'react-router';

import { AdminOnly } from '@/features/AdminConfig';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import DesktopLayoutContainer from './_layout/Desktop/Container';
import ProviderListPageComponent from './(list)';
import ProviderDetailPageComponent from './detail';
import ProviderMenu from './ProviderMenu';

// Layout component that wraps provider pages with navigation
export const ProviderLayout = memo(() => {
  const navigate = useWorkspaceAwareNavigate();

  const handleProviderSelect = (providerKey: string) => {
    navigate(`/settings/provider/${providerKey}`);
  };

  return (
    <AdminOnly>
      <Flexbox
        horizontal
        width={'100%'}
        style={{
          maxHeight: '100%',
        }}
      >
        <ProviderMenu mobile={false} onProviderSelect={handleProviderSelect} />
        <DesktopLayoutContainer>
          <Outlet />
        </DesktopLayoutContainer>
      </Flexbox>
    </AdminOnly>
  );
});

ProviderLayout.displayName = 'ProviderLayout';

// Detail page component that receives providerId from route params
export const ProviderDetailPage = memo(() => {
  const params = useParams<{ providerId: string }>();
  const navigate = useWorkspaceAwareNavigate();

  const handleProviderSelect = (providerKey: string) => {
    navigate(`/settings/provider/${providerKey}`);
  };

  return (
    <ProviderDetailPageComponent
      id={params.providerId ?? ''}
      onProviderSelect={handleProviderSelect}
    />
  );
});

ProviderDetailPage.displayName = 'ProviderDetailPage';

// The provider list also renders standalone through the settings tab map
const ProviderListPage = memo((props: { mobile?: boolean }) => (
  <AdminOnly>
    <ProviderListPageComponent {...props} />
  </AdminOnly>
));

ProviderListPage.displayName = 'ProviderListPage';

export default ProviderListPage;
