'use client';

import { ActionIcon, Button, Flexbox, Input, Text, toast } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ArticleSkeleton } from '@/components/Skeleton';
import { AdminOnly } from '@/features/AdminConfig';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { useClientDataSWR } from '@/libs/swr';
import { adminConfigService } from '@/services/adminConfig';

import MemberList from './MemberList';

const ALLOWLIST_KEY = ['adminConfig', 'signupAllowlist'];

/** Admin-managed list of emails and domains that may sign up. */
const SignupAllowlist = () => {
  const { t } = useTranslation('setting');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const {
    data: entries,
    isLoading,
    mutate,
  } = useClientDataSWR(ALLOWLIST_KEY, () => adminConfigService.getSignupAllowlist());

  const save = async (next: string[]) => {
    setSaving(true);
    try {
      await mutate(adminConfigService.updateSignupAllowlist(next), { revalidate: false });
      return true;
    } catch {
      toast.error(t('members.allowlist.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    const value = draft.trim();
    if (!value) return;
    if (await save([...(entries ?? []), value])) setDraft('');
  };

  return (
    <Form.Group
      collapsible={false}
      desc={t('members.allowlist.desc')}
      title={t('members.allowlist.title')}
      variant="filled"
    >
      <Flexbox gap={12} paddingBlock={8}>
        <Flexbox horizontal gap={8}>
          <Input
            placeholder={t('members.allowlist.placeholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={add}
          />
          <Button disabled={!draft.trim()} loading={saving} type="primary" onClick={add}>
            {t('members.allowlist.add')}
          </Button>
        </Flexbox>
        {isLoading ? (
          <ArticleSkeleton rows={2} />
        ) : entries?.length ? (
          entries.map((entry) => (
            <Flexbox horizontal align="center" justify="space-between" key={entry}>
              <Text>{entry}</Text>
              <ActionIcon
                aria-label={t('members.allowlist.remove')}
                disabled={saving}
                icon={Trash2}
                size="small"
                title={t('members.allowlist.remove')}
                onClick={() => save(entries.filter((item) => item !== entry))}
              />
            </Flexbox>
          ))
        ) : (
          <Text type="secondary">{t('members.allowlist.empty')}</Text>
        )}
      </Flexbox>
    </Form.Group>
  );
};

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');

  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.members')} />}
      <AdminOnly>
        <Flexbox gap={24}>
          <MemberList />
          <SignupAllowlist />
        </Flexbox>
      </AdminOnly>
    </>
  );
};

export default Page;
