import { Modal, ScrollArea, Center, Loader, Text, Stack } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { getSources, getTargets } from '../api/client'
import type { Source, Target } from '../types'

interface Props {
  opened: boolean
  onClose: () => void
}

const BOX_WIDTH = 160
const BOX_HEIGHT = 48
const BOX_RADIUS = 6
const H_GAP = 160
const V_GAP = 20

const COL_SOURCE = 20
const COL_RULE   = COL_SOURCE + BOX_WIDTH + H_GAP
const COL_TARGET = COL_RULE   + BOX_WIDTH + H_GAP

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

interface LayoutNode {
  x: number
  y: number
  label: string
  sublabel?: string
  color: string
}

interface LayoutArrow {
  x1: number; y1: number
  x2: number; y2: number
}

export function TopologyModal({ opened, onClose }: Props) {
  const { data: sources = [], isLoading: loadingSources } = useQuery({
    queryKey: ['sources'],
    queryFn: getSources,
    enabled: opened,
  })

  const { data: targets = [], isLoading: loadingTargets } = useQuery({
    queryKey: ['targets'],
    queryFn: getTargets,
    enabled: opened,
  })

  const loading = loadingSources || loadingTargets
  const sourceNodes: LayoutNode[] = []
  const ruleNodes: LayoutNode[] = []
  const targetNodes: LayoutNode[] = []
  const arrows: LayoutArrow[] = []

  const targetMap = new Map<string, number>()
  targets.forEach((t: Target, i: number) => {
    targetNodes.push({
      x: COL_TARGET,
      y: i * (BOX_HEIGHT + V_GAP),
      label: t.id,
      sublabel: truncate(t.url, 22),
      color: '#2f9e44',
    })
    targetMap.set(t.id, i)
  })

  let ruleRow = 0
  let sourceRow = 0

  for (const source of sources as Source[]) {
    const sourceY = sourceRow * (BOX_HEIGHT + V_GAP)
    sourceNodes.push({
      x: COL_SOURCE,
      y: sourceY,
      label: truncate(source.name, 18),
      sublabel: source.path,
      color: '#1971c2',
    })

    const ruleStartRow = ruleRow

    for (const rule of source.rules) {
      const ruleY = ruleRow * (BOX_HEIGHT + V_GAP)
      const ruleLabel = rule.name || `rule-${ruleRow + 1}`
      const ruleSub = rule.conditions.length === 0 ? 'always' : `${rule.conditions.length} cond`
      ruleNodes.push({
        x: COL_RULE,
        y: ruleY,
        label: truncate(ruleLabel, 18),
        sublabel: ruleSub,
        color: '#495057',
      })

      const srcCX = COL_SOURCE + BOX_WIDTH
      const srcCY = sourceY + BOX_HEIGHT / 2
      const ruleCX = COL_RULE
      const ruleCY = ruleY + BOX_HEIGHT / 2
      arrows.push({ x1: srcCX, y1: srcCY, x2: ruleCX, y2: ruleCY })

      for (const tid of rule.targets) {
        const ti = targetMap.get(tid)
        if (ti !== undefined) {
          const tCX = COL_TARGET
          const tCY = ti * (BOX_HEIGHT + V_GAP) + BOX_HEIGHT / 2
          arrows.push({
            x1: COL_RULE + BOX_WIDTH,
            y1: ruleY + BOX_HEIGHT / 2,
            x2: tCX,
            y2: tCY,
          })
        }
      }

      ruleRow++
    }

    const ruleCount = source.rules.length
    if (ruleCount === 0) {
      sourceRow++
    } else {
      const midRule = ruleStartRow + (ruleCount - 1) / 2
      const sn = sourceNodes[sourceNodes.length - 1]
      sn.y = midRule * (BOX_HEIGHT + V_GAP)
      sourceRow = ruleRow
    }
  }

  const svgWidth  = COL_TARGET + BOX_WIDTH + 40
  const allRows   = Math.max(ruleRow, targets.length, sourceRow, 1)
  const svgHeight = allRows * (BOX_HEIGHT + V_GAP) + 40

  function renderBox(node: LayoutNode, idx: number) {
    return (
      <g key={idx} transform={`translate(${node.x},${node.y})`}>
        <rect
          width={BOX_WIDTH}
          height={BOX_HEIGHT}
          rx={BOX_RADIUS}
          fill={node.color}
          opacity={0.9}
        />
        <text
          x={BOX_WIDTH / 2}
          y={node.sublabel ? 16 : BOX_HEIGHT / 2 + 5}
          textAnchor="middle"
          fill="white"
          fontSize={12}
          fontWeight="bold"
          fontFamily="system-ui, sans-serif"
        >
          {node.label}
        </text>
        {node.sublabel && (
          <text
            x={BOX_WIDTH / 2}
            y={32}
            textAnchor="middle"
            fill="rgba(255,255,255,0.8)"
            fontSize={10}
            fontFamily="system-ui, sans-serif"
          >
            {node.sublabel}
          </text>
        )}
      </g>
    )
  }

  function renderArrow(a: LayoutArrow, idx: number) {
    const mx = (a.x1 + a.x2) / 2
    const d = `M ${a.x1} ${a.y1} C ${mx} ${a.y1} ${mx} ${a.y2} ${a.x2} ${a.y2}`
    return (
      <path
        key={idx}
        d={d}
        stroke="#868e96"
        strokeWidth={1.5}
        fill="none"
        markerEnd="url(#arrow)"
        opacity={0.6}
      />
    )
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Webhook Topology"
      size="calc(100vw - 2rem)"
      styles={{ body: { padding: 0 } }}
    >
      {loading ? (
        <Center h={300}>
          <Loader />
        </Center>
      ) : sources.length === 0 && targets.length === 0 ? (
        <Center h={300}>
          <Stack align="center" gap="xs">
            <Text c="dimmed">No sources or targets configured</Text>
          </Stack>
        </Center>
      ) : (
        <ScrollArea h="calc(100vh - 140px)" p="md">
          <svg
            width={svgWidth}
            height={svgHeight}
            style={{ display: 'block', margin: '0 auto' }}
          >
            <defs>
              <marker
                id="arrow"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L8,3 z" fill="#868e96" />
              </marker>
            </defs>

            {/* Column labels */}
            <text x={COL_SOURCE + BOX_WIDTH / 2} y={16} textAnchor="middle" fontSize={11}
              fill="#868e96" fontFamily="system-ui" fontWeight="600">
              SOURCES
            </text>
            <text x={COL_RULE + BOX_WIDTH / 2} y={16} textAnchor="middle" fontSize={11}
              fill="#868e96" fontFamily="system-ui" fontWeight="600">
              RULES
            </text>
            <text x={COL_TARGET + BOX_WIDTH / 2} y={16} textAnchor="middle" fontSize={11}
              fill="#868e96" fontFamily="system-ui" fontWeight="600">
              TARGETS
            </text>

            <g transform="translate(0, 24)">
              {arrows.map(renderArrow)}
              {sourceNodes.map(renderBox)}
              {ruleNodes.map(renderBox)}
              {targetNodes.map(renderBox)}
            </g>
          </svg>
        </ScrollArea>
      )}
    </Modal>
  )
}
