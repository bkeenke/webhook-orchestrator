import { useState } from 'react'
import {
  Stack, Group, Button, Text, Card, Badge, ActionIcon, SimpleGrid,
  Title, Center, Loader, Alert, Code,
} from '@mantine/core'
import { IconPlus, IconEdit, IconTrash, IconTarget, IconAlertCircle } from '@tabler/icons-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { modals } from '@mantine/modals'
import type { Target } from '../types'
import { getTargets, deleteTarget } from '../api/client'
import { TargetModal } from '../components/TargetModal'

export function TargetsPage() {
  const qc = useQueryClient()
  const [editTarget, setEditTarget] = useState<Target | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const { data: targets = [], isLoading, error } = useQuery({
    queryKey: ['targets'],
    queryFn: getTargets,
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTarget,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['targets'] })
      notifications.show({ message: 'Target deleted', color: 'orange' })
    },
    onError: (err: Error) => {
      notifications.show({ title: 'Error', message: err.message, color: 'red' })
    },
  })

  function openAdd() {
    setEditTarget(null)
    setModalOpen(true)
  }

  function openEdit(t: Target) {
    setEditTarget(t)
    setModalOpen(true)
  }

  function confirmDelete(t: Target) {
    modals.openConfirmModal({
      title: 'Delete Target',
      children: <Text size="sm">Delete target <strong>{t.id}</strong> ({t.url})?</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(t.id),
    })
  }

  if (isLoading) {
    return (
      <Center h="50vh">
        <Loader />
      </Center>
    )
  }

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" title="Failed to load targets">
        {(error as Error).message}
      </Alert>
    )
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>Targets</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openAdd}>
          Add Target
        </Button>
      </Group>

      {targets.length === 0 ? (
        <Center h="40vh">
          <Stack align="center" gap="xs">
            <IconTarget size={48} stroke={1} color="var(--mantine-color-dimmed)" />
            <Text c="dimmed" size="lg">No targets yet</Text>
            <Text c="dimmed" size="sm">Create a target to start forwarding webhooks</Text>
            <Button mt="xs" leftSection={<IconPlus size={16} />} onClick={openAdd}>
              Add your first target
            </Button>
          </Stack>
        </Center>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {targets.map(target => (
            <Card key={target.id} withBorder shadow="sm" radius="md" padding="md">
              <Stack gap="xs">
                <Group justify="space-between" align="flex-start">
                  <Code fw={700}>{target.id}</Code>
                  <Group gap={4}>
                    <ActionIcon variant="subtle" onClick={() => openEdit(target)}>
                      <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => confirmDelete(target)}
                      loading={deleteMutation.isPending && deleteMutation.variables === target.id}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Group>

                <Text size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>
                  {target.url}
                </Text>

                <Group gap="xs" wrap="wrap">
                  <Badge variant="light" color="gray" size="sm">
                    timeout: {target.timeout}
                  </Badge>
                  {target.primary && (
                    <Badge variant="light" color="blue" size="sm">primary</Badge>
                  )}
                  {target.forward_ip && (
                    <Badge variant="light" color="teal" size="sm">forward IP</Badge>
                  )}
                  {target.retry.enabled && (
                    <Badge variant="light" color="orange" size="sm">
                      retry ×{target.retry.max_attempts}
                    </Badge>
                  )}
                </Group>

                {Object.keys(target.headers).length > 0 && (
                  <Text size="xs" c="dimmed">
                    {Object.keys(target.headers).length} custom header{Object.keys(target.headers).length !== 1 ? 's' : ''}
                  </Text>
                )}
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}

      <TargetModal
        opened={modalOpen}
        target={editTarget}
        onClose={() => setModalOpen(false)}
      />
    </Stack>
  )
}
