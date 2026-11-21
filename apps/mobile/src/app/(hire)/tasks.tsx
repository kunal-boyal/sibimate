import { colors } from '@sibimate/ui-tokens';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { TaskRow } from '@/components/TaskRow';
import { Text } from '@/components/Text';
import { errorKey, useT } from '@/lib/i18n';
import { api, useSession } from '@/lib/session';

const PAGE = 20;

/** Every task the customer has posted, newest first, a page at a time. */
export default function MyTasks() {
  const t = useT();
  const router = useRouter();
  const language = useSession((state) => state.language);
  const tasks = useInfiniteQuery({
    queryKey: ['tasks', 'all'],
    queryFn: ({ pageParam }) => api.listTasks({ status: 'all', limit: PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = tasks.data?.pages.flatMap((page) => page.items) ?? [];
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(language === 'hi' ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  return (
    <Screen
      title={t('tasks.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      backLabel={t('common.back')}
    >
      {tasks.isError ? <Notice variant="alert">{t(errorKey(tasks.error))}</Notice> : null}
      {tasks.isSuccess && items.length === 0 ? (
        <Text variant="body" color={colors.inkMuted}>
          {t('tasks.empty')}
        </Text>
      ) : null}
      {items.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          date={date(task.scheduleAt ?? task.createdAt)}
          onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
        />
      ))}
      {tasks.hasNextPage ? (
        <Button
          label={t('tasks.more')}
          variant="secondary"
          size="md"
          loading={tasks.isFetchingNextPage}
          onPress={() => void tasks.fetchNextPage()}
        />
      ) : null}
    </Screen>
  );
}
