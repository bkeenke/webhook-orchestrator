import {
  AppShell, NavLink, Group, Text, ActionIcon,
  useMantineColorScheme, Burger, Box, Progress,
  Button,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  IconSun, IconMoon, IconLogout, IconList, IconTarget, IconTopologyComplex,
} from '@tabler/icons-react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { logout } from '../api/client'
import { notifications } from '@mantine/notifications'
import { useState } from 'react'
import { TopologyModal } from './TopologyModal'
import { IconWebhook } from '@tabler/icons-react'

const nav = [
  { label: 'Sources', href: '/sources', icon: IconWebhook },
  { label: 'Targets', href: '/targets', icon: IconTarget },
  { label: 'Logs',    href: '/logs',    icon: IconList    },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const [opened, { toggle }] = useDisclosure()
  const isFetching = useIsFetching()
  const queryClient = useQueryClient()
  const [topologyOpen, setTopologyOpen] = useState(false)

  async function handleLogout() {
    try {
      await logout()
    } catch (_) {
    }
    navigate('/login', { replace: true })
    queryClient.clear()
    notifications.show({ message: 'Logged out', color: 'blue' })
  }

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Box style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000 }}>
          {isFetching > 0 && (
            <Progress value={100} animated size={2} radius={0} color="blue" />
          )}
        </Box>

        <Group h="100%" justify="space-between" px="md">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Group gap={6}>
              <IconWebhook size={22} stroke={1.5} color="var(--mantine-color-blue-5)" />
              <Text fw={800} size="lg">Webhook Orchestrator</Text>
            </Group>
          </Group>

          <Group gap={4}>
            <Button
              variant="subtle"
              size="sm"
              leftSection={<IconTopologyComplex size={16} />}
              onClick={() => setTopologyOpen(true)}
            >
              Topology
            </Button>
            <ActionIcon variant="subtle" onClick={toggleColorScheme} size="lg" title="Toggle theme">
              {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
            <ActionIcon variant="subtle" color="red" onClick={handleLogout} size="lg" title="Logout">
              <IconLogout size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs" pt="md">
        {nav.map(({ href, label, icon: Icon }) => (
          <NavLink
            key={href}
            component={Link}
            to={href}
            label={label}
            leftSection={<Icon size={18} stroke={1.5} />}
            active={location.pathname === href}
            variant="filled"
            style={{ borderRadius: 8, marginBottom: 2 }}
            onClick={() => { if (opened) toggle() }}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        {children}
      </AppShell.Main>

      <TopologyModal opened={topologyOpen} onClose={() => setTopologyOpen(false)} />
    </AppShell>
  )
}
