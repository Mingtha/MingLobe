'use client';

import { ActionIcon, Button, confirmModal, Flexbox, Tag, Text, toast } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import dayjs from 'dayjs';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ArticleSkeleton } from '@/components/Skeleton';
import UserAvatar from '@/components/UserAvatar';
import { useClientDataSWR } from '@/libs/swr';
import { adminConfigService } from '@/services/adminConfig';

const MEMBERS_KEY = ['adminConfig', 'members'];

const formatDate = (date: Date | string) => dayjs(date).format('YYYY-MM-DD');

/** Every account on the site; the admin can disable, re-enable or delete the others. */
const MemberList = () => {
  const { t } = useTranslation('setting');
  const [pendingId, setPendingId] = useState<string>();
  const {
    data: members,
    isLoading,
    mutate,
  } = useClientDataSWR(MEMBERS_KEY, () => adminConfigService.listMembers());

  const run = async (userId: string, action: () => Promise<unknown>) => {
    setPendingId(userId);
    try {
      await action();
      await mutate();
    } catch {
      toast.error(t('members.list.actionFailed'));
    } finally {
      setPendingId(undefined);
    }
  };

  return (
    <Form.Group
      collapsible={false}
      desc={t('members.list.desc')}
      title={t('members.list.title')}
      variant="filled"
    >
      <Flexbox gap={16} paddingBlock={8}>
        {isLoading ? (
          <ArticleSkeleton rows={2} />
        ) : (
          members?.map((member) => {
            const name = member.fullName || member.username || member.email || member.id;
            const isAdmin = member.role === 'admin';
            const pending = pendingId === member.id;

            return (
              <Flexbox horizontal align="center" gap={12} key={member.id}>
                <UserAvatar avatar={member.avatar} name={name} size={32} />
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Flexbox horizontal align="center" gap={8}>
                    <Text ellipsis weight={500}>
                      {name}
                    </Text>
                    {isAdmin && <Tag color="processing">{t('members.list.admin')}</Tag>}
                    {member.banned && <Tag color="warning">{t('members.list.disabled')}</Tag>}
                  </Flexbox>
                  <Text ellipsis fontSize={12} type="secondary">
                    {[
                      member.email !== name && member.email,
                      t('members.list.joined', { date: formatDate(member.createdAt) }),
                      t('members.list.lastActive', { date: formatDate(member.lastActiveAt) }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </Flexbox>
                {!isAdmin && (
                  <Flexbox horizontal align="center" gap={4}>
                    <Button
                      loading={pending}
                      size="small"
                      onClick={() =>
                        run(member.id, () =>
                          adminConfigService.setMemberDisabled(member.id, !member.banned),
                        )
                      }
                    >
                      {member.banned ? t('members.list.enable') : t('members.list.disable')}
                    </Button>
                    <ActionIcon
                      aria-label={t('members.list.delete')}
                      disabled={pending}
                      icon={Trash2}
                      size="small"
                      title={t('members.list.delete')}
                      onClick={() =>
                        confirmModal({
                          cancelText: t('cancel', { ns: 'common' }),
                          content: t('members.list.deleteConfirm.desc'),
                          okButtonProps: { danger: true },
                          okText: t('members.list.delete'),
                          onOk: () =>
                            run(member.id, () => adminConfigService.deleteMember(member.id)),
                          title: t('members.list.deleteConfirm.title', { name }),
                        })
                      }
                    />
                  </Flexbox>
                )}
              </Flexbox>
            );
          })
        )}
      </Flexbox>
    </Form.Group>
  );
};

export default MemberList;
