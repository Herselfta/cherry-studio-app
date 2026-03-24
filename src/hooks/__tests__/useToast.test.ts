import type { ReactNode } from 'react'

import { resolveToastTextClassName } from '@/hooks/useToast'

jest.mock('heroui-native', () => ({
  cn: (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ')
}))

jest.mock('moti', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  MotiView: ({ children }: { children: ReactNode }) => children
}))

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    isDark: false
  })
}))

describe('resolveToastTextClassName', () => {
  it('uses a readable default color for dark toast backgrounds', () => {
    expect(resolveToastTextClassName()).toBe('text-white')
  })

  it('maps semantic error colors to high-contrast text classes', () => {
    expect(resolveToastTextClassName('red')).toBe('text-red-200')
    expect(resolveToastTextClassName('$red100')).toBe('text-red-200')
  })

  it('preserves explicit text utility classes', () => {
    expect(resolveToastTextClassName('text-green-300')).toBe('text-green-300')
  })
})
