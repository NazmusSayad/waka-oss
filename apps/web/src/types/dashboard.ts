import type { Dimension } from '@/constants/dimensions'

export type Filter = { dimension: Dimension; value: string | null }

export type Range = { from: string; to: string }
